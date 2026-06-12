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
	blackoutToggle: boolean
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
	public blackoutToggle: boolean = false
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

			// Try to parse the API response body for error details
			let data: ApiResponse | null = null
			try {
				data = (await response.json()) as ApiResponse
			} catch {
				// Response body is not valid JSON — ignore
			}

			// Check API-level errors first (success: false with a message)
			if (data && data.success === false) {
				this.log('warn', `Command '${commandType}' rejected: ${data.message || data.code || 'Unknown error'}`)
				return false
			}

			// Check HTTP-level errors
			if (!response.ok) {
				const level = response.status >= 500 ? 'error' : 'warn'
				this.log(level, `Command '${commandType}' failed: ${response.status} ${response.statusText}`)
				if (response.status >= 500) {
					this.connected = false
					this.updateStatus(InstanceStatus.ConnectionFailure)
					this.checkFeedbacks('is_connected')
				}
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

			// Fetch session info from the lighter sessions endpoint
			let total_sessions = 0
			let previous_session_name = ''
			let next_session_name = ''
			let previous_session_presenter_name = ''
			let next_session_presenter_name = ''
			if (sessionsResponse.ok) {
				try {
					const sessionsBody = (await sessionsResponse.json()) as Record<string, unknown>
					// Handle multiple possible response formats
					const rawList = (sessionsBody?.sessions as any)?.session_list ?? sessionsBody?.session_list ?? []
					const sessionList = Array.isArray(rawList) ? (rawList as Array<Record<string, unknown>>) : []
					total_sessions = sessionList.length

					if (total_sessions > 0) {
						const cc = data?.control_center
						const currentIndex = cc?.current_session_index ?? -1

						if (currentIndex > 0) {
							const prev = sessionList[currentIndex - 1]
							previous_session_name = (prev?.session_name as string) || ''
							previous_session_presenter_name = (prev?.presenter_name as string) || ''
						}
						if (currentIndex >= 0 && currentIndex < total_sessions - 1) {
							const next = sessionList[currentIndex + 1]
							next_session_name = (next?.session_name as string) || ''
							next_session_presenter_name = (next?.presenter_name as string) || ''
						}
					}
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
					previous_session_name,
					next_session_name,
					previous_session_presenter_name,
					next_session_presenter_name,
				})

				// Sync local toggle state with actual device state
				this.blackoutToggle = !!cc.is_blackout

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
