import { describe, it, expect } from 'vitest'
import {
	extractVariableValues,
	formatTime,
	getEffectiveHost,
	getEffectivePort,
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
import { controlCenterEvent, viewEvent, settingsEvent, sessionsEvent, helloEvent } from './protocol/fixtures.ts'

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
