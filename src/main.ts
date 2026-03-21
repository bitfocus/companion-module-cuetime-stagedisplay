import {
	InstanceBase,
	Regex,
	runEntrypoint,
	InstanceStatus,
	SomeCompanionConfigField,
	CompanionInputFieldTextInput,
} from '@companion-module/base'
import { UpgradeScripts } from './upgrades'
import { UpdateActions } from './actions'
import { UpdateFeedbacks } from './feedbacks'
import { UpdateVariableDefinitions } from './variables'

export interface Config {
	host: string
	port: string
}

interface ApiResponse {
	success?: boolean
	message?: string
	control_center?: {
		elapsed_time: number
		timer: number
		current_session_name: string
		current_presenter_name: string
		is_playing: boolean
		is_glowing: boolean
		is_blackout: boolean
	}
	view?: {
		message_text: string
	}
}

export interface ModuleInstance extends InstanceBase<Config> {
	config: Config
	variableInterval?: NodeJS.Timeout
	sendCommand(commandType: string, params?: Record<string, unknown>): Promise<boolean>
	updateActions(): void
	updateFeedbacks(): void
	updateVariableDefinitions(): void
}

class ModuleInstanceImpl extends InstanceBase<Config> implements ModuleInstance {
	public config!: Config
	public variableInterval?: NodeJS.Timeout

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: Config, isFirstInit: boolean): Promise<void> {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()

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
		const url = `http://${this.config.host}:${this.config.port}/api/command`
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
				this.updateStatus(InstanceStatus.ConnectionFailure)
				return false
			}

			const data = (await response.json()) as ApiResponse

			if (data && data.success === false) {
				this.log('error', `Command failed: ${data.message || 'Unknown error'}`)
				return false
			}

			this.updateStatus(InstanceStatus.Ok)
			return true
		} catch (error) {
			this.log('error', `HTTP request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
			this.updateStatus(InstanceStatus.ConnectionFailure)
			return false
		}
	}

	async updateVariables(): Promise<void> {
		const url = `http://${this.config.host}:${this.config.port}/api/status?detailed=false`

		try {
			const response = await fetch(url)

			if (!response.ok) {
				this.log('error', `Status request failed: ${response.status} ${response.statusText}`)
				return
			}

			const data = (await response.json()) as ApiResponse

			if (data && data.success && data.control_center) {
				const cc = data.control_center
				const view = data.view

				this.setVariableValues({
					elapsed_time: cc.elapsed_time || 0,
					timer: cc.timer || 0,
					current_session_name: cc.current_session_name || '',
					current_presenter_name: cc.current_presenter_name || '',
					is_playing: cc.is_playing ? 'Yes' : 'No',
					is_glowing: cc.is_glowing ? 'Yes' : 'No',
					is_blackout: cc.is_blackout ? 'Yes' : 'No',
					message_text: view?.message_text || '',
				})
			}
		} catch (error) {
			this.log('debug', `Status update failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP,
			} as CompanionInputFieldTextInput & { width: number },
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 4,
				regex: Regex.PORT,
				default: '8080',
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
}

runEntrypoint(ModuleInstanceImpl, UpgradeScripts)
