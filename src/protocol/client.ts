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
	/**
	 * Application-level keepalive. Optional because a fake socket in a test need not
	 * implement it; the real `ws` socket does.
	 */
	ping?(data?: unknown): void
	on(event: string, listener: (...args: any[]) => void): void
}

/** `WebSocket.OPEN`, restated so we don't depend on the `ws` runtime for it. */
const OPEN = 1
const REQUEST_TIMEOUT_MS = 5000

/** First reconnect waits at least this long, and it doubles from there. */
export const RECONNECT_BASE_MS = 1000
/** Ceiling on the reconnect delay, so a device that is off is not hammered forever. */
export const RECONNECT_MAX_MS = 30000
/** How often liveness is checked (and a probe ping sent if needed). */
export const LIVENESS_INTERVAL_MS = 5000
/**
 * Silence beyond this forces a reconnect. The device pings every 5 s in every state
 * (measured on firmware 1.1.2.24), so 15 s is three missed pings.
 */
export const SILENCE_TIMEOUT_MS = 15000

/**
 * Exponential backoff with equal jitter: half the capped delay, plus up to half more.
 *
 * The jitter matters because every instance of this module reconnects to its own
 * device, and a switch or power event can take a whole rack down at once — without it
 * they would all retry in lockstep.
 */
export function reconnectDelayMs(
	attempt: number,
	baseMs: number = RECONNECT_BASE_MS,
	maxMs: number = RECONNECT_MAX_MS,
	random: () => number = Math.random,
): number {
	const capped = Math.min(baseMs * 2 ** attempt, maxMs)
	const half = capped / 2
	return Math.round(half + random() * half)
}

export interface ProtocolClientOptions {
	host: string
	port: number
	onEvent?: (event: Event) => void
	onResponse?: (response: Response) => void
	onStatusChange?: (status: ClientStatus, detail?: string) => void
	log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
	/** Test seam. Defaults to the real `ws` constructor. */
	socketFactory?: (url: string) => WebSocketLike
	/** Test seams for the reconnect/liveness policy. */
	reconnectBaseMs?: number
	reconnectMaxMs?: number
	livenessIntervalMs?: number
	silenceTimeoutMs?: number
	random?: () => number
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
	private readonly reconnectBaseMs: number
	private readonly reconnectMaxMs: number
	private readonly livenessIntervalMs: number
	private readonly silenceTimeoutMs: number
	private readonly random: () => number

	private ws: WebSocketLike | null = null
	private clientStatus: ClientStatus = 'disconnected'
	private readonly pendingRequests = new Map<string, PendingRequest>()
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private livenessTimer: ReturnType<typeof setInterval> | null = null
	private reconnectAttempt = 0
	private lastFrameAt = 0
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
			options.socketFactory ??
			((url): WebSocketLike =>
				// `handshakeTimeout` bounds the case the liveness watchdog cannot see: a socket
				// that never opens, so never starts its liveness checks. Without it a
				// black-holed address would sit in `connecting` for the OS TCP timeout.
				new WebSocket(url, { handshakeTimeout: 10000 }))
		this.reconnectBaseMs = options.reconnectBaseMs ?? RECONNECT_BASE_MS
		this.reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS
		this.livenessIntervalMs = options.livenessIntervalMs ?? LIVENESS_INTERVAL_MS
		this.silenceTimeoutMs = options.silenceTimeoutMs ?? SILENCE_TIMEOUT_MS
		this.random = options.random ?? Math.random
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
		this.disconnect()
		this.settleAllPending({ ok: false, type: 'error_response', code: 'DISCONNECTED', message: 'Client stopped' })
		try {
			ws?.close(1000, 'Client stopped')
		} catch {
			// The socket is already detached; a failure here is not worth surfacing.
		}
	}

	private setStatus(status: ClientStatus, detail?: string): void {
		this.clientStatus = status
		this.onStatusChange(status, detail)
	}

	/**
	 * Detaches the current socket and stops its liveness checks, without scheduling a
	 * reconnect. Callers either reconnect deliberately or stop for good.
	 */
	private disconnect(detail?: string): void {
		this.ws = null
		if (this.livenessTimer) {
			clearInterval(this.livenessTimer)
			this.livenessTimer = null
		}
		this.setStatus('disconnected', detail)
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
		// Server pings and pongs are evidence of life just as messages are, and the device
		// pings every 5 s, so they are the main thing keeping the watchdog satisfied.
		ws.on('ping', () => this.noteLife())
		ws.on('pong', () => this.noteLife())
	}

	private handleOpen(ws: WebSocketLike): void {
		if (this.ws !== ws) return
		// Still `connecting`: the transport is up but the device has not spoken yet.
		this.log('debug', 'WebSocket open; waiting for hello_event')
		this.noteLife()
		this.startLivenessChecks()
	}

	private noteLife(): void {
		this.lastFrameAt = Date.now()
	}

	private startLivenessChecks(): void {
		if (this.livenessTimer) return
		this.livenessTimer = setInterval(() => this.checkLiveness(), this.livenessIntervalMs)
		this.livenessTimer.unref?.()
	}

	/**
	 * Reconnects a connection that has gone quiet.
	 *
	 * "No events" is deliberately *not* the signal: an idle display legitimately pushes
	 * nothing for minutes. Silence means no frames of any kind — no message, no ping,
	 * no pong — which is a dead or half-open link. The same reasoning is why a probe ping
	 * is sent: it makes the peer answer even if it is otherwise idle.
	 */
	private checkLiveness(): void {
		const ws = this.ws
		if (!ws) return

		const silentMs = Date.now() - this.lastFrameAt
		if (silentMs >= this.silenceTimeoutMs) {
			this.log('warn', `No traffic from the device for ${Math.round(silentMs / 1000)}s; reconnecting`)
			this.forceReconnect('No traffic')
			return
		}

		if (ws.readyState === OPEN) {
			try {
				ws.ping?.()
			} catch {
				// A ping we cannot send is not itself a reason to reconnect; the silence
				// check above will decide that on its own.
			}
		}
	}

	/**
	 * Tears the connection down immediately so a fresh attempt can start.
	 *
	 * `close()` alone is not enough: on a half-open socket it waits for a close
	 * handshake that will never arrive, so the client would sit on stale state for the
	 * duration of that timeout. Detaching first makes the reconnect immediate, and the
	 * socket's own late `close` event is ignored by the `this.ws !== ws` guards.
	 */
	private forceReconnect(reason: string): void {
		const ws = this.ws
		this.disconnect(reason)
		this.settleAllPending({ ok: false, type: 'error_response', code: 'DISCONNECTED', message: reason })
		try {
			ws?.close(1011, reason)
		} catch {
			// Detached already; nothing to report.
		}
		this.scheduleReconnect()
	}

	private handleMessage(ws: WebSocketLike, data: unknown): void {
		if (this.ws !== ws) return
		this.noteLife()

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
			// A completed handshake is the only proof the connection works, so this is where
			// the backoff resets rather than merely on a socket opening.
			this.reconnectAttempt = 0
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
		const decoded = typeof reason === 'string' ? reason : Buffer.isBuffer(reason) ? reason.toString('utf8') : ''
		const detail = decoded || (code !== undefined ? `code ${code}` : undefined)
		this.log('debug', `WebSocket closed${detail ? ` (${detail})` : ''}`)
		this.disconnect(detail)
		this.settleAllPending({ ok: false, type: 'error_response', code: 'DISCONNECTED', message: 'Connection lost' })
		this.scheduleReconnect()
	}

	private handleError(error: Error): void {
		this.log('error', `WebSocket error: ${error.message}`)
		const ws = this.ws
		this.disconnect(error.message)
		try {
			ws?.close(1011, 'Error')
		} catch {
			// Detached already; nothing to report.
		}
		this.scheduleReconnect()
	}

	/**
	 * Schedules the next connection attempt, backing off exponentially.
	 *
	 * The attempt counter is only reset by a completed `hello_event`, so a device that
	 * accepts TCP connections but never completes a handshake also backs off rather than
	 * retrying at the base delay forever.
	 */
	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return

		const delayMs = reconnectDelayMs(this.reconnectAttempt, this.reconnectBaseMs, this.reconnectMaxMs, this.random)
		this.reconnectAttempt += 1

		this.log('debug', `Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`)
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.stopped) this.start()
		}, delayMs)
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
