import { ModuleInstance } from './main'

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		navigate_next_event: {
			name: 'Navigate to Next Session',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('navigate_next_event')
			},
		},
		navigate_previous_event: {
			name: 'Navigate to Previous Session',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('navigate_previous_event')
			},
		},
		resume_timer: {
			name: 'Resume',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('start_timer')
			},
		},
		pause_timer: {
			name: 'Pause/Resume Timer',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('pause_timer')
			},
		},
		add_time: {
			name: 'Add Time',
			options: [
				{
					type: 'number',
					id: 'seconds',
					label: 'Seconds to add',
					default: 60,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event: any) => {
				self.sendCommand('add_time', { seconds: event.options.seconds })
			},
		},

		blackout: {
			name: 'Blackout',
			options: [
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Enable',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('blackout', { enabled: event.options.enabled === 'true' })
			},
		},
		set_glow: {
			name: 'Set Glow',
			options: [
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Enable',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('set_glow', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_glow: {
			name: 'Toggle Glow',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('toggle_glow')
			},
		},
		set_flash: {
			name: 'Set Flash',
			options: [
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Enable',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('set_flash', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_flash: {
			name: 'Toggle Flash',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('toggle_flash')
			},
		},
		show_message: {
			name: 'Show Message',
			options: [
				{
					type: 'textinput',
					id: 'text',
					label: 'Message text',
					default: 'Break Time',
				},
				{
					type: 'dropdown',
					id: 'flash',
					label: 'Flash',
					default: 'false',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('show_message', {
					text: event.options.text,
					flash: event.options.flash === 'true',
				})
			},
		},
		hide_display: {
			name: 'Hide Display',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('hide_display')
			},
		},
		show_idle: {
			name: 'Show Idle Screen',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('show_idle')
			},
		},
		start_timer: {
			name: 'Start Timer',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('start_timer')
			},
		},
		setup_timer: {
			name: 'Setup Timer',
			options: [
				{
					type: 'number',
					id: 'seconds',
					label: 'Duration (seconds)',
					default: 300,
					min: 0,
					max: 86400,
				},
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: 'countdown',
					choices: [
						{ id: 'countdown', label: 'Countdown' },
						{ id: 'countup', label: 'Countup' },
						{ id: 'time_of_day', label: 'Time of Day' },
					],
				},
				{
					type: 'dropdown',
					id: 'timer_state',
					label: 'Initial State',
					default: 'running',
					choices: [
						{ id: 'running', label: 'Running' },
						{ id: 'paused', label: 'Paused' },
						{ id: 'stopped', label: 'Stopped' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('setup_timer', {
					seconds: event.options.seconds,
					mode: event.options.mode,
					timer_state: event.options.timer_state,
				})
			},
		},
	})
}
