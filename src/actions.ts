import type { ModuleInstance } from './main.ts'
import {
	MODE_KEEP,
	buildAddMessage,
	buildAddSession,
	buildBrightness,
	buildDeleteMessage,
	buildDeleteSession,
	buildMessageMove,
	buildSessionMove,
	buildShowMessage,
	buildShowSession,
	buildStartSession,
	buildTimeDelta,
	buildUpdateMessage,
	buildUpdateSession,
	isMessageShowing,
	planNavigation,
} from './payloads.ts'
import { isCurrentSessionTimeOfDay } from './logic.ts'

/**
 * Companion hands action callbacks a loosely-typed options bag. Typing the
 * parameter this way keeps the reads below honest without threading the
 * per-action option generics through every definition.
 */
type ActionEvent = { options: Record<string, any> }

/**
 * Logs and reports whether a command should be skipped because the current session is
 * a Time of Day wall clock.
 *
 * A wall clock has no pause and no length, so vc146 refuses `pause_session`,
 * `add_time`, `subtract_time` and `reset_current_session` against one. Sending them
 * anyway means the operator's button does nothing and the only trace is a `warn`
 * nobody reads, so skip locally with an explanatory log instead.
 *
 * Guarding is based on *positive* knowledge: this only skips when the device has told
 * us the current session's mode, never merely because the state has not arrived yet.
 */
function skipForTimeOfDay(self: ModuleInstance, what: string): boolean {
	if (!isCurrentSessionTimeOfDay(self.state)) return false
	self.log('debug', `${what}: the current session is a Time of Day wall clock; nothing sent`)
	return true
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		navigate_next_session: {
			name: 'Navigate to Next Session',
			options: [],
			callback: async () => {
				// `navigate_*` needs a current session; from idle this selects the first one.
				const plan = planNavigation(self.state, 'next')
				if (!plan.ok) {
					self.log('debug', `Navigate next: ${plan.reason}; nothing sent`)
					return
				}
				if (plan.command === 'show_session') {
					self.sendCommand('show_session', { session_id: plan.sessionId })
					return
				}
				self.sendCommand('navigate_next_session')
			},
		},
		navigate_previous_session: {
			name: 'Navigate to Previous Session',
			options: [],
			callback: async () => {
				const plan = planNavigation(self.state, 'previous')
				if (!plan.ok) {
					self.log('debug', `Navigate previous: ${plan.reason}; nothing sent`)
					return
				}
				if (plan.command === 'show_session') {
					self.sendCommand('show_session', { session_id: plan.sessionId })
					return
				}
				self.sendCommand('navigate_previous_session')
			},
		},
		toggle_playback: {
			name: 'Toggle Playback',
			options: [],
			callback: async () => {
				if (skipForTimeOfDay(self, 'Toggle playback')) return
				// `timer_run_state` distinguishes paused from idle, which `is_playing` could not.
				if (self.state.controlCenter?.timer_run_state === 'running') {
					self.sendCommand('pause_session')
				} else {
					self.sendCommand('start_session')
				}
			},
		},
		start_session: {
			name: 'Start / Resume Session',
			options: [],
			callback: async () => {
				// From idle this names the first session, so Play actually starts the show.
				const built = buildStartSession(self.state)
				if (!built.ok) {
					self.log('debug', `Start session: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('start_session', built.payload)
			},
		},
		pause_session: {
			name: 'Pause Session',
			options: [],
			callback: async () => {
				if (skipForTimeOfDay(self, 'Pause session')) return
				self.sendCommand('pause_session')
			},
		},
		reset_current_session: {
			name: 'Reset Current Session',
			options: [],
			callback: async () => {
				if (skipForTimeOfDay(self, 'Reset current session')) return
				self.sendCommand('reset_current_session')
			},
		},
		reset_program_elapsed_timer: {
			name: 'Reset Program Elapsed Timer',
			options: [],
			callback: async () => {
				self.sendCommand('reset_program_elapsed_timer')
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
				if (skipForTimeOfDay(self, 'Add time')) return
				const built = buildTimeDelta(event.options.seconds)
				if (!built.ok) {
					self.log('warn', `Add time: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('add_time', built.payload)
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
				if (skipForTimeOfDay(self, 'Subtract time')) return
				const built = buildTimeDelta(event.options.seconds)
				if (!built.ok) {
					self.log('warn', `Subtract time: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('subtract_time', built.payload)
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
				const built = buildAddSession({
					name: event.options.name,
					mode: event.options.mode,
					seconds: event.options.seconds,
					offset: event.options.offset,
					presenterName: event.options.presenter_name,
					notes: event.options.notes,
					flashStartSeconds: event.options.flash_start_time_seconds,
					flashLengthSeconds: event.options.flash_length_seconds,
				})
				if (!built.ok) {
					self.log('warn', `Add session: ${built.reason}; nothing sent`)
					return
				}

				void self.sendCommandDetailed('add_session', built.payload).then((result) => {
					if (!result.ok) {
						self.log('warn', `Add session failed: ${result.code ?? 'error'}`)
						return
					}

					if (event.options.start !== true) return

					// `add_session` replies with the new session id on `entity_id`.
					const sessionId = result.response?.type === 'ack_response' ? (result.response.entity_id ?? null) : null
					self.sendCommand('start_session', sessionId ? { session_id: sessionId } : {})
				})
			},
		},
		show_session: {
			name: 'Show Session',
			options: [
				{
					type: 'number',
					id: 'session_number',
					label: 'Session number (1 = first)',
					default: 1,
					min: 1,
					max: 999,
					tooltip:
						'Selects a session by its position in the program. This is the only way in: start and navigate need a current session, and the device has no fallback to the first.',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildShowSession(self.state, event.options.session_number)
				if (!built.ok) {
					self.log('warn', `Show session: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('show_session', built.payload)
			},
		},
		move_session_up: {
			name: 'Move Session Up',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID (blank = current session)',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildSessionMove(self.state, event.options.session_id, 'up')
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Move session up: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('move_session_up', built.payload)
			},
		},
		move_session_down: {
			name: 'Move Session Down',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID (blank = current session)',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildSessionMove(self.state, event.options.session_id, 'down')
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Move session down: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('move_session_down', built.payload)
			},
		},
		delete_session: {
			name: 'Delete Session',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID (blank = current session)',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildDeleteSession(self.state, event.options.session_id)
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Delete session: ${built.reason}; nothing sent`)
					return
				}
				// Deleting a paused/idle *current* session also returns the display to idle.
				self.sendCommand('delete_session', built.payload)
			},
		},
		update_session: {
			name: 'Update Session',
			options: [
				{
					type: 'textinput',
					id: 'session_id',
					label: 'Session ID (blank = current session)',
					default: '',
				},
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: MODE_KEEP,
					choices: [
						{ id: MODE_KEEP, label: 'Leave unchanged' },
						{ id: 'countdown', label: 'Countdown' },
						{ id: 'countup', label: 'Count-up' },
						{ id: 'time_of_day', label: 'Time of Day' },
					],
				},
				{
					type: 'textinput',
					id: 'seconds',
					label: 'Duration in seconds (blank = leave unchanged)',
					default: '',
					tooltip: 'A countdown must end up at least 1 second long.',
				},
				{
					type: 'textinput',
					id: 'offset',
					label: 'Offset HH:MM:SS (blank = leave unchanged; time of day only)',
					default: '',
				},
				{
					type: 'textinput',
					id: 'name',
					label: 'Session name (blank = leave unchanged)',
					default: '',
				},
				{
					type: 'textinput',
					id: 'presenter_name',
					label: 'Presenter name (blank = leave unchanged)',
					default: '',
				},
				{
					type: 'textinput',
					id: 'notes',
					label: 'Notes (blank = leave unchanged)',
					default: '',
				},
				{
					type: 'number',
					id: 'flash_start_time_seconds',
					label: 'Flash start (seconds, 0 = leave unchanged)',
					default: 0,
					min: 0,
					max: 86400,
				},
				{
					type: 'number',
					id: 'flash_length_seconds',
					label: 'Flash length (seconds, 0 = leave unchanged)',
					default: 0,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildUpdateSession(self.state, {
					sessionId: event.options.session_id,
					mode: event.options.mode,
					seconds: event.options.seconds,
					offset: event.options.offset,
					name: event.options.name,
					presenterName: event.options.presenter_name,
					notes: event.options.notes,
					flashStartSeconds: event.options.flash_start_time_seconds,
					flashLengthSeconds: event.options.flash_length_seconds,
				})
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Update session: ${built.reason}; nothing sent`)
					return
				}

				void self.sendCommandDetailed('update_session', built.payload).then((result) => {
					if (!result.ok) {
						self.log('warn', `Update session failed: ${result.code ?? 'error'} — ${result.message ?? ''}`)
						return
					}

					// Editing the current session re-arms it, discarding any paused position. The
					// device says so in the ack message, and vc146 expects the integrator to pass
					// that on because the API has no dialog to confirm in.
					const message = result.response?.type === 'ack_response' ? result.response.message : null
					self.log('info', `Session updated${message ? ` — ${message}` : ''}`)
				})
			},
		},
		add_message: {
			name: 'Add Message',
			options: [
				{
					type: 'textinput',
					id: 'content',
					label: 'Message text',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildAddMessage(event.options.content)
				if (!built.ok) {
					self.log('warn', `Add message: ${built.reason}; nothing sent`)
					return
				}

				void self.sendCommandDetailed('add_message', built.payload).then((result) => {
					if (!result.ok) {
						self.log('warn', `Add message failed: ${result.code ?? 'error'}`)
						return
					}

					// The device reports the new id on `entity_id`; log it so the new message
					// can be addressed by position once the list refreshes.
					const messageId = result.response?.type === 'ack_response' ? (result.response.entity_id ?? null) : null
					self.log('info', `Added message${messageId ? ` ${messageId}` : ''}`)
				})
			},
		},
		delete_message: {
			name: 'Delete Message',
			options: [
				{
					type: 'number',
					id: 'message_number',
					label: 'Message number (1 = first)',
					default: 1,
					min: 1,
					max: 999,
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildDeleteMessage(self.state, event.options.message_number)
				if (!built.ok) {
					self.log('warn', `Delete message: ${built.reason}; nothing sent`)
					return
				}
				// The device refuses this with DEVICE_BUSY while the message is on screen.
				self.sendCommand('delete_message', built.payload)
			},
		},
		move_message_up: {
			name: 'Move Message Up',
			options: [
				{
					type: 'number',
					id: 'message_number',
					label: 'Message number (1 = first)',
					default: 1,
					min: 1,
					max: 999,
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildMessageMove(self.state, event.options.message_number, 'up')
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Move message up: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('move_message_up', built.payload)
			},
		},
		move_message_down: {
			name: 'Move Message Down',
			options: [
				{
					type: 'number',
					id: 'message_number',
					label: 'Message number (1 = first)',
					default: 1,
					min: 1,
					max: 999,
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildMessageMove(self.state, event.options.message_number, 'down')
				if (!built.ok) {
					self.log(built.kind === 'noop' ? 'debug' : 'warn', `Move message down: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('move_message_down', built.payload)
			},
		},
		update_message: {
			name: 'Update Message',
			options: [
				{
					type: 'number',
					id: 'message_number',
					label: 'Message number (1 = first)',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					type: 'textinput',
					id: 'content',
					label: 'New message text',
					default: '',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildUpdateMessage(self.state, event.options.message_number, event.options.content)
				if (!built.ok) {
					self.log('warn', `Update message: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('update_message', built.payload)
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

				self.sendCommand('set_blackout', { action: enabled ? 'enable' : 'disable' })
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
				self.sendCommand('set_glow', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_glow: {
			name: 'Toggle Glow',
			options: [],
			callback: async () => {
				self.sendCommand('toggle_glow')
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
				self.sendCommand('set_flash', { action: String(event.options.action ?? 'enable') })
			},
		},
		toggle_flash: {
			name: 'Toggle Flash',
			options: [],
			callback: async () => {
				self.sendCommand('toggle_flash')
			},
		},
		show_message: {
			name: 'Show Message',
			options: [
				{
					type: 'number',
					id: 'message_number',
					label: 'Stored message number (0 = use the text below)',
					default: 0,
					min: 0,
					max: 999,
					tooltip:
						'Addresses a message already in the program by its position, so it is shown with its own flash settings.',
				},
				{
					type: 'textinput',
					id: 'text',
					label: 'Message text (ignored when a stored message number is set)',
					default: 'Break Time',
					tooltip: 'Ad-hoc text. The program is not changed, and unlike a stored message this needs no program loaded.',
				},
				{
					type: 'dropdown',
					id: 'flash',
					label: 'Message flash',
					default: 'keep',
					choices: [
						{ id: 'keep', label: 'Leave unchanged' },
						{ id: 'on', label: 'Turn on' },
						{ id: 'off', label: 'Turn off' },
					],
					tooltip:
						'The flash flag is shared with Set/Toggle Flash. "Leave unchanged" omits the field, the only form whose meaning does not depend on firmware version.',
				},
			],
			callback: async (event: ActionEvent) => {
				const built = buildShowMessage(self.state, {
					messageNumber: event.options.message_number,
					text: event.options.text,
					flash: event.options.flash,
				})
				if (!built.ok) {
					self.log('warn', `Show message: ${built.reason}; nothing sent`)
					return
				}

				// Pressing the button again takes *this* message down, so one button toggles.
				// Compare against the specific message rather than "any message is showing",
				// so a second button for a different message is not swallowed by the first.
				if (isMessageShowing(self.state, built.payload)) {
					self.sendCommand('hide_message')
					return
				}

				self.sendCommand('show_message', built.payload)
			},
		},
		hide_message: {
			name: 'Hide Message',
			options: [],
			callback: async () => {
				self.sendCommand('hide_message')
			},
		},
		show_idle: {
			name: 'Show Idle Screen',
			options: [],
			callback: async () => {
				self.sendCommand('show_idle')
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
				const built = buildBrightness(event.options.brightness)
				if (!built.ok) {
					self.log('warn', `Set brightness: ${built.reason}; nothing sent`)
					return
				}
				self.sendCommand('set_brightness', built.payload)
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
				self.sendCommand('set_is_time_up_display', { enabled: event.options.enabled === 'true' })
			},
		},
		toggle_is_time_up_display: {
			name: 'Toggle Time-is-Up Display',
			options: [],
			callback: async () => {
				self.sendCommand('toggle_is_time_up_display')
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
				self.sendCommand('delete_all_messages')
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
				self.sendCommand('delete_all_sessions')
			},
		},
	})
}
