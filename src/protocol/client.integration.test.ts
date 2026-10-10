import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocketServer } from 'ws'
import { ProtocolClient } from './client.ts'
import type { ClientStatus } from './client.ts'
import type { Event, Response } from './generated.ts'
import { controlCenter, helloEvent, statusResponse } from './fixtures.ts'

/**
 * End-to-end checks against a real `ws` server.
 *
 * These are the tests that catch transport-level mistakes — above all the frame
 * encoding, since `ws` hands text frames to the client as `Buffer`s and a
 * string-only check would silently drop every event.
 */

let server: WebSocketServer
let port: number

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	throw new Error('timed out waiting for the client to reach the expected state')
}

interface Harness {
	client: ProtocolClient
	events: Event[]
	responses: Response[]
	statusChanges: { status: ClientStatus; detail?: string }[]
}

function startClient(): Harness {
	const events: Event[] = []
	const responses: Response[] = []
	const statusChanges: { status: ClientStatus; detail?: string }[] = []

	const client = new ProtocolClient({
		host: '127.0.0.1',
		port,
		onEvent: (event) => events.push(event),
		onResponse: (response) => responses.push(response),
		onStatusChange: (status, detail) => statusChanges.push({ status, detail }),
		log: () => {},
	})

	client.start()
	return { client, events, responses, statusChanges }
}

beforeAll(async () => {
	server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await new Promise<void>((resolve, reject) => {
		server.once('listening', () => resolve())
		server.once('error', reject)
	})

	const address = server.address()
	if (typeof address !== 'object' || address === null) {
		throw new Error('mock server did not report a bound port')
	}
	port = address.port
})

afterAll(async () => {
	for (const socket of server.clients) socket.terminate()
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('ProtocolClient over a real socket', () => {
	it('connects, receives hello_event and becomes live', async () => {
		const hello: Event = helloEvent({ screen_name: 'Stage' })

		server.once('connection', (socket) => {
			socket.send(JSON.stringify(hello))
		})

		const harness = startClient()
		await waitFor(() => harness.client.status === 'live')

		expect(harness.client.status).toBe('live')
		expect(harness.events).toContainEqual(hello)
		expect(harness.statusChanges.map((change) => change.status)).toEqual(['connecting', 'live'])

		harness.client.stop()
	})

	it('hydrates from the status_response and correlates a later command reply', async () => {
		server.once('connection', (socket) => {
			socket.send(JSON.stringify(helloEvent()))

			socket.on('message', (raw) => {
				const command = JSON.parse(raw.toString()) as { type: string; request_id: string }

				if (command.type === 'request_status') {
					const hydration = statusResponse({
						control_center: controlCenter({ timer_run_state: 'running', elapsed_time: 1000 }),
					})
					socket.send(JSON.stringify({ ...hydration, request_id: command.request_id }))
					return
				}

				socket.send(JSON.stringify({ type: 'ack_response', message: 'accepted', request_id: command.request_id }))
			})
		})

		const harness = startClient()
		await waitFor(() => harness.client.status === 'live')

		const result = await harness.client.send('add_time', { seconds: 30 })

		expect(result.ok).toBe(true)
		expect(harness.responses.some((response) => response.type === 'status_response')).toBe(true)

		harness.client.stop()
	})

	it('surfaces a device rejection with its error code', async () => {
		server.once('connection', (socket) => {
			socket.send(JSON.stringify(helloEvent()))

			socket.on('message', (raw) => {
				const command = JSON.parse(raw.toString()) as { type: string; request_id: string }
				if (command.type === 'request_status') return

				socket.send(
					JSON.stringify({
						type: 'error_response',
						code: 'INVALID_COMMAND',
						message: 'No active session to start',
						request_id: command.request_id,
					}),
				)
			})
		})

		const harness = startClient()
		await waitFor(() => harness.client.status === 'live')

		const result = await harness.client.send('start_session')

		expect(result.ok).toBe(false)
		expect(result.code).toBe('INVALID_COMMAND')
		expect(result.message).toBe('No active session to start')

		harness.client.stop()
	})
})
