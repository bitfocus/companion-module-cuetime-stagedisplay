import type { Event, EventPayloads, Response } from './generated.js'

export type TimerRunState = 'idle' | 'running' | 'paused'

export type HelloState = EventPayloads['hello_event']
export type ControlCenterStatus = EventPayloads['control_center_status_event']['control_center']
export type ViewStatus = EventPayloads['view_status_event']['view']
export type SettingsStatus = EventPayloads['settings_status_event']['settings']
export type SessionSummary = EventPayloads['sessions_status_event']['sessions']['session_list'][number]
export type MessageSummary = EventPayloads['messages_status_event']['messages']['message_list'][number]
export type ProgramState = EventPayloads['program_changed_event']

/**
 * Everything the module needs to derive variables/feedbacks, assembled purely
 * from pushed events (plus the one-off hydration `status_response`).
 *
 * A field is `null`/empty until the device has reported it; wire fields the
 * device has no value for are omitted, never sent as `null` (protocol rule).
 */
export interface ProtocolState {
	hello: HelloState | null
	controlCenter: ControlCenterStatus | null
	view: ViewStatus | null
	settings: SettingsStatus | null
	sessionList: SessionSummary[]
	messageList: MessageSummary[]
	messagesFlashing: boolean
	program: ProgramState | null
	hydrationComplete: boolean
}

export function createInitialState(): ProtocolState {
	return {
		hello: null,
		controlCenter: null,
		view: null,
		settings: null,
		sessionList: [],
		messageList: [],
		messagesFlashing: false,
		program: null,
		hydrationComplete: false,
	}
}

/** Applies a pushed event, returning a new state (never mutates). */
export function applyEvent(state: ProtocolState, event: Event): ProtocolState {
	switch (event.type) {
		case 'hello_event':
			return { ...state, hello: event }
		case 'control_center_status_event':
			return { ...state, controlCenter: event.control_center }
		case 'view_status_event':
			return { ...state, view: event.view }
		case 'settings_status_event':
			return { ...state, settings: event.settings }
		case 'sessions_status_event':
			return { ...state, sessionList: event.sessions.session_list }
		case 'messages_status_event':
			return { ...state, messageList: event.messages.message_list, messagesFlashing: event.messages.is_flashing }
		case 'program_changed_event':
			return { ...state, program: { has_program: event.has_program, program: event.program } }
		default:
			return state
	}
}

/** Applies a reply (status/program) or ack/error to the state. Never mutates. */
export function applyResponse(state: ProtocolState, response: Response): ProtocolState {
	switch (response.type) {
		case 'status_response': {
			const next: ProtocolState = {
				...state,
				hydrationComplete: true,
				controlCenter: response.control_center ?? state.controlCenter,
				view: response.view ?? state.view,
				settings: response.settings ?? state.settings,
				sessionList: response.sessions?.session_list ?? state.sessionList,
				messageList: response.messages?.message_list ?? state.messageList,
				messagesFlashing: response.messages?.is_flashing ?? state.messagesFlashing,
			}
			return next
		}
		case 'control_center_status_response':
			return { ...state, hydrationComplete: true, controlCenter: response.control_center }
		case 'view_status_response':
			return { ...state, hydrationComplete: true, view: response.view }
		case 'settings_status_response':
			return { ...state, hydrationComplete: true, settings: response.settings }
		case 'sessions_status_response':
			return { ...state, hydrationComplete: true, sessionList: response.sessions.session_list }
		case 'messages_status_response':
			return {
				...state,
				hydrationComplete: true,
				messageList: response.messages.message_list,
				messagesFlashing: response.messages.is_flashing,
			}
		case 'program_response':
			return { ...state, program: { has_program: response.has_program, program: response.program } }
		default:
			return state
	}
}
