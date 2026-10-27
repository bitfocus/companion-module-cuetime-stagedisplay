import { InstanceBase, Regex, InstanceStatus, InstanceTypes, SomeCompanionConfigField } from '@companion-module/base'
import type { JsonObject } from '@companion-module/base'
import { UpdateActions } from './actions.ts'
import { UpdateFeedbacks } from './feedbacks.ts'
import { UpdateVariableDefinitions } from './variables.ts'
import { UpdatePresets } from './presets.ts'
import { extractVariableValues, getEffectiveHost, getEffectivePort } from './logic.ts'
import { ProtocolClient } from './protocol/client.ts'
import type { ClientStatus, ResponseResult } from './protocol/client.ts'
import { applyEvent, applyResponse, createInitialState } from './protocol/state.ts'
import type { ProtocolState } from './protocol/state.ts'
import type { CommandPayloads, CommandType } from './protocol/generated.ts'

/**
 * Re-exported so Companion finds the upgrade scripts on the module entrypoint.
 * It reads them from here — nothing in `@companion-module/base` references the name.
 */
export { UpgradeScripts } from './upgrades.ts'

export interface Config extends JsonObject {
	host: string
	port: string
	'cuetime-display': string | null
}

interface ModuleInstanceTypes extends InstanceTypes {
	config: Config
	secrets: undefined
}

export interface ModuleInstance extends InstanceBase<ModuleInstanceTypes> {
	config: Config
	/** Latest state assembled from pushed events; the single source for feedbacks/variables. */
	state: ProtocolState
	connected: boolean
	/** Dispatches a command without waiting for the reply; the outcome is logged later. */
	sendCommand<K extends CommandType>(type: K, payload?: CommandPayloads[K]): void
	/** Sends a command and hands back the full reply, for actions that need its payload. */
	sendCommandDetailed<K extends CommandType>(type: K, payload?: CommandPayloads[K]): Promise<ResponseResult>
	updateActions(): void
	updateFeedbacks(): void
	updateVariableDefinitions(): void
	updatePresets(): void
}

/** Every feedback this module defines; refreshed in one pass whenever state changes. */
const FEEDBACK_IDS = [
	'is_connected',
	'is_playing',
	'is_paused',
	'is_idle',
	'is_glowing',
	'is_blackout',
	'is_flashing',
	'has_previous_session',
	'no_previous_session',
	'has_next_session',
	'no_next_session',
	'message_showing',
	'is_time_up_display',
	'is_time_up_flashing',
] as const

class ModuleInstanceImpl extends InstanceBase<ModuleInstanceTypes> implements ModuleInstance {
	public config!: Config
	public state: ProtocolState = createInitialState()
	public connected = false

	private client: ProtocolClient | null = null

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: Config, _isFirstInit: boolean): Promise<void> {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()

		this.refreshFromState()
		this.connect()
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		this.client?.stop()
		this.client = null
	}

	async configUpdated(config: Config): Promise<void> {
		this.config = config
		this.log('info', 'Configuration changed; reconnecting')
		this.connect()
	}

	private connect(): void {
		this.client?.stop()

		const host = this.resolveHost()
		const port = Number(this.resolvePort())

		this.client = new ProtocolClient({
			host,
			port,
			log: (level, message) => this.log(level, message),
			onEvent: (event) => {
				this.state = applyEvent(this.state, event)
				this.refreshFromState()
			},
			onResponse: (response) => {
				this.state = applyResponse(this.state, response)
				this.refreshFromState()
			},
			onStatusChange: (status, detail) => this.handleStatusChange(status, detail),
		})

		this.log('info', `Connecting to CueTime display at ws://${host}:${port}`)
		this.client.start()
	}

	private handleStatusChange(status: ClientStatus, detail?: string): void {
		this.connected = status === 'live'

		switch (status) {
			case 'live':
				this.updateStatus(InstanceStatus.Ok)
				break
			case 'connecting':
				this.updateStatus(InstanceStatus.Connecting)
				break
			default:
				this.updateStatus(InstanceStatus.ConnectionFailure, detail)
				break
		}

		this.refreshFromState()
	}

	/** Projects state onto variables and feedbacks. Cheap enough to run on every event. */
	private refreshFromState(): void {
		this.setVariableValues(extractVariableValues(this.state))
		this.checkFeedbacks(...FEEDBACK_IDS)
	}

	/**
	 * Sends a command and hands back the full reply, for the rare flow that needs its
	 * payload (reading `entity_id` from an ack, for instance).
	 *
	 * **Do not await this inside an action callback** unless the reply is genuinely
	 * required: Companion runs callbacks under its own timeout, so waiting on a device
	 * that is slow (or unwell) makes Companion report the action as failed even though
	 * the command was delivered. See `sendCommand`.
	 */
	async sendCommandDetailed<K extends CommandType>(
		type: K,
		payload: CommandPayloads[K] = {} as CommandPayloads[K],
	): Promise<ResponseResult> {
		if (!this.client) {
			return {
				ok: false,
				type: 'error_response',
				code: 'NOT_CONNECTED',
				message: 'Protocol client is not initialised',
			}
		}

		try {
			return await this.client.send(type, payload)
		} catch (error) {
			return {
				ok: false,
				type: 'error_response',
				code: 'TRANSPORT_ERROR',
				message: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Dispatches a command **without waiting for the reply**.
	 *
	 * Companion runs an action callback under its own timeout, and a reply can take as
	 * long as the request timeout — or never arrive, if the device is unwell. Awaiting
	 * the reply here made Companion fail actions that had actually been delivered, which
	 * is what `Error executing action: Error: Call timed out` in the Companion log was.
	 *
	 * The outcome is reported when it arrives instead, so a rejection is still visible
	 * without holding up the callback.
	 */
	sendCommand<K extends CommandType>(type: K, payload: CommandPayloads[K] = {} as CommandPayloads[K]): void {
		void this.sendCommandDetailed(type, payload).then(
			(result) => {
				if (result.ok) return
				const detail = [result.code, result.message].filter(Boolean).join(' — ')
				this.log('warn', `CueTime rejected '${type}'${detail ? `: ${detail}` : ''}`)
			},
			(error: unknown) => {
				this.log('error', `Failed to send '${type}': ${error instanceof Error ? error.message : String(error)}`)
			},
		)
	}

	private resolveHost(): string {
		return getEffectiveHost(this.config)
	}

	private resolvePort(): string {
		return getEffectivePort(this.config)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return [
			{
				type: 'bonjour-device',
				id: 'cuetime-display',
				label: 'Discovered CueTime Displays',
				width: 12,
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP (manual)',
				width: 8,
				regex: Regex.IP,
				isVisibleExpression: '$(cuetime-display:cuetime-display) == null',
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port (manual)',
				width: 4,
				regex: Regex.PORT,
				default: '8081',
				isVisibleExpression: '$(cuetime-display:cuetime-display) == null',
			},
		]
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}
}

export default ModuleInstanceImpl
