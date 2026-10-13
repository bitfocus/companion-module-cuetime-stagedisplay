import { describe, it, expect } from 'vitest'
import {
	extractVariableValues,
	formatTime,
	getEffectiveHost,
	getEffectivePort,
	resolveSessionId,
	resolveMessageIdByPosition,
	sessionPosition,
	currentSessionMode,
	isCurrentSessionTimeOfDay,
	checkIsPlaying,
	checkIsPaused,
	checkIsIdle,
	checkIsGlowing,
	checkIsBlackout,
	checkIsFlashing,
	checkHasPreviousSession,
	checkHasNextSession,
	checkMessageShowing,
	checkIsTimeUpDisplay,
	checkIsTimeUpFlashing,
} from './logic.ts'
import { applyEvent, createInitialState } from './protocol/state.ts'
import type { ProtocolState } from './protocol/state.ts'
import {
	controlCenterEvent,
	viewEvent,
	settingsEvent,
	sessionsEvent,
	messagesEvent,
	helloEvent,
} from './protocol/fixtures.ts'

/** Folds a list of events into a state, the way the module does as they arrive. */
function stateFrom(...events: Parameters<typeof applyEvent>[1][]): ProtocolState {
	return events.reduce<ProtocolState>((state, event) => applyEvent(state, event), createInitialState())
}

describe('formatTime', () => {
	it('renders MM:SS below an hour and HH:MM:SS above it', () => {
		expect(formatTime(61000)).toBe('01:01')
		expect(formatTime(3661000)).toBe('01:01:01')
	})

	it('renders zero and negative durations as 00:00', () => {
		// `timer` is the unsigned on-screen reading, so a negative is never meaningful.
		expect(formatTime(0)).toBe('00:00')
		expect(formatTime(-5000)).toBe('00:00')
	})
})

describe('host and port resolution', () => {
	it('prefers the Bonjour-discovered device over the manual host', () => {
		expect(getEffectiveHost({ host: '10.0.0.5', 'cuetime-display': 'display.local' })).toBe('display.local')
	})

	it('falls back to the manual host, then to empty', () => {
		expect(getEffectiveHost({ host: '10.0.0.5', 'cuetime-display': null })).toBe('10.0.0.5')
		expect(getEffectiveHost({ host: '', 'cuetime-display': null })).toBe('')
	})

	it('defaults to the WebSocket port, not the HTTP one', () => {
		expect(getEffectivePort({ port: '8081' })).toBe('8081')
		expect(getEffectivePort({ port: '' })).toBe('8081')
	})
})

describe('extractVariableValues', () => {
	it('returns neutral defaults for a state the device has not populated', () => {
		const values = extractVariableValues(createInitialState())

		expect(values.timer_run_state).toBe('idle')
		expect(values.is_playing).toBe('No')
		expect(values.current_session_number).toBe(0)
		expect(values.total_sessions).toBe(0)
		expect(values.elapsed_formatted).toBe('00:00')
		expect(values.next_session_name).toBe('')
	})

	it('derives timer, session and neighbour values from pushed events', () => {
		const state = stateFrom(
			controlCenterEvent({
				timer_run_state: 'running',
				current_session_index: 0,
				current_session_id: 'session-1',
				current_session_name: 'Opening',
				current_presenter_name: 'Ada',
				elapsed_time: 305000,
				timer: 655000,
				is_next_session: true,
				is_glowing: true,
				is_blackout: false,
			}),
			viewEvent({ message_text: 'Break', elapsed_time: 305000 }),
			settingsEvent({ brightness: 42 }),
			sessionsEvent([
				{ id: 'session-1', index: 0, name: 'Opening', presenter_name: 'Ada', is_current: true },
				{ id: 'session-2', index: 1, name: 'Keynote', presenter_name: 'Grace' },
			]),
			helloEvent({ version_name: '1.2.3' }),
		)

		const values = extractVariableValues(state)

		expect(values.timer_run_state).toBe('running')
		expect(values.is_playing).toBe('Yes')
		expect(values.is_glowing).toBe('Yes')
		expect(values.is_blackout).toBe('No')
		expect(values.current_session_name).toBe('Opening')
		expect(values.current_presenter_name).toBe('Ada')
		expect(values.elapsed_time).toBe(305000)
		expect(values.timer).toBe(655000)
		expect(values.elapsed_formatted).toBe('05:05')
		expect(values.remaining_formatted).toBe('10:55')
		expect(values.message_text).toBe('Break')

		// Session numbering is 1-based for humans; the wire index is 0-based.
		expect(values.current_session_number).toBe(1)
		expect(values.total_sessions).toBe(2)
		expect(values.previous_session_name).toBe('')
		expect(values.next_session_name).toBe('Keynote')
		expect(values.next_session_presenter_name).toBe('Grace')
	})
})

describe('command target resolution', () => {
	const withSessions = stateFrom(
		sessionsEvent([
			{ id: 's1', index: 0, name: 'Opening' },
			{ id: 's2', index: 1, name: 'Keynote', is_current: true },
			{ id: 's3', index: 2, name: 'Close' },
		]),
		controlCenterEvent({ current_session_id: 's2', current_session_index: 1 }),
	)

	it('prefers an explicit session id, then falls back to the current session', () => {
		expect(resolveSessionId(withSessions, 's3')).toBe('s3')
		expect(resolveSessionId(withSessions, '  s1  ')).toBe('s1')
		expect(resolveSessionId(withSessions, '')).toBe('s2')
		expect(resolveSessionId(withSessions, undefined)).toBe('s2')
		expect(resolveSessionId(withSessions, null)).toBe('s2')
	})

	it('reports no target instead of provoking a device error when nothing is current', () => {
		// Idle display: current_session_id is empty, so there is nothing to act on.
		expect(resolveSessionId(createInitialState(), '')).toBeNull()
		expect(resolveSessionId(stateFrom(controlCenterEvent({ current_session_id: '' })), '')).toBeNull()
		// An explicit id is still honoured even with nothing current.
		expect(resolveSessionId(createInitialState(), 'explicit')).toBe('explicit')
	})

	it('reports 1-based session positions, or null when absent', () => {
		expect(sessionPosition(withSessions, 's1')).toBe(1)
		expect(sessionPosition(withSessions, 's3')).toBe(3)
		expect(sessionPosition(withSessions, 'nope')).toBeNull()
		expect(sessionPosition(createInitialState(), 's1')).toBeNull()
	})

	it('maps a 1-based message position to an id, rejecting out-of-range input', () => {
		const state = stateFrom(
			messagesEvent({
				message_list: [
					{ id: 'm1', text: 'Break', is_showing: false },
					{ id: 'm2', text: 'Lunch', is_showing: false },
				],
			}),
		)

		expect(resolveMessageIdByPosition(state, 1)).toBe('m1')
		expect(resolveMessageIdByPosition(state, 2)).toBe('m2')
		expect(resolveMessageIdByPosition(state, 3)).toBeNull()
		expect(resolveMessageIdByPosition(state, 0)).toBeNull()
		expect(resolveMessageIdByPosition(state, -1)).toBeNull()
		expect(resolveMessageIdByPosition(state, 1.5)).toBeNull()
		expect(resolveMessageIdByPosition(state, Number.NaN)).toBeNull()
		expect(resolveMessageIdByPosition(createInitialState(), 1)).toBeNull()
	})
})

describe('current session mode', () => {
	const layout = [
		{ id: 's1', index: 0, name: 'One', mode: 'countdown' },
		{ id: 's2', index: 1, name: 'Two', mode: 'countdown', is_current: true },
		{ id: 's3', index: 2, name: 'Three', mode: 'time_of_day' },
	]

	it('prefers the summary marked is_current', () => {
		expect(currentSessionMode(stateFrom(sessionsEvent(layout)))).toBe('countdown')
	})

	it('falls back to the control center index when nothing is marked current', () => {
		// No `is_current` on any summary, so the index is the only signal.
		const unmarked = stateFrom(
			sessionsEvent([
				{ id: 's1', index: 0, name: 'One', mode: 'countdown' },
				{ id: 's2', index: 1, name: 'Two', mode: 'time_of_day' },
			]),
			controlCenterEvent({ current_session_index: 1, current_session_id: 's2' }),
		)
		expect(currentSessionMode(unmarked)).toBe('time_of_day')
	})

	it('is null when no session is current', () => {
		expect(currentSessionMode(createInitialState())).toBeNull()
		// Index -1 is the device's "nothing current" value.
		expect(currentSessionMode(stateFrom(controlCenterEvent({ current_session_index: -1 })))).toBeNull()
		expect(currentSessionMode(stateFrom(sessionsEvent(layout)))).not.toBeNull()
	})

	it('detects a Time of Day wall clock, which cannot be paused or adjusted', () => {
		const tod = stateFrom(sessionsEvent([{ id: 't', index: 0, name: 'Clock', mode: 'time_of_day', is_current: true }]))
		expect(isCurrentSessionTimeOfDay(tod)).toBe(true)
		expect(isCurrentSessionTimeOfDay(stateFrom(sessionsEvent(layout)))).toBe(false)
		// Unknown state must not be treated as a wall clock, or actions would skip
		// commands simply because the state has not arrived yet.
		expect(isCurrentSessionTimeOfDay(createInitialState())).toBe(false)
	})

	it('reports the mode through the variables', () => {
		expect(extractVariableValues(stateFrom(sessionsEvent(layout))).current_session_mode).toBe('countdown')
		expect(extractVariableValues(createInitialState()).current_session_mode).toBe('')
	})
})

describe('feedback checks', () => {
	it('reads the run state from timer_run_state', () => {
		const playing = stateFrom(controlCenterEvent({ timer_run_state: 'running' }))
		expect(checkIsPlaying(playing)).toBe(true)
		expect(checkIsPaused(playing)).toBe(false)
		expect(checkIsIdle(playing)).toBe(false)

		const paused = stateFrom(controlCenterEvent({ timer_run_state: 'paused' }))
		expect(checkIsPlaying(paused)).toBe(false)
		expect(checkIsPaused(paused)).toBe(true)
		expect(checkIsIdle(paused)).toBe(false)

		// A paused timer is on screen; an idle one is not. `is_playing` could not tell them apart.
		expect(checkIsIdle(createInitialState())).toBe(true)
	})

	it('reads blackout and glow from the control center', () => {
		const state = stateFrom(controlCenterEvent({ is_blackout: true, is_glowing: false }))
		expect(checkIsBlackout(state)).toBe(true)
		expect(checkIsGlowing(state)).toBe(false)
	})

	it('reads navigation availability from the device flags', () => {
		const state = stateFrom(
			controlCenterEvent({ is_previous_session: true, is_next_session: false }),
			// Sessions exist, but the device says there is no next session to go to.
			sessionsEvent([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
		)
		expect(checkHasPreviousSession(state)).toBe(true)
		expect(checkHasNextSession(state)).toBe(false)
	})

	it('reads flashing from the view or the messages section, whichever reported it', () => {
		// §4.8: both sections report the same message flash, and neither reports the
		// session's own flashing (that is `is_time_up_flashing`), so OR-ing is safe.
		expect(checkIsFlashing(stateFrom(viewEvent({ is_flashing: true })))).toBe(true)
		expect(checkIsFlashing(stateFrom(messagesEvent({ is_flashing: true })))).toBe(true)
		expect(checkIsFlashing(stateFrom(messagesEvent({ is_flashing: false })))).toBe(false)
		expect(checkIsFlashing(createInitialState())).toBe(false)

		// A time-is-up flash is a session-side signal and must not be mistaken for one.
		expect(checkIsFlashing(stateFrom(viewEvent({ is_time_up_flashing: true })))).toBe(false)
	})

	it('treats a whitespace-only message as not showing', () => {
		expect(checkMessageShowing(createInitialState())).toBe(false)
		expect(checkMessageShowing(stateFrom(viewEvent({ message_text: '   ' })))).toBe(false)
		expect(checkMessageShowing(stateFrom(viewEvent({ message_text: 'Break' })))).toBe(true)
	})

	it('reads flashing and the time-is-up overlay from where vc146 reports them', () => {
		const flashing = stateFrom(viewEvent({ is_flashing: true, is_time_up_flashing: true }))
		expect(checkIsFlashing(flashing)).toBe(true)
		expect(checkIsTimeUpFlashing(flashing)).toBe(true)

		// The overlay is also reported on the control center, and is a settings-independent field.
		expect(checkIsTimeUpFlashing(stateFrom(controlCenterEvent({ is_time_up_flashing: true })))).toBe(true)

		expect(checkIsTimeUpDisplay(stateFrom(settingsEvent({ is_time_up_display: false })))).toBe(false)
		expect(checkIsTimeUpDisplay(stateFrom(settingsEvent({ is_time_up_display: true })))).toBe(true)
	})
})
