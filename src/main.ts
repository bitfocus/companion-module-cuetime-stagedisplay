import {
	InstanceBase,
	Regex,
	InstanceStatus,
	InstanceTypes,
	SomeCompanionConfigField,
	CompanionInputFieldTextInput,
} from '@companion-module/base'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpdatePresets } from './presets.js'
import { getEffectiveHost, getEffectivePort, formatTime } from './logic.js'
import type { ApiResponse } from './logic.js'
import type { JsonObject } from '@companion-module/base'

export interface Config extends JsonObject {
	host: string
	port: string
	'cuetime-display': string | null
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ModuleInstanceTypes extends InstanceTypes {
	config: Config
	secrets: undefined
}

export interface ModuleInstance extends InstanceBase<ModuleInstanceTypes> {
	config: Config
	latestStatus: ApiResponse | null
	connected: boolean
	lastShownMessage: string | null
	variableInterval?: ReturnType<typeof setInterval>
	sendCommand(commandType: string, params?: Record<string, unknown>): Promise<boolean>
	updateActions(): void
	updateFeedbacks(): void
	updateVariableDefinitions(): void
	updatePresets(): void
}

class ModuleInstanceImpl extends InstanceBase<ModuleInstanceTypes> implements ModuleInstance {
	public config!: Config
	public latestStatus: ApiResponse | null = null
	public connected: boolean = false
	public lastShownMessage: string | null = null
	public variableInterval?: ReturnType<typeof setInterval>

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: Config, isFirstInit: boolean): Promise<void> {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()

		this.updateVariables()
		this.variableInterval = setInterval(() => this.updateVariables(), 5000)
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		if (this.variableInterval) {
			clearInterval(this.variableInterval)
		}
	}

	async configUpdated(config: Config): Promise<void> {
		this.config = config
	}

	async sendCommand(commandType: string, params: Record<string, unknown> = {}): Promise<boolean> {
		const url = `http://${this.resolveHost()}:${this.resolvePort()}/api/command`
		const body = {
			type: commandType,
			...params,
		}

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			})

			if (!response.ok) {
				this.log('error', `HTTP request failed: ${response.status} ${response.statusText}`)
				this.connected = false
				this.updateStatus(InstanceStatus.ConnectionFailure)
				this.checkFeedbacks('is_connected')
				return false
			}

			const data = (await response.json()) as ApiResponse

			if (data && data.success === false) {
				this.log('error', `Command failed: ${data.message || 'Unknown error'}`)
				return false
			}

			this.connected = true
			this.updateStatus(InstanceStatus.Ok)
			this.checkFeedbacks('is_connected')
			return true
		} catch (error) {
			this.log('error', `HTTP request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
			this.connected = false
			this.updateStatus(InstanceStatus.ConnectionFailure)
			this.checkFeedbacks('is_connected')
			return false
		}
	}

	async updateVariables(): Promise<void> {
		const host = this.resolveHost()
		const port = this.resolvePort()
		const statusUrl = `http://${host}:${port}/api/status`
		const sessionsUrl = `http://${host}:${port}/api/status/sessions`

		try {
			const [statusResponse, sessionsResponse] = await Promise.all([
				fetch(statusUrl),
				fetch(sessionsUrl),
			])

			if (!statusResponse.ok) {
				this.log('error', `Status request failed: ${statusResponse.status} ${statusResponse.statusText}`)
				this.connected = false
				this.checkFeedbacks('is_connected')
				return
			}

			const data = (await statusResponse.json()) as ApiResponse

			// Fetch session count from the lighter sessions endpoint
			let total_sessions = 0
			if (sessionsResponse.ok) {
				try {
					const sessionsData = (await sessionsResponse.json()) as { session_list?: unknown[] }
					total_sessions = sessionsData?.session_list?.length || 0
				} catch {
					// Ignore sessions parse errors
				}
			}

			if (data && data.success && data.control_center) {
				const cc = data.control_center
				const view = data.view

				this.latestStatus = data

				const current_session_number = cc.current_session_index !== undefined ? cc.current_session_index + 1 : 0

				this.setVariableValues({
					elapsed_time: cc.elapsed_time || 0,
					timer: cc.timer || 0,
					current_session_name: cc.current_session_name || '',
					current_presenter_name: cc.current_presenter_name || '',
					is_playing: cc.is_playing ? 'Yes' : 'No',
					is_glowing: cc.is_glowing ? 'Yes' : 'No',
					is_blackout: cc.is_blackout ? 'Yes' : 'No',
					message_text: view?.message_text || '',
					current_session_number,
					total_sessions,
					elapsed_formatted: formatTime(view?.elapsed_time ?? cc.elapsed_time),
					remaining_formatted: formatTime(cc.timer),
				})

				this.checkFeedbacks(
					'is_playing',
					'is_glowing',
					'is_blackout',
					'is_flashing',
					'has_previous_session',
					'has_next_session',
					'message_showing',
					'is_connected',
					'is_time_up_display'
				)
			}
			this.connected = true
			this.checkFeedbacks('is_connected')
		} catch (error) {
			this.log('debug', `Status update failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
			this.connected = false
			this.checkFeedbacks('is_connected')
		}
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
			} as CompanionInputFieldTextInput & { width: number },
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port (manual)',
				width: 4,
				regex: Regex.PORT,
				default: '8080',
				isVisibleExpression: '$(cuetime-display:cuetime-display) == null',
			} as CompanionInputFieldTextInput & { width: number },
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
