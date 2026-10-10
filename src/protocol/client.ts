import WebSocket from 'ws'
import { buildCommand, CommandType, CommandPayloads, Event, Response, isResponse, parseInbound } from './generated.ts'

/** Connection lifecycle as the module sees it. `live` means hello was received. */
export type ClientStatus = 'disconnected' | 'connecting' | 'live'

/**
 * Normalised outcome of a command, so callers never branch on raw response types.
 * `ok` is false only for `error_response` (and for local failures such as a timeout).
 */
export interface ResponseResult {
	ok: boolean
	type: Response['type']
	message?: string
	code?: string
	response?: Response
}

/**
 * The slice of a WebSocket this client actually uses. Declaring it structurally
 * is what lets tests inject a fake socket that never touches the network.
 */
export interface WebSocketLike {
	readyState: number
	send(data: string, cb?: (err?: Error) => void): void
	close(code?: number, reason?: string): void
	on(event: string, listener: (...args: any[]) => void): void
}

/** `WebSocket.OPEN`, restated so we don't depend on the `ws` runtime for it. */
const OPEN = 1
const REQUEST_TIMEOUT_MS = 5000
const RECONNECT_DELAY_MS = 2000

export interface ProtocolClientOptions {
	host: string
	port: number
	onEvent?: (event: Event) => void
	onResponse?: (response: Response) => void
	onStatusChange?: (status: ClientStatus, detail?: string) => void
	log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
	/** Test seam. Defaults to the real `ws` constructor. */
	socketFactory?: (url: string) => WebSocketLike
}

interface PendingRequest {
	resolve: (result: ResponseResult) => void
	timer: ReturnType<typeof setTimeout>
}

/** Classifies a reply into the caller-facing result shape. */
export function toResponseResult(response: Response): ResponseResult {
	switch (response.type) {
		case 'error_response':
			return { ok: false, type: response.type, code: response.code, message: response.message, response }
		case 'ack_response':
			return { ok: true, type: response.type, message: response.message, response }
		default:
			return { ok: true, type: response.type, response }
	}
}

/** WebSocket frames arrive as strings, Buffers, or Buffer[]; normalise to text. */
function frameToText(data: unknown): string | null {
	if (typeof data === 'string') return data
	if (Buffer.isBuffer(data)) return data.toString('utf8')
	if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8')
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
	return null
}

/**
 * Event-driven client for the CueTime WebSocket transport (`ws://host:8081`).
 *
 * The device pushes state as events, so this class does no polling: it connects,
 * waits for `hello_event`, then hydrates once with `request_status` and lets
 * events keep the caller's state current.
 */
export class ProtocolClient {
	private readonly host: string
	private readonly port: number
	private readonly onEvent: (event: Event) => void
	private readonly onResponse: (response: Response) => void
	private readonly onStatusChange: (status: ClientStatus, detail?: string) => void
	private readonly log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
	private readonly socketFactory: (url: string) => WebSocketLike

	private ws: WebSocketLike | null = null
	private clientStatus: ClientStatus = 'disconnected'
	private readonly pendingRequests = new Map<string, PendingRequest>()
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private stopped = true
	private hydrated = false

	constructor(options: ProtocolClientOptions) {
		this.host = options.host
		this.port = options.port
		this.onEvent = options.onEvent ?? ((): void => {})
		this.onResponse = options.onResponse ?? ((): void => {})
		this.onStatusChange = options.onStatusChange ?? ((): void => {})
		this.log = options.log ?? ((level, message) => console[level](message))
		this.socketFactory =
			options.socketFactory ?? ((url): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike)
	}

	get status(): ClientStatus {
		return this.clientStatus
	}

	start(): void {
		if (this.clientStatus !== 'disconnected') return
		this.stopped = false
		this.hydrated = false
		this.setStatus('connecting')
		this.connect()
	}

	stop(): void {
		this.stopped = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		const ws = this.ws
		this.ws = null
		this.setStatus('disconnected')
		this.settleAllPending({ ok: false, type: 'error_response', code: 'DISCONNECTED', message: 'Client stopped' })
		ws?.close(1000, 'Client stopped')
	}

	private setStatus(status: ClientStatus, detail?: string): void {
		this.clientStatus = status
		this.onStatusChange(status, detail)
	}

	private connect(): void {
		const url = `ws://${this.host}:${this.port}`
		this.log('debug', `Connecting to ${url}`)

		let ws: WebSocketLike
		try {
			ws = this.socketFactory(url)
		} catch (error) {
			this.handleError(error as Error)
			return
		}

		this.ws = ws
		ws.on('open', () => this.handleOpen(ws))
		ws.on('message', (data: unknown) => this.handleMessage(ws, data))
		ws.on('close', (code?: number, reason?: unknown) => this.handleClose(ws, code, reason))
		ws.on('error', (error: Error) => this.handleError(error))
	}

	private handleOpen(ws: WebSocketLike): void {
		if (this.ws !== ws) return
		// Still `connecting`: the transport is up but the device has not spoken yet.
		this.log('debug', 'WebSocket open; waiting for hello_event')
	}

	private handleMessage(ws: WebSocketLike, data: unknown): void {
		if (this.ws !== ws) return

		const text = frameToText(data)
		if (text === null) {
			this.log('warn', 'Ignoring non-text WebSocket frame')
			return
		}

		const message = parseInbound(text)
		if (!message) {
			this.log('warn', `Ignoring unrecognised frame: ${text}`)
			return
		}

		if (isResponse(message)) {
			if (message.request_id) this.resolvePending(message)
			this.onResponse(message)
			return
		}

		if (message.type === 'hello_event') {
			this.setStatus('live')
			this.onEvent(message)
			// Events carry deltas only, so pull the full snapshot exactly once.
			if (!this.hydrated) {
				this.hydrated = true
				void this.send('request_status', { detailed: true }).catch((error: unknown) => {
					this.log('debug', `Initial status request failed: ${String(error)}`)
				})
			}
			return
		}

		this.onEvent(message)
	}

	private handleClose(ws: WebSocketLike, code?: number, reason?: unknown): void {
		if (this.ws !== ws) return
		this.ws = null
		const decoded = typeof reason === 'string' ? reason : Buffer.isBuffer(reason) ? reason.toString('utf8') : ''
		const detail = decoded || (code !== undefined ? `code ${code}` : undefined)
		this.log('debug', `WebSocket closed${detail ? ` (${detail})` : ''}`)
		this.setStatus('disconnected', detail)
		this.settleAllPending({ ok: false, type: 'error_response', code: 'DISCONNECTED', message: 'Connection lost' })
		this.scheduleReconnect()
	}

	private handleError(error: Error): void {
		this.log('error', `WebSocket error: ${error.message}`)
		this.setStatus('disconnected', error.message)
		const ws = this.ws
		this.ws = null
		ws?.close(1011, 'Error')
		this.scheduleReconnect()
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.stopped) this.start()
		}, RECONNECT_DELAY_MS)
		// Don't hold the process open just for a retry.
		this.reconnectTimer.unref?.()
	}

	/** Resolves (never rejects) every in-flight request so callers see a structured failure. */
	private settleAllPending(result: ResponseResult): void {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timer)
			pending.resolve(result)
		}
		this.pendingRequests.clear()
	}

	private resolvePending(response: Response): void {
		const id = response.request_id
		if (!id) return
		const pending = this.pendingRequests.get(id)
		if (!pending) return
		clearTimeout(pending.timer)
		this.pendingRequests.delete(id)
		pending.resolve(toResponseResult(response))
	}

	/**
	 * Sends a command and waits for its correlated reply.
	 *
	 * Throws only when the transport is not usable — a device-level rejection
	 * comes back as `{ ok: false }` so callers can log and carry on.
	 */
	async send<K extends CommandType>(
		type: K,
		payload: CommandPayloads[K] = {} as CommandPayloads[K],
	): Promise<ResponseResult> {
		const ws = this.ws
		if (!ws || ws.readyState !== OPEN) {
			throw new Error('WebSocket not open')
		}

		const command = buildCommand(type, payload)

		const result = new Promise<ResponseResult>((resolve) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(command.request_id)
				resolve({
					ok: false,
					type: 'error_response',
					code: 'TIMEOUT',
					message: `No reply to '${type}' within ${REQUEST_TIMEOUT_MS}ms`,
				})
			}, REQUEST_TIMEOUT_MS)
			timer.unref?.()
			this.pendingRequests.set(command.request_id, { resolve, timer })
		})

		try {
			await new Promise<void>((resolve, reject) => {
				ws.send(JSON.stringify(command), (error?: Error) => (error ? reject(error) : resolve()))
			})
		} catch (error) {
			const pending = this.pendingRequests.get(command.request_id)
			if (pending) {
				clearTimeout(pending.timer)
				this.pendingRequests.delete(command.request_id)
			}
			throw error
		}

		return result
	}
}
