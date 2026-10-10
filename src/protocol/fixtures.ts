import type { Event, EventPayloads, Response, ResponsePayloads } from './generated.ts'

type ControlCenter = EventPayloads['control_center_status_event']['control_center']
type View = EventPayloads['view_status_event']['view']
type Settings = EventPayloads['settings_status_event']['settings']
type Session = EventPayloads['sessions_status_event']['sessions']['session_list'][number]
type Messages = EventPayloads['messages_status_event']['messages']
type Hello = EventPayloads['hello_event']

/**
 * Builders for the wire objects used in tests.
 *
 * Every field is spelled out rather than cast with `as any`, so a field the
 * vc146 schema renames breaks the build here instead of silently passing.
 */

export function controlCenter(overrides: Partial<ControlCenter> = {}): ControlCenter {
	return {
		flash_start_time: 0,
		is_next_session: false,
		current_presenter_name: '',
		current_session_name: '',
		current_session_id: '',
		current_session_index: -1,
		is_blackout: false,
		program_time: 0,
		is_glowing: false,
		timer_run_state: 'idle',
		is_time_up_flashing: false,
		timer: 0,
		is_previous_session: false,
		elapsed_time: 0,
		flash_length: 0,
		program_elapsed_time: 0,
		...overrides,
	}
}

export function view(overrides: Partial<View> = {}): View {
	return {
		is_time_up_flashing: false,
		session_name: '',
		message_text: '',
		is_flashing: false,
		elapsed_time: 0,
		session_id: '',
		presenter_name: '',
		progress_bar: 0,
		is_glowing: false,
		program_elapsed_time: 0,
		...overrides,
	}
}

export function settings(overrides: Partial<Settings> = {}): Settings {
	return {
		brightness: 100,
		is_time_up_display: true,
		default_flash_length: 0,
		default_flash_start_time: 0,
		screen_version: 'test',
		...overrides,
	}
}

export function session(overrides: Partial<Session> = {}): Session {
	return {
		notes: '',
		index: 0,
		version: '1',
		mode: 'countdown',
		flash_start_time_seconds: 0,
		flash_length_seconds: 0,
		name: 'Session',
		id: 'session-1',
		is_current: false,
		...overrides,
	}
}

export function messages(overrides: Partial<Messages> = {}): Messages {
	return {
		message_list: [],
		is_flashing: false,
		...overrides,
	}
}

export function hello(overrides: Partial<Hello> = {}): Hello {
	return {
		version_name: 'test',
		screen_name: 'Stage',
		version_code: 146,
		screen_id: 'screen-1',
		...overrides,
	}
}

// ---- Event builders ----

export function controlCenterEvent(overrides: Partial<ControlCenter> = {}): Event {
	return { type: 'control_center_status_event', control_center: controlCenter(overrides) }
}

export function viewEvent(overrides: Partial<View> = {}): Event {
	return { type: 'view_status_event', view: view(overrides) }
}

export function settingsEvent(overrides: Partial<Settings> = {}): Event {
	return { type: 'settings_status_event', settings: settings(overrides) }
}

export function sessionsEvent(list: Partial<Session>[]): Event {
	return { type: 'sessions_status_event', sessions: { session_list: list.map((item) => session(item)) } }
}

export function messagesEvent(overrides: Partial<Messages> = {}): Event {
	return { type: 'messages_status_event', messages: messages(overrides) }
}

export function helloEvent(overrides: Partial<Hello> = {}): Event {
	return { type: 'hello_event', ...hello(overrides) }
}

// ---- Response builders ----

export interface StatusResponseInput {
	control_center?: ControlCenter
	view?: View
	settings?: Settings
	session_list?: Partial<Session>[]
	messages?: Messages
}

export function statusResponse(input: StatusResponseInput = {}): Response {
	const response: { type: 'status_response' } & ResponsePayloads['status_response'] = { type: 'status_response' }

	if (input.control_center) response.control_center = input.control_center
	if (input.view) response.view = input.view
	if (input.settings) response.settings = input.settings
	if (input.session_list) response.sessions = { session_list: input.session_list.map((item) => session(item)) }
	if (input.messages) response.messages = input.messages

	return response
}
