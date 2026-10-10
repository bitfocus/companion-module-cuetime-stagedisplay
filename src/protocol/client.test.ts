import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProtocolClient } from './client.ts'
import type { ClientStatus, WebSocketLike } from './client.ts'
import type { Event, Response } from './generated.ts'
import { controlCenterEvent, helloEvent } from './fixtures.ts'

/** A reply the fake device sends back for a command, minus the correlation id. */
type FakeReply = { type: Response['type'] } & Record<string, unknown>

/**
 * In-memory stand-in for a device connection. Because `ProtocolClient` depends
 * on the structural `WebSocketLike` interface rather than `ws` itself, the
 * protocol logic can be exercised without opening a socket.
 */
class FakeWebSocket implements WebSocketLike {
	readyState = 0 // CONNECTING
	readonly sent: string[] = []
	handler: (command: Record<string, any>) => FakeReply = (command) => ({
		type: 'ack_response',
		message: 'accepted',
		...(command.type === 'add_session' ? { entity_id: 'new-session' } : {}),
	})

	private readonly listeners = new Map<string, ((...args: any[]) => void)[]>()

	constructor(public readonly url: string) {}

	on(event: string, listener: (...args: any[]) => void): void {
		const listeners = this.listeners.get(event) ?? []
		listeners.push(listener)
		this.listeners.set(event, listeners)
	}

	send(data: string, cb?: (err?: Error) => void): void {
		this.sent.push(data)
		try {
			const command = JSON.parse(data) as Record<string, any>
			const reply = this.handler(command)
			if (command.request_id) {
				setTimeout(() => {
					this.emit(JSON.stringify({ ...reply, request_id: command.request_id }))
				}, 0)
			}
			cb?.()
		} catch (error) {
			cb?.(error as Error)
		}
	}

	close(code?: number, reason?: string): void {
		this.readyState = 3 // CLOSED
		this.fire('close', code, reason)
	}

	// ---- test helpers ----

	triggerOpen(): void {
		this.readyState = 1 // OPEN
		this.fire('open')
	}

	emit(raw: string): void {
		this.fire('message', raw)
	}

	private fire(event: string, ...args: any[]): void {
		for (const listener of this.listeners.get(event) ?? []) listener(...args)
	}
}

describe('ProtocolClient', () => {
	let client: ProtocolClient
	let socket: FakeWebSocket | null
	let events: Event[]
	let responses: Response[]
	let statusChanges: { status: ClientStatus; detail?: string }[]

	function lastSocket(): FakeWebSocket {
		if (!socket) throw new Error('client did not create a socket')
		return socket
	}

	beforeEach(() => {
		socket = null
		events = []
		responses = []
		statusChanges = []

		client = new ProtocolClient({
			host: 'localhost',
			port: 1234,
			onEvent: (event) => events.push(event),
			onResponse: (response) => responses.push(response),
			onStatusChange: (status, detail) => statusChanges.push({ status, detail }),
			log: () => {},
			socketFactory: (url) => {
				socket = new FakeWebSocket(url)
				return socket
			},
		})
	})

	afterEach(() => {
		client.stop()
	})

	it('reports connecting and opens the WebSocket transport URL', () => {
		client.start()

		expect(client.status).toBe('connecting')
		expect(lastSocket().url).toBe('ws://localhost:1234')
	})

	it('reports connecting, not live, while the transport is up but the device is silent', () => {
		client.start()
		lastSocket().triggerOpen()

		// `live` means hello was received, not merely that TCP connected.
		expect(client.status).toBe('connecting')
	})

	it('becomes live on hello_event and forwards it exactly once', () => {
		client.start()
		lastSocket().triggerOpen()

		const hello: Event = helloEvent()
		lastSocket().emit(JSON.stringify(hello))

		expect(client.status).toBe('live')
		expect(events).toEqual([hello])
		expect(statusChanges.map((change) => change.status)).toEqual(['connecting', 'live'])
	})

	it('hydrates with request_status once after hello', () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().emit(JSON.stringify(helloEvent()))

		const sentTypes = lastSocket().sent.map((raw) => (JSON.parse(raw) as { type: string }).type)
		expect(sentTypes).toEqual(['request_status'])

		// A second hello must not trigger a second hydration.
		lastSocket().emit(JSON.stringify(helloEvent()))
		expect(lastSocket().sent).toHaveLength(1)
	})

	it('resolves a command with its correlated ack', async () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().emit(JSON.stringify(helloEvent()))

		const result = await client.send('add_time', { seconds: 30 })

		expect(result.ok).toBe(true)
		expect(result.type).toBe('ack_response')
		// Replies are also handed to the response observer, not only to the caller.
		expect(responses.at(-1)?.type).toBe('ack_response')
	})

	it('surfaces a device rejection as ok:false with the error code', async () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().handler = () => ({
			type: 'error_response',
			code: 'INVALID_COMMAND',
			message: 'No active session to start',
		})
		lastSocket().emit(JSON.stringify(helloEvent()))

		const result = await client.send('start_session')

		expect(result.ok).toBe(false)
		expect(result.code).toBe('INVALID_COMMAND')
		expect(result.message).toBe('No active session to start')
	})

	it('forwards a pushed state event and records the response', async () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().emit(JSON.stringify(helloEvent()))
		events = []

		const event: Event = controlCenterEvent({ timer_run_state: 'paused' })
		lastSocket().emit(JSON.stringify(event))

		expect(events).toEqual([event])
	})

	it('refuses to send while the socket is not open', async () => {
		client.start()

		// Never opened: the fake stays in CONNECTING.
		await expect(client.send('add_time', { seconds: 1 })).rejects.toThrow('WebSocket not open')
	})

	it('reports disconnection with the close reason', () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().emit(JSON.stringify(helloEvent()))

		lastSocket().close(1006, 'lost')

		expect(client.status).toBe('disconnected')
		expect(statusChanges.at(-1)).toEqual({ status: 'disconnected', detail: 'lost' })
	})

	it('settles in-flight commands instead of leaving them hanging when the link drops', async () => {
		client.start()
		lastSocket().triggerOpen()
		lastSocket().emit(JSON.stringify(helloEvent()))

		const inFlight = client.send('add_time', { seconds: 5 })
		lastSocket().close(1006, 'lost')

		const result = await inFlight
		expect(result.ok).toBe(false)
		expect(result.code).toBe('DISCONNECTED')
	})
})
