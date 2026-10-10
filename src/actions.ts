import type { ModuleInstance } from './main.ts'
import type { CommandPayloads } from './protocol/generated.ts'

/**
 * Companion hands action callbacks a loosely-typed options bag. Typing the
 * parameter this way keeps the reads below honest without threading the
 * per-action option generics through every definition.
 */
type ActionEvent = { options: Record<string, any> }

/**
 * Converts the action's user-facing seconds into the whole milliseconds the
 * protocol's `ms` field wants. `add_time` / `subtract_time` still accept the
 * older `seconds` field, but it is deprecated and ignored whenever `ms` is
 * nonzero, so `ms` is the only field worth sending.
 */
function toWholeMs(seconds: unknown): number {
	const value = Number(seconds ?? 0)
	return Number.isFinite(value) ? Math.round(value * 1000) : 0
}

/**
 * Parses `HH:MM` / `HH:MM:SS` into milliseconds past midnight, or null if invalid.
 *
 * The protocol's `time_of_day` `offset` is an integer count of **milliseconds**
 * past midnight (still always a whole number of seconds in practice).
 */
function parseTimeOfDayOffsetMs(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
	if (!match) return null

	const hours = Number(match[1])
	const minutes = Number(match[2])
	const seconds = Number(match[3] ?? 0)
	if (hours > 23 || minutes > 59 || seconds > 59) return null

	return (hours * 3600 + minutes * 60 + seconds) * 1000
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		navigate_next_session: {
			name: 'Navigate to Next Session',
			options: [],
			callback: async () => {
				// The device reports whether navigation is actually available.
				if (self.state.controlCenter?.is_next_session !== true) return
				await self.sendCommand('navigate_next_session')
			},
		},
		navigate_previous_session: {
			name: 'Navigate to Previous Session',
			options: [],
			callback: async () => {
				if (self.state.controlCenter?.is_previous_session !== true) return
				await self.sendCommand('navigate_previous_session')
			},
		},
		toggle_playback: {
			name: 'Toggle Playback',
			options: [],
			callback: async () => {
				// `timer_run_state` distinguishes paused from idle, which `is_playing` could not.
				if (self.state.controlCenter?.timer_run_state === 'running') {
					await self.sendCommand('pause_session')
				} else {
					await self.sendCommand('start_session')
				}
			},
		},
		start_session: {
			name: 'Start / Resume Session',
			options: [],
			callback: async () => {
				await self.sendCommand('start_session')
			},
		},
		pause_session: {
			name: 'Pause Session',
			options: [],
			callback: async () => {
				await self.sendCommand('pause_session')
			},
		},
		reset_current_session: {
			name: 'Reset Current Session',
			options: [],
			callback: async () => {
				await self.sendCommand('reset_current_session')
			},
		},
		reset_program_elapsed_timer: {
			name: 'Reset Program Elapsed Timer',
			options: [],
			callback: async () => {
				await self.sendCommand('reset_program_elapsed_timer')
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
			callback: async (event: ActionEvent) => {
				await self.sendCommand('add_time', { ms: toWholeMs(event.options.seconds) })
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
			callback: async (event: ActionEvent) => {
				await self.sendCommand('subtract_time', { ms: toWholeMs(event.options.seconds) })
			},
		},
		add_session: {
			name: 'Add Session',
			options: [
				{
					type: 'textinput',
					id: 'name',
					label: 'Session name',
					default: '',
				},
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: 'countdown',
					choices: [
						{ id: 'countdown', label: 'Countdown' },
						{ id: 'countup', label: 'Count-up' },
						{ id: 'time_of_day', label: 'Time of Day' },
					],
				},
				{
					type: 'number',
					id: 'seconds',
					label: 'Duration (seconds, countdown / count-up)',
					default: 300,
					min: 0,
					max: 86400,
				},
				{
					type: 'textinput',
					id: 'offset',
					label: 'Offset HH:MM:SS (time of day only)',
					default: '00:00:00',
					tooltip: 'Where the wall clock display starts; 00:00:00–23:59:59.',
				},
				{
					type: 'textinput',
					id: 'presenter_name',
					label: 'Presenter name (optional)',
					default: '',
				},
				{
					type: 'textinput',
					id: 'notes',
					label: 'Notes (optional)',
					default: '',
				},
				{
					type: 'number',
					id: 'flash_start_time_seconds',
					label: 'Flash start (seconds, optional)',
					default: 0,
					min: 0,
					max: 86400,
				},
				{
					type: 'number',
					id: 'flash_length_seconds',
					label: 'Flash length (seconds, optional)',
					default: 0,
					min: 0,
					max: 86400,
				},
				{
					type: 'checkbox',
					id: 'start',
					label: 'Start the session once it has been added',
					default: false,
				},
			],
			callback: async (event: ActionEvent) => {
				const mode = String(event.options.mode ?? 'countdown')
				const payload: CommandPayloads['add_session'] = { mode }

				const name = String(event.options.name ?? '').trim()
				if (name) payload.name = name

				const presenter = String(event.options.presenter_name ?? '').trim()
				if (presenter) payload.presenter_name = presenter

				const notes = String(event.options.notes ?? '').trim()
				if (notes) payload.notes = notes

				if (mode === 'time_of_day') {
					const offset = parseTimeOfDayOffsetMs(String(event.options.offset ?? ''))
					if (offset === null) {
						self.log('warn', 'Add session: offset must be HH:MM:SS within 00:00:00–23:59:59; nothing sent')
						return
					}
					payload.offset = offset
				} else {
					const seconds = Number(event.options.seconds ?? 0)
					if (!Number.isFinite(seconds) || seconds < 0) {
						self.log('warn', 'Add session: duration must be a non-negative number of seconds; nothing sent')
						return
					}
					// The device rejects a countdown shorter than one second.
					if (mode === 'countdown' && seconds < 1) {
						self.log('warn', 'Add session: a countdown needs at least 1 second; nothing sent')
						return
					}
					payload.seconds = seconds
				}

				const flashStart = Number(event.options.flash_start_time_seconds ?? 0)
				if (flashStart > 0) payload.flash_start_time_seconds = flashStart

				const flashLength = Number(event.options.flash_length_seconds ?? 0)
				if (flashLength > 0) payload.flash_length_seconds = flashLength

				const result = await self.sendCommandDetailed('add_session', payload)
				if (!result.ok) {
					self.log('warn', `Add session failed: ${result.code ?? 'error'}`)
					return
				}

				if (event.options.start !== true) return

				// `add_session` replies with the new session id on `entity_id`.
				const sessionId = result.response?.type === 'ack_response' ? (result.response.entity_id ?? null) : null
				await self.sendCommand('start_session', sessionId ? { session_id: sessionId } : {})
			},
		},
		show_session: {
			name: 'Show Session by ID',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const sessionId = String(event.options.session_id ?? '').trim()
				if (!sessionId) {
					self.log('warn', 'Show session: a session id is required; nothing sent')
					return
				}
				await self.sendCommand('show_session', { session_id: sessionId })
			},
		},
		move_session_up: {
			name: 'Move Session Up',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const sessionId = String(event.options.session_id ?? '').trim()
				if (!sessionId) return
				await self.sendCommand('move_session_up', { session_id: sessionId })
			},
		},
		move_session_down: {
			name: 'Move Session Down',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const sessionId = String(event.options.session_id ?? '').trim()
				if (!sessionId) return
				await self.sendCommand('move_session_down', { session_id: sessionId })
			},
		},
		blackout: {
			name: 'Blackout',
			options: [
				{
					type: 'dropdown',
					id: 'action',
					label: 'Action',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' },
					],
				},
			],
			callback: async (event: ActionEvent) => {
				const action = String(event.options.action ?? 'toggle')
				// `set_blackout` has no toggle form, so resolve one from reported state.
				const enabled =
					action === 'enable' ? true : action === 'disable' ? false : !(self.state.controlCenter?.is_blackout ?? false)

				await self.sendCommand('set_blackout', { action: enabled ? 'enable' : 'disable' })
			},
		},
		set_glow: {
			name: 'Set Glow',
			options: [
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Glow',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: ActionEvent) => {
				await self.sendCommand('set_glow', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_glow: {
			name: 'Toggle Glow',
			options: [],
			callback: async () => {
				await self.sendCommand('toggle_glow')
			},
		},
		set_flash: {
			name: 'Set Flash',
			options: [
				{
					type: 'dropdown',
					id: 'action',
					label: 'Flash',
					default: 'enable',
					choices: [
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event: ActionEvent) => {
				const action = String(event.options.action ?? 'enable')
				await self.sendCommand('set_flash', { action })
			},
		},
		toggle_flash: {
			name: 'Toggle Flash',
			options: [],
			callback: async () => {
				await self.sendCommand('toggle_flash')
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
					label: 'Flash the message',
					default: 'disable',
					choices: [
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' },
					],
				},
			],
			callback: async (event: ActionEvent) => {
				// Pressing again takes the message down, so one button can toggle it.
				if (self.state.view?.message_text) {
					await self.sendCommand('hide_message')
					return
				}

				const text = String(event.options.text ?? '')
				if (!text) {
					self.log('warn', 'Show message: message text is empty; nothing sent')
					return
				}

				await self.sendCommand('show_message', { text, flash: event.options.flash === 'enable' })
			},
		},
		hide_message: {
			name: 'Hide Message',
			options: [],
			callback: async () => {
				await self.sendCommand('hide_message')
			},
		},
		show_idle: {
			name: 'Show Idle Screen',
			options: [],
			callback: async () => {
				await self.sendCommand('show_idle')
			},
		},
		set_brightness: {
			name: 'Set Brightness',
			options: [
				{
					type: 'number',
					id: 'brightness',
					label: 'Brightness (0-100)',
					default: 100,
					min: 0,
					max: 100,
				},
			],
			callback: async (event: ActionEvent) => {
				const brightness = Number(event.options.brightness ?? 0)
				// The device rejects fractional or out-of-range values outright.
				if (!Number.isInteger(brightness) || brightness < 0 || brightness > 100) {
					self.log('warn', 'Set brightness: brightness must be a whole number from 0 to 100; nothing sent')
					return
				}
				await self.sendCommand('set_brightness', { brightness })
			},
		},
		set_is_time_up_display: {
			name: 'Set Time-is-Up Display',
			options: [
				{
					type: 'dropdown',
					id: 'enabled',
					label: 'Time-is-up display',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
			],
			callback: async (event: ActionEvent) => {
				await self.sendCommand('set_is_time_up_display', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_is_time_up_display: {
			name: 'Toggle Time-is-Up Display',
			options: [],
			callback: async () => {
				await self.sendCommand('toggle_is_time_up_display')
			},
		},
		delete_all_messages: {
			name: 'Delete All Messages',
			options: [
				{
					type: 'checkbox',
					id: 'confirm',
					label: 'Confirm: remove every message from the program',
					default: false,
				},
			],
			callback: async (event: ActionEvent) => {
				if (event.options.confirm !== true) {
					self.log('warn', 'Delete all messages: not confirmed; nothing sent')
					return
				}
				await self.sendCommand('delete_all_messages')
			},
		},
		delete_all_sessions: {
			name: 'Delete All Sessions',
			options: [
				{
					type: 'checkbox',
					id: 'confirm',
					label: 'Confirm: remove every session from the program',
					default: false,
				},
			],
			callback: async (event: ActionEvent) => {
				if (event.options.confirm !== true) {
					self.log('warn', 'Delete all sessions: not confirmed; nothing sent')
					return
				}
				await self.sendCommand('delete_all_sessions')
			},
		},
	})
}
