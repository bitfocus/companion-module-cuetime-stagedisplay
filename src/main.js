const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config, isFirstInit) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()

		this.updateVariables()
		this.variableInterval = setInterval(() => this.updateVariables(), 5000)
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')
		if (this.variableInterval) {
			clearInterval(this.variableInterval)
		}
	}

	async configUpdated(config) {
		this.config = config
	}

	async sendCommand(commandType, params = {}) {
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

			const data = await response.json()

			if (data && data.success === false) {
				this.log('error', `Command failed: ${data.message || 'Unknown error'}`)
				return false
			}

			this.updateStatus(InstanceStatus.Ok)
			return true
		} catch (error) {
			this.log('error', `HTTP request failed: ${error.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure)
			return false
		}
	}

	async updateVariables() {
		const url = `http://${this.config.host}:${this.config.port}/api/status?detailed=false`

		try {
			const response = await fetch(url)

			if (!response.ok) {
				this.log('error', `Status request failed: ${response.status} ${response.statusText}`)
				return
			}

			const data = await response.json()

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
					message_text: view.message_text || '',
				})
			}
		} catch (error) {
			this.log('debug', `Status update failed: ${error.message}`)
		}
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Target IP',
				width: 8,
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Target Port',
				width: 4,
				regex: Regex.PORT,
				default: '8080',
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
