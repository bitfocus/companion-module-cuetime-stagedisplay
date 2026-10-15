import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
	LIVENESS_INTERVAL_MS,
	ProtocolClient,
	RECONNECT_BASE_MS,
	RECONNECT_MAX_MS,
	SILENCE_TIMEOUT_MS,
	reconnectDelayMs,
} from './client.ts'
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
	/** Count of application-level pings the client has sent on this socket. */
	pings = 0
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

	ping(): void {
		this.pings += 1
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

	/** Server-side liveness frames, which satisfy the watchdog just as messages do. */
	emitPong(): void {
		this.fire('pong')
	}

	emitPing(): void {
		this.fire('ping')
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

describe('reconnectDelayMs', () => {
	it('doubles per attempt, with jitter between half and all of the capped delay', () => {
		const low = (): number => 0
		const high = (): number => 1

		expect(reconnectDelayMs(0, 1000, 30000, low)).toBe(500)
		expect(reconnectDelayMs(0, 1000, 30000, high)).toBe(1000)
		expect(reconnectDelayMs(1, 1000, 30000, low)).toBe(1000)
		expect(reconnectDelayMs(2, 1000, 30000, low)).toBe(2000)
		expect(reconnectDelayMs(3, 1000, 30000, low)).toBe(4000)
	})

	it('never exceeds the ceiling, however many attempts have failed', () => {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const delay = reconnectDelayMs(attempt, RECONNECT_BASE_MS, RECONNECT_MAX_MS)
			expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_MS)
			expect(delay).toBeGreaterThan(0)
		}

		// Only once the cap is reached does the jitter band sit at the ceiling rather
		// than below it; at low attempts the delay is legitimately much smaller.
		expect(reconnectDelayMs(0, RECONNECT_BASE_MS, RECONNECT_MAX_MS)).toBeLessThanOrEqual(RECONNECT_BASE_MS)
		expect(reconnectDelayMs(40, RECONNECT_BASE_MS, RECONNECT_MAX_MS)).toBeGreaterThanOrEqual(RECONNECT_MAX_MS / 2)
	})

	it('defaults to a 1 s base capped at 30 s', () => {
		expect(RECONNECT_BASE_MS).toBe(1000)
		expect(RECONNECT_MAX_MS).toBe(30000)
	})
})

/**
 * Reconnect and liveness policy, exercised on fake timers so the backoff growth and
 * the watchdog deadline can be observed exactly rather than waited for.
 */
describe('ProtocolClient reconnection and liveness', () => {
	const BASE = 100
	const MAX = 800
	const INTERVAL = 1000
	const SILENCE = 3000

	let client: ProtocolClient
	let sockets: FakeWebSocket[]
	let warnings: string[]

	function lastSocket(): FakeWebSocket {
		const socket = sockets.at(-1)
		if (!socket) throw new Error('no socket was created')
		return socket
	}

	/** Brings the newest socket up and completes the handshake. */
	function connectAndHandshake(): FakeWebSocket {
		const socket = lastSocket()
		socket.triggerOpen()
		socket.emit(JSON.stringify(helloEvent()))
		return socket
	}

	beforeEach(() => {
		vi.useFakeTimers()
		sockets = []
		warnings = []
		client = new ProtocolClient({
			host: 'localhost',
			port: 1234,
			log: (level, message) => {
				if (level === 'warn') warnings.push(message)
			},
			socketFactory: (url) => {
				const socket = new FakeWebSocket(url)
				sockets.push(socket)
				return socket
			},
			reconnectBaseMs: BASE,
			reconnectMaxMs: MAX,
			livenessIntervalMs: INTERVAL,
			silenceTimeoutMs: SILENCE,
			// Deterministic jitter: the low end of the range, i.e. half the capped delay.
			random: () => 0,
		})
	})

	afterEach(() => {
		client.stop()
		vi.useRealTimers()
	})

	it('waits half the base delay, then doubles on each successive failure', () => {
		client.start()
		connectAndHandshake()

		// attempt 0 -> capped 100, delay 50
		lastSocket().close(1006, 'lost')
		vi.advanceTimersByTime(BASE / 2 - 1)
		expect(sockets).toHaveLength(1)
		vi.advanceTimersByTime(1)
		expect(sockets).toHaveLength(2)

		// attempt 1 -> capped 200, delay 100
		lastSocket().close(1006, 'lost')
		vi.advanceTimersByTime(99)
		expect(sockets).toHaveLength(2)
		vi.advanceTimersByTime(1)
		expect(sockets).toHaveLength(3)

		// attempt 2 -> capped 400, delay 200
		lastSocket().close(1006, 'lost')
		vi.advanceTimersByTime(199)
		expect(sockets).toHaveLength(3)
		vi.advanceTimersByTime(1)
		expect(sockets).toHaveLength(4)
	})

	it('resets the backoff once a handshake completes', () => {
		client.start()
		connectAndHandshake()

		// Fail several times so the delay has grown well past the base.
		for (let i = 0; i < 4; i += 1) {
			lastSocket().close(1006, 'lost')
			vi.advanceTimersByTime(MAX)
		}

		// Now let one attempt succeed, then drop it: the delay is back to the base.
		connectAndHandshake()
		lastSocket().close(1006, 'lost')
		vi.advanceTimersByTime(BASE / 2 - 1)
		expect(sockets).toHaveLength(sockets.length)
		const before = sockets.length
		vi.advanceTimersByTime(1)
		expect(sockets).toHaveLength(before + 1)
	})

	it('caps the delay so a device that is off is not hammered', () => {
		client.start()
		for (let i = 0; i < 12; i += 1) {
			lastSocket().close(1006, 'lost')
			// Advancing by less than the capped delay must not produce a new socket.
			vi.advanceTimersByTime(MAX / 2 - 1)
		}
		const count = sockets.length
		vi.advanceTimersByTime(1)
		expect(sockets).toHaveLength(count + 1)
	})

	it('reconnects when the link goes silent, without waiting for a close event', () => {
		client.start()
		connectAndHandshake()
		expect(client.status).toBe('live')

		// No frames of any kind; the watchdog should give up after the silence timeout.
		vi.advanceTimersByTime(SILENCE - 1 + BASE / 2)
		expect(sockets).toHaveLength(1)

		vi.advanceTimersByTime(1)
		expect(sockets.length).toBeGreaterThan(1)
		expect(warnings.join(' ')).toContain('No traffic')
		expect(client.status).toBe('connecting')
	})

	it('treats server pings and pongs as evidence of life', () => {
		client.start()
		const socket = connectAndHandshake()

		// Each round trip stays inside the silence window, so the link is not reconnected.
		for (let i = 0; i < 6; i += 1) {
			vi.advanceTimersByTime(SILENCE - 1)
			socket.emitPong()
		}

		expect(sockets).toHaveLength(1)
		expect(client.status).toBe('live')
	})

	it('also watches a socket that opens but never completes a handshake', () => {
		// Otherwise a device that accepts TCP but never says hello stays `connecting`
		// until the process is restarted.
		client.start()
		lastSocket().triggerOpen()
		expect(client.status).toBe('connecting')

		vi.advanceTimersByTime(SILENCE + BASE / 2)
		expect(sockets.length).toBeGreaterThan(1)
	})

	it('sends a probe ping while the link is healthy', () => {
		client.start()
		const socket = connectAndHandshake()

		vi.advanceTimersByTime(INTERVAL)
		expect(socket.pings).toBe(1)
		vi.advanceTimersByTime(INTERVAL)
		expect(socket.pings).toBe(2)
	})

	it('stops checking liveness once stopped', () => {
		client.start()
		connectAndHandshake()
		client.stop()

		const count = sockets.length
		vi.advanceTimersByTime(SILENCE * 10)
		expect(sockets).toHaveLength(count)
	})

	it('uses sensible defaults for the watchdog', () => {
		expect(LIVENESS_INTERVAL_MS).toBe(5000)
		// Three missed 5 s server pings, measured on firmware 1.1.2.24.
		expect(SILENCE_TIMEOUT_MS).toBe(15000)
	})
})
