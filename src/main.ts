import { InstanceBase, Regex, InstanceStatus } from '@companion-module/base'
import type { InstanceTypes, SomeCompanionConfigField } from '@companion-module/base'
import type { JsonObject } from '@companion-module/base'
import { UpdateActions } from './actions.ts'
import { FEEDBACK_IDS, UpdateFeedbacks } from './feedbacks.ts'
import { UpdateVariableDefinitions } from './variables.ts'
import { UpdatePresets } from './presets.ts'
import { DEFAULT_PORT, extractVariableValues, getEffectiveEndpoint } from './logic.ts'
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

/**
 * The connection's shapes, including every action and feedback option.
 *
 * Declaring the option schemas here is what makes the callbacks typed: without them
 * `event.options` degrades to "any key, any value", so a misspelt option id compiles
 * and the action silently sends nothing. Fields are optional because an option without
 * a `default` can be absent, and because actions must keep working against state the
 * display has not reported yet.
 */
export interface ModuleInstanceTypes extends InstanceTypes {
	config: Config
	secrets: undefined
	actions: {
		navigate_next_session: { options: Record<string, never> }
		navigate_previous_session: { options: Record<string, never> }
		toggle_playback: { options: Record<string, never> }
		start_session: { options: Record<string, never> }
		pause_session: { options: Record<string, never> }
		reset_current_session: { options: Record<string, never> }
		reset_program_elapsed_timer: { options: Record<string, never> }
		add_time: { options: { seconds?: number } }
		subtract_time: { options: { seconds?: number } }
		add_session: {
			options: {
				name?: string
				mode?: string
				seconds?: number
				offset?: string
				presenter_name?: string
				notes?: string
				flash_start_time_seconds?: number
				flash_length_seconds?: number
				start?: boolean
			}
		}
		show_session: { options: { session_number?: number } }
		move_session_up: { options: { session_id?: string } }
		move_session_down: { options: { session_id?: string } }
		delete_session: { options: { session_id?: string } }
		update_session: {
			options: {
				session_id?: string
				mode?: string
				seconds?: string
				offset?: string
				name?: string
				presenter_name?: string
				notes?: string
				flash_start_time_seconds?: number
				flash_length_seconds?: number
			}
		}
		add_message: { options: { content?: string } }
		delete_message: { options: { message_number?: number } }
		move_message_up: { options: { message_number?: number } }
		move_message_down: { options: { message_number?: number } }
		update_message: { options: { message_number?: number; content?: string } }
		blackout: { options: { action?: string } }
		set_glow: { options: { enabled?: string } }
		toggle_glow: { options: Record<string, never> }
		set_flash: { options: { action?: string } }
		toggle_flash: { options: Record<string, never> }
		show_message: { options: { message_number?: number; text?: string; flash?: string } }
		hide_message: { options: Record<string, never> }
		show_idle: { options: Record<string, never> }
		set_brightness: { options: { brightness?: number } }
		set_is_time_up_display: { options: { enabled?: string } }
		toggle_is_time_up_display: { options: Record<string, never> }
		delete_all_messages: { options: { confirm?: boolean } }
		delete_all_sessions: { options: { confirm?: boolean } }
	}
	feedbacks: {
		is_connected: { type: 'boolean'; options: Record<string, never> }
		is_playing: { type: 'boolean'; options: Record<string, never> }
		is_paused: { type: 'boolean'; options: Record<string, never> }
		is_idle: { type: 'boolean'; options: Record<string, never> }
		is_glowing: { type: 'boolean'; options: Record<string, never> }
		is_blackout: { type: 'boolean'; options: Record<string, never> }
		is_flashing: { type: 'boolean'; options: Record<string, never> }
		has_previous_session: { type: 'boolean'; options: Record<string, never> }
		no_previous_session: { type: 'boolean'; options: Record<string, never> }
		has_next_session: { type: 'boolean'; options: Record<string, never> }
		no_next_session: { type: 'boolean'; options: Record<string, never> }
		message_showing: { type: 'boolean'; options: Record<string, never> }
		is_time_up_display: { type: 'boolean'; options: Record<string, never> }
		is_time_up_flashing: { type: 'boolean'; options: Record<string, never> }
		progress_bar: {
			type: 'advanced'
			options: {
				bar_color?: number
				track_color?: number
				thickness?: number
				edge?: string
				show_percentage?: boolean
			}
		}
	}
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

		const { host, port: portText } = getEffectiveEndpoint(this.config)
		if (!host) {
			// No address yet is a configuration problem, not a network failure: connecting
			// to `ws://:8081` just throws "Invalid URL" on every retry and fills the log.
			this.client = null
			this.updateStatus(InstanceStatus.BadConfig, 'Select a discovered display or enter an IP address')
			return
		}

		const port = Number(portText || DEFAULT_PORT)

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
				isVisibleExpression: '$(options:cuetime-display) == null',
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port (manual)',
				width: 4,
				regex: Regex.PORT,
				default: '8081',
				isVisibleExpression: '$(options:cuetime-display) == null',
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
