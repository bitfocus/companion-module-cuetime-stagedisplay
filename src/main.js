const { InstanceBase, Regex, runEntrypoint, InstanceStatus, HTTPRequest } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config

		this.updateStatus(InstanceStatus.Ok)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')
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
			const response = await HTTPRequest(this, {
				method: 'POST',
				url: url,
				headers: {
					'Content-Type': 'application/json',
				},
				json: body,
			})

			if (response && response.success === false) {
				this.log('error', `Command failed: ${response.message || 'Unknown error'}`)
				return false
			}

			return true
		} catch (error) {
			this.log('error', `HTTP request failed: ${error.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure)
			return false
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
