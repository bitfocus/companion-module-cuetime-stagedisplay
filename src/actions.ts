import { ModuleInstance } from './main.js'

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		navigate_next_session: {
			name: 'Navigate to Next Session',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('navigate_next_session')
			},
		},
		navigate_previous_session: {
			name: 'Navigate to Previous Session',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('navigate_previous_session')
			},
		},
		resume_timer: {
			name: 'Resume',
			options: [],
			callback: async (event: any) => {
				self.sendCommand('start_timer')
			},
		},
		toggle_playback: {
			name: 'Toggle Playback',
			options: [],
			callback: async (event: any) => {
				if (self.latestStatus?.control_center?.is_playing) {
					await self.sendCommand('pause_timer')
				} else {
					await self.sendCommand('start_timer')
				}
			},
		},
		pause_timer: {
			name: 'Pause Timer',
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
		subtract_time: {
			name: 'Subtract Time',
			options: [
				{
					type: 'number',
					id: 'seconds',
					label: 'Seconds to subtract',
					default: 30,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event: any) => {
				self.sendCommand('subtract_time', { seconds: event.options.seconds })
			},
		},
		blackout: {
			name: 'Blackout',
			options: [
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					default: 'enable',
					choices: [
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('blackout', { action: event.options.action })
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
					default: 'disable',
					choices: [
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' },
					],
				},
			],
			callback: async (event: any) => {
				self.sendCommand('show_message', {
					text: event.options.text,
					flash: event.options.flash === 'enable',
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
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID (optional)',
					default: '',
				},
				{
					type: 'number',
					id: 'flash_start_time_seconds',
					label: 'Flash Start (seconds, optional)',
					default: 0,
					min: 0,
					max: 86400,
				},
				{
					type: 'number',
					id: 'flash_length_seconds',
					label: 'Flash Length (seconds, optional)',
					default: 0,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event: any) => {
				self.sendCommand('setup_timer', {
					seconds: event.options.seconds,
					mode: event.options.mode,
					timer_state: event.options.timer_state,
					...(event.options.session_id ? { session_id: event.options.session_id } : {}),
					...(event.options.flash_start_time_seconds ? { flash_start_time_seconds: event.options.flash_start_time_seconds } : {}),
					...(event.options.flash_length_seconds ? { flash_length_seconds: event.options.flash_length_seconds } : {}),
				})
			},
		},
	})
}
