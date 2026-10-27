import { describe, it, expect } from 'vitest'
import {
	BRIGHTNESS_MAX,
	BRIGHTNESS_MIN,
	COUNTDOWN_MIN_SECONDS,
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
	planNavigation,
	buildTimeDelta,
	buildUpdateMessage,
	buildUpdateSession,
	isMessageShowing,
	parseTimeOfDayOffsetMs,
	toWholeMs,
} from './payloads.ts'
import { applyEvent, createInitialState } from './protocol/state.ts'
import type { ProtocolState } from './protocol/state.ts'
import type { Event } from './protocol/generated.ts'
import type { Built } from './payloads.ts'
import { controlCenterEvent, helloEvent, messagesEvent, sessionsEvent, viewEvent } from './protocol/fixtures.ts'

function stateFrom(...events: Event[]): ProtocolState {
	return events.reduce<ProtocolState>((state, event) => applyEvent(state, event), createInitialState())
}

/** Pulls the reason out of a failed build, asserting that it failed. */
function reasonOf(result: Built<unknown>): string {
	if (result.ok) throw new Error('expected the build to fail')
	return result.reason
}

const threeMessages = stateFrom(
	messagesEvent({
		message_list: [
			{ id: 'm1', text: 'Alpha', is_showing: false },
			{ id: 'm2', text: 'Bravo', is_showing: false },
			{ id: 'm3', text: 'Charlie', is_showing: false },
		],
	}),
)

const threeSessions = stateFrom(
	sessionsEvent([
		{ id: 's1', index: 0, name: 'One' },
		{ id: 's2', index: 1, name: 'Two', is_current: true },
		{ id: 's3', index: 2, name: 'Three' },
	]),
	controlCenterEvent({ current_session_id: 's2', current_session_index: 1 }),
)

describe('time conversion', () => {
	it('converts seconds to whole milliseconds', () => {
		expect(toWholeMs(60)).toBe(60000)
		expect(toWholeMs(1.5)).toBe(1500)
		expect(toWholeMs('90')).toBe(90000)
		expect(toWholeMs(0)).toBe(0)
		expect(toWholeMs(undefined)).toBe(0)
	})

	it('rejects values that are not numbers', () => {
		expect(toWholeMs('soon')).toBeNull()
		expect(toWholeMs(Number.NaN)).toBeNull()
		expect(toWholeMs(Number.POSITIVE_INFINITY)).toBeNull()
	})

	it('parses a time-of-day offset as MILLISECONDS past midnight', () => {
		// The pre-fix code returned seconds, a silent 1000x error; firmware echoed
		// 3600000 for 01:00:00, confirming milliseconds.
		expect(parseTimeOfDayOffsetMs('01:00:00')).toBe(3600000)
		expect(parseTimeOfDayOffsetMs('00:00:00')).toBe(0)
		expect(parseTimeOfDayOffsetMs('23:59:59')).toBe(86399000)
	})

	it('accepts HH:MM as well as HH:MM:SS, and rejects anything out of range', () => {
		expect(parseTimeOfDayOffsetMs('01:30')).toBe(5400000)
		expect(parseTimeOfDayOffsetMs(' 12:00:00 ')).toBe(43200000)
		expect(parseTimeOfDayOffsetMs('24:00:00')).toBeNull()
		expect(parseTimeOfDayOffsetMs('12:60:00')).toBeNull()
		expect(parseTimeOfDayOffsetMs('12:00:60')).toBeNull()
		expect(parseTimeOfDayOffsetMs('lunchtime')).toBeNull()
		expect(parseTimeOfDayOffsetMs('')).toBeNull()
	})
})

describe('buildTimeDelta', () => {
	it('sends `ms`, never the deprecated `seconds` field', () => {
		// vc146 states plainly: send `ms`; `seconds` is deprecated and ignored whenever
		// `ms` is nonzero. Emitting the old field was a real bug.
		expect(buildTimeDelta(90)).toEqual({ ok: true, payload: { ms: 90000 } })
		expect(buildTimeDelta(90)).not.toHaveProperty('payload.seconds')
	})

	it('reports unparseable amounts as invalid', () => {
		const built = buildTimeDelta('later')
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.kind).toBe('invalid')
	})
})

describe('buildBrightness', () => {
	it('accepts whole numbers in range', () => {
		expect(buildBrightness(0)).toEqual({ ok: true, payload: { brightness: 0 } })
		expect(buildBrightness(100)).toEqual({ ok: true, payload: { brightness: 100 } })
	})

	it('rejects fractional and out-of-range values, which the device refuses outright', () => {
		for (const bad of [50.5, -1, 101, Number.NaN, 'bright']) {
			const built = buildBrightness(bad)
			expect(built.ok, `expected ${String(bad)} to be rejected`).toBe(false)
		}
		expect(reasonOf(buildBrightness(101))).toContain(`${BRIGHTNESS_MIN}`)
		expect(BRIGHTNESS_MAX).toBe(100)
	})
})

describe('buildAddSession', () => {
	it('sends a countdown duration in seconds with the mode', () => {
		expect(buildAddSession({ mode: 'countdown', seconds: 90, name: 'Opening' })).toEqual({
			ok: true,
			payload: { mode: 'countdown', seconds: 90, name: 'Opening' },
		})
	})

	it('refuses a countdown shorter than one second rather than letting the device reject it', () => {
		expect(COUNTDOWN_MIN_SECONDS).toBe(1)
		expect(reasonOf(buildAddSession({ mode: 'countdown', seconds: 0 }))).toContain('at least 1 second')
		expect(reasonOf(buildAddSession({ mode: 'countdown', seconds: 0.5 }))).not.toBe('')
		expect(buildAddSession({ mode: 'countdown', seconds: 1 }).ok).toBe(true)
	})

	it('allows a zero-length count-up, which the device accepts', () => {
		expect(buildAddSession({ mode: 'countup', seconds: 0 })).toEqual({
			ok: true,
			payload: { mode: 'countup', seconds: 0 },
		})
	})

	it('carries a time-of-day start as an offset in milliseconds, with no duration', () => {
		const built = buildAddSession({ mode: 'time_of_day', offset: '01:00:00', seconds: 999 })
		expect(built).toEqual({ ok: true, payload: { mode: 'time_of_day', offset: 3600000 } })
		if (built.ok) expect(built.payload).not.toHaveProperty('seconds')
	})

	it('requires a parseable offset for a time-of-day session', () => {
		expect(reasonOf(buildAddSession({ mode: 'time_of_day', offset: '25:00:00' }))).toContain('00:00:00')
		expect(reasonOf(buildAddSession({ mode: 'time_of_day', offset: '' }))).toContain('HH:MM:SS')
	})

	it('rejects a fractional duration, which the device counts as a whole-number field', () => {
		expect(reasonOf(buildAddSession({ mode: 'countdown', seconds: 1.5 }))).toContain('whole number')
	})

	it('rejects an unknown mode', () => {
		expect(reasonOf(buildAddSession({ mode: 'stopwatch', seconds: 10 }))).toContain('stopwatch')
	})

	it('omits optional fields rather than sending blanks or zeroes', () => {
		const built = buildAddSession({
			mode: 'countdown',
			seconds: 60,
			name: '   ',
			presenterName: '',
			notes: '  ',
			flashStartSeconds: 0,
			flashLengthSeconds: 0,
		})
		expect(built).toEqual({ ok: true, payload: { mode: 'countdown', seconds: 60 } })
	})

	it('includes flash timing when a positive value is given, trimmed', () => {
		const built = buildAddSession({
			mode: 'countdown',
			seconds: 60,
			name: '  Named  ',
			presenterName: ' Ada ',
			notes: ' note ',
			flashStartSeconds: 30,
			flashLengthSeconds: 10,
		})
		expect(built).toEqual({
			ok: true,
			payload: {
				mode: 'countdown',
				seconds: 60,
				name: 'Named',
				presenter_name: 'Ada',
				notes: 'note',
				flash_start_time_seconds: 30,
				flash_length_seconds: 10,
			},
		})
	})
})

describe('buildShowMessage', () => {
	it('addresses a stored message by position, resolving it to an id', () => {
		expect(buildShowMessage(threeMessages, { messageNumber: 2 })).toEqual({
			ok: true,
			payload: { message_id: 'm2' },
		})
	})

	it('addresses literal text when no stored message is chosen', () => {
		expect(buildShowMessage(threeMessages, { text: 'On break' })).toEqual({
			ok: true,
			payload: { text: 'On break' },
		})
	})

	it('never sends both addressing forms at once', () => {
		// The schema requires exactly one (`anyOf`): a non-empty message_id wins.
		const byId = buildShowMessage(threeMessages, { messageNumber: 1, text: 'ignored' })
		expect(byId.ok && 'text' in byId.payload).toBe(false)

		const byText = buildShowMessage(threeMessages, { messageNumber: 0, text: 'used' })
		expect(byText.ok && 'message_id' in byText.payload).toBe(false)
	})

	it('omits `flash` unless the operator asked for it', () => {
		// `false` means "stop the flash" in the current protocol revision but was a
		// no-op in the revision this module first pinned, and both are version 146.
		const kept = buildShowMessage(threeMessages, { text: 'x', flash: 'keep' })
		expect(kept.ok && 'flash' in kept.payload).toBe(false)

		const on = buildShowMessage(threeMessages, { text: 'x', flash: 'on' })
		expect(on).toEqual({ ok: true, payload: { text: 'x', flash: true } })

		const off = buildShowMessage(threeMessages, { text: 'x', flash: 'off' })
		expect(off).toEqual({ ok: true, payload: { text: 'x', flash: false } })

		// An unset option behaves like "keep".
		const unset = buildShowMessage(threeMessages, { text: 'x' })
		expect(unset.ok && 'flash' in unset.payload).toBe(false)
	})

	it('rejects an out-of-range position and empty text', () => {
		expect(reasonOf(buildShowMessage(threeMessages, { messageNumber: 9 }))).toContain('position 9')
		expect(reasonOf(buildShowMessage(threeMessages, { messageNumber: 4 }))).toContain('has 3')
		expect(reasonOf(buildShowMessage(threeMessages, { text: '   ' }))).toContain('empty')
		expect(reasonOf(buildShowMessage(createInitialState(), { messageNumber: 1 }))).toContain('has 0')
	})
})

describe('isMessageShowing', () => {
	it('matches a stored message by id and an ad-hoc one by text', () => {
		const showingStored = stateFrom(viewEvent({ message_id: 'm2', message_text: 'Bravo' }))
		expect(isMessageShowing(showingStored, { message_id: 'm2' })).toBe(true)
		expect(isMessageShowing(showingStored, { message_id: 'm1' })).toBe(false)

		// An ad-hoc message reports text with an empty id.
		const showingAdHoc = stateFrom(viewEvent({ message_id: '', message_text: 'On break' }))
		expect(isMessageShowing(showingAdHoc, { text: 'On break' })).toBe(true)
		expect(isMessageShowing(showingAdHoc, { text: 'Other' })).toBe(false)
	})

	it('is false when nothing is on screen', () => {
		expect(isMessageShowing(createInitialState(), { message_id: 'm1' })).toBe(false)
		expect(isMessageShowing(createInitialState(), { text: 'x' })).toBe(false)
		// An empty id must not match an empty view id.
		expect(isMessageShowing(createInitialState(), { message_id: '' })).toBe(false)
	})
})

describe('message position actions', () => {
	it('resolves a 1-based position to an id', () => {
		expect(buildDeleteMessage(threeMessages, 3)).toEqual({ ok: true, payload: { message_id: 'm3' } })
		expect(buildMessageMove(threeMessages, 2, 'up')).toEqual({ ok: true, payload: { message_id: 'm2' } })
	})

	it('treats an out-of-range position as invalid, not a no-op', () => {
		const built = buildDeleteMessage(threeMessages, 99)
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.kind).toBe('invalid')
	})

	it('treats a boundary move as a no-op so the caller can log it quietly', () => {
		const first = buildMessageMove(threeMessages, 1, 'up')
		expect(first.ok).toBe(false)
		if (!first.ok) {
			expect(first.kind).toBe('noop')
			expect(first.reason).toContain('already first')
		}

		const last = buildMessageMove(threeMessages, 3, 'down')
		expect(last.ok).toBe(false)
		if (!last.ok) expect(last.kind).toBe('noop')

		// But moving the same messages the other way is fine.
		expect(buildMessageMove(threeMessages, 1, 'down').ok).toBe(true)
		expect(buildMessageMove(threeMessages, 3, 'up').ok).toBe(true)
	})
})

describe('buildUpdateMessage', () => {
	it('resolves the position to an id and sends the replacement text', () => {
		expect(buildUpdateMessage(threeMessages, 2, 'New text')).toEqual({
			ok: true,
			payload: { message_id: 'm2', content: 'New text' },
		})
	})

	it('rejects an out-of-range position and empty replacement text', () => {
		expect(reasonOf(buildUpdateMessage(threeMessages, 9, 'x'))).toContain('position 9')
		expect(reasonOf(buildUpdateMessage(threeMessages, 1, '   '))).toContain('empty')
	})

	it('is allowed on the message that is on screen, unlike deletion', () => {
		// The device raises DEVICE_BUSY only for deleting a displayed message.
		const showing = stateFrom(messagesEvent({ message_list: [{ id: 'm1', text: 'Alpha', is_showing: true }] }))
		expect(buildUpdateMessage(showing, 1, 'Alpha v2').ok).toBe(true)
	})
})

describe('buildAddMessage', () => {
	it('accepts non-blank text and rejects only blank', () => {
		expect(buildAddMessage('Break')).toEqual({ ok: true, payload: { content: 'Break' } })
		expect(reasonOf(buildAddMessage('  '))).toContain('empty')
		expect(reasonOf(buildAddMessage(undefined))).toContain('empty')
	})
})

describe('buildDeleteSession', () => {
	it('treats a blank id as the current session', () => {
		expect(buildDeleteSession(threeSessions, '')).toEqual({ ok: true, payload: { session_id: 's2' } })
	})

	it('refuses while the current session is running, which the device calls DEVICE_BUSY', () => {
		const running = stateFrom(
			sessionsEvent([{ id: 's1', index: 0, name: 'One', is_current: true }]),
			controlCenterEvent({ timer_run_state: 'running', current_session_id: 's1' }),
		)
		const built = buildDeleteSession(running, '')
		expect(built.ok).toBe(false)
		if (!built.ok) {
			expect(built.kind).toBe('noop')
			expect(built.reason).toContain('pause or reset')
		}
	})

	it('allows deleting a paused current session, which clears the timer', () => {
		const paused = stateFrom(
			sessionsEvent([{ id: 's1', index: 0, name: 'One', is_current: true }]),
			controlCenterEvent({ timer_run_state: 'paused', current_session_id: 's1' }),
		)
		expect(buildDeleteSession(paused, '').ok).toBe(true)
	})

	it('allows deleting a different session while one runs', () => {
		const running = stateFrom(
			sessionsEvent([
				{ id: 's1', index: 0, name: 'One', is_current: true },
				{ id: 's2', index: 1, name: 'Two' },
			]),
			controlCenterEvent({ timer_run_state: 'running', current_session_id: 's1' }),
		)
		expect(buildDeleteSession(running, 's2')).toEqual({ ok: true, payload: { session_id: 's2' } })
	})
})

describe('buildUpdateSession', () => {
	const editable = stateFrom(
		sessionsEvent([
			{ id: 's1', index: 0, name: 'One', mode: 'countdown', duration: 30 },
			{ id: 's2', index: 1, name: 'Two', mode: 'countdown', duration: 30, is_current: true },
		]),
		controlCenterEvent({ timer_run_state: 'paused', current_session_id: 's2', current_session_index: 1 }),
	)

	it('defaults to the current session and sends only the id when nothing changes', () => {
		expect(buildUpdateSession(editable, { mode: MODE_KEEP })).toEqual({
			ok: true,
			payload: { session_id: 's2' },
		})
	})

	it('preserves omitted fields by omitting them from the payload', () => {
		// Every text field blank => nothing but the id, so nothing is overwritten.
		const built = buildUpdateSession(editable, {
			mode: MODE_KEEP,
			name: '',
			presenterName: '   ',
			notes: '',
			seconds: '',
			offset: '',
		})
		expect(built).toEqual({ ok: true, payload: { session_id: 's2' } })
	})

	it('sends only the fields that were given', () => {
		expect(buildUpdateSession(editable, { mode: MODE_KEEP, name: 'Renamed' })).toEqual({
			ok: true,
			payload: { session_id: 's2', name: 'Renamed' },
		})
		expect(buildUpdateSession(editable, { mode: MODE_KEEP, seconds: '90' })).toEqual({
			ok: true,
			payload: { session_id: 's2', seconds: 90 },
		})
	})

	it('refuses to edit a running session', () => {
		const running = stateFrom(
			sessionsEvent([{ id: 's2', index: 0, name: 'Two', mode: 'countdown', duration: 30, is_current: true }]),
			controlCenterEvent({ timer_run_state: 'running', current_session_id: 's2' }),
		)
		const built = buildUpdateSession(running, { mode: MODE_KEEP, name: 'Nope' })
		expect(built.ok).toBe(false)
		if (!built.ok) {
			expect(built.kind).toBe('noop')
			expect(built.reason).toContain('pause or reset')
		}
	})

	it('carries a time-of-day start as milliseconds past midnight', () => {
		expect(buildUpdateSession(editable, { mode: 'time_of_day', offset: '01:00:00' })).toEqual({
			ok: true,
			payload: { session_id: 's2', mode: 'time_of_day', offset: 3600000 },
		})
	})

	it('requires an offset when switching a session to time of day', () => {
		// The device rejects this; catch it locally with a clearer message.
		const built = buildUpdateSession(editable, { mode: 'time_of_day' })
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.reason).toContain('needs an offset')
	})

	it('lets an existing time-of-day session keep its start time', () => {
		const tod = stateFrom(
			sessionsEvent([{ id: 't', index: 0, name: 'Clock', mode: 'time_of_day', is_current: true }]),
			controlCenterEvent({ timer_run_state: 'paused', current_session_id: 't' }),
		)
		// Mode and offset both omitted => not a switch, so the start time is preserved.
		expect(buildUpdateSession(tod, { mode: MODE_KEEP, name: 'Renamed' })).toEqual({
			ok: true,
			payload: { session_id: 't', name: 'Renamed' },
		})
	})

	it('never sends a duration for a time-of-day session', () => {
		const built = buildUpdateSession(editable, { mode: 'time_of_day', offset: '12:00:00', seconds: '600' })
		expect(built.ok).toBe(true)
		if (built.ok) expect(built.payload).not.toHaveProperty('seconds')
	})

	it('enforces the one-second floor on the resulting countdown', () => {
		expect(reasonOf(buildUpdateSession(editable, { mode: MODE_KEEP, seconds: '0' }))).toContain('at least 1 second')
		expect(reasonOf(buildUpdateSession(editable, { mode: MODE_KEEP, seconds: '1.5' }))).toContain('whole number')
		expect(buildUpdateSession(editable, { mode: MODE_KEEP, seconds: '1' }).ok).toBe(true)
	})

	it('refuses to switch a session to countdown with no duration to fall back on', () => {
		// A count-up may be lengthless; a countdown may not.
		const countup = stateFrom(
			sessionsEvent([{ id: 'c', index: 0, name: 'Up', mode: 'countup', is_current: true }]),
			controlCenterEvent({ timer_run_state: 'paused', current_session_id: 'c' }),
		)
		const built = buildUpdateSession(countup, { mode: 'countdown' })
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.reason).toContain('duration')

		// But supplying one is fine.
		expect(buildUpdateSession(countup, { mode: 'countdown', seconds: '30' })).toEqual({
			ok: true,
			payload: { session_id: 'c', mode: 'countdown', seconds: 30 },
		})
	})

	it('includes flash timing only when positive', () => {
		const built = buildUpdateSession(editable, {
			mode: MODE_KEEP,
			flashStartSeconds: 15,
			flashLengthSeconds: 0,
		})
		expect(built).toEqual({
			ok: true,
			payload: { session_id: 's2', flash_start_time_seconds: 15 },
		})
	})

	it('reports no-ops when there is nothing to update', () => {
		const built = buildUpdateSession(createInitialState(), { mode: MODE_KEEP })
		expect(built.ok).toBe(false)
		if (!built.ok) {
			expect(built.kind).toBe('noop')
			expect(built.reason).toContain('no session')
		}
	})
})

describe('buildSessionMove', () => {
	it('treats a blank id as the current session', () => {
		expect(buildSessionMove(threeSessions, '', 'up')).toEqual({ ok: true, payload: { session_id: 's2' } })
		expect(buildSessionMove(threeSessions, undefined, 'up')).toEqual({ ok: true, payload: { session_id: 's2' } })
	})

	it('honours an explicit id over the current session', () => {
		expect(buildSessionMove(threeSessions, 's1', 'down')).toEqual({ ok: true, payload: { session_id: 's1' } })
	})

	it('reports no-ops at the boundaries and when nothing is current', () => {
		const first = buildSessionMove(threeSessions, 's1', 'up')
		expect(first.ok).toBe(false)
		if (!first.ok) {
			expect(first.kind).toBe('noop')
			expect(first.reason).toContain('already first')
		}

		const last = buildSessionMove(threeSessions, 's3', 'down')
		expect(last.ok).toBe(false)
		if (!last.ok) expect(last.reason).toContain('already last')

		const idle = buildSessionMove(createInitialState(), '', 'up')
		expect(idle.ok).toBe(false)
		if (!idle.ok) {
			expect(idle.kind).toBe('noop')
			expect(idle.reason).toContain('no session')
		}
	})

	it('still allows an explicit id when no session is current', () => {
		// Two sessions so the target is not also first (a lone session is both first
		// and last, making every move a legitimate no-op).
		const idleButKnown = stateFrom(helloEvent(), sessionsEvent([{ id: 'a' }, { id: 'only' }]))
		expect(buildSessionMove(idleButKnown, 'only', 'up')).toEqual({ ok: true, payload: { session_id: 'only' } })
	})
})

describe('entering the program from idle', () => {
	// Idle: a program is loaded but nothing is current (current_session_index -1).
	const idleWithProgram = stateFrom(
		sessionsEvent([
			{ id: 's1', index: 0, name: 'One', mode: 'countdown' },
			{ id: 's2', index: 1, name: 'Two', mode: 'countup' },
		]),
		controlCenterEvent({ current_session_index: -1, current_session_id: '' }),
	)
	// Same program, with the first session selected.
	const onFirst = stateFrom(
		sessionsEvent([
			{ id: 's1', index: 0, name: 'One', mode: 'countdown', is_current: true },
			{ id: 's2', index: 1, name: 'Two', mode: 'countup' },
		]),
		controlCenterEvent({ current_session_index: 0, current_session_id: 's1', is_next_session: true }),
	)

	it('starts the first session from idle, since bare start_session is rejected', () => {
		// Verified on firmware 1.1.2.27: naming the first session takes idle -> running
		// in one command, whereas bare start_session is INVALID_COMMAND ("No active
		// session to start").
		expect(buildStartSession(idleWithProgram)).toEqual({ ok: true, payload: { session_id: 's1' } })
	})

	it('sends a plain start when a session is already current (resume)', () => {
		expect(buildStartSession(onFirst)).toEqual({ ok: true, payload: {} })
	})

	it('reports nothing to start when the program is empty', () => {
		const built = buildStartSession(createInitialState())
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.reason).toContain('no program')
	})

	it('navigates normally once a session is current', () => {
		expect(planNavigation(onFirst, 'next')).toEqual({ ok: true, command: 'navigate', direction: 'next' })
	})

	it('selects the first session from idle instead of a rejected navigate', () => {
		// The device has no fallback to the first session, so navigating from idle is
		// INVALID_COMMAND ("No next session available") — we substitute show_session.
		expect(planNavigation(idleWithProgram, 'next')).toEqual({
			ok: true,
			command: 'show_session',
			sessionId: 's1',
		})
		// Both directions: there is nothing before the start of a program, and a dead
		// button is worse than a predictable one.
		expect(planNavigation(idleWithProgram, 'previous')).toEqual({
			ok: true,
			command: 'show_session',
			sessionId: 's1',
		})
	})

	it('reports why navigating is a no-op rather than silently doing nothing', () => {
		const atLast = stateFrom(
			sessionsEvent([
				{ id: 's1', index: 0, name: 'One', is_current: true },
				{ id: 's2', index: 1, name: 'Two' },
			]),
			controlCenterEvent({ current_session_index: 1, is_next_session: false, is_previous_session: true }),
		)
		const next = planNavigation(atLast, 'next')
		expect(next.ok).toBe(false)
		if (!next.ok) expect(next.reason).toContain('last')

		const atFirst = planNavigation(onFirst, 'previous')
		expect(atFirst.ok).toBe(false)
		if (!atFirst.ok) expect(atFirst.reason).toContain('first')

		const noProgram = planNavigation(createInitialState(), 'next')
		expect(noProgram.ok).toBe(false)
		if (!noProgram.ok) expect(noProgram.reason).toContain('no program')
	})

	it('shows a session by position, so no id has to be known', () => {
		expect(buildShowSession(idleWithProgram, 1)).toEqual({ ok: true, payload: { session_id: 's1' } })
		expect(buildShowSession(idleWithProgram, 2)).toEqual({ ok: true, payload: { session_id: 's2' } })
		const outOfRange = buildShowSession(idleWithProgram, 3)
		expect(outOfRange.ok).toBe(false)
		if (!outOfRange.ok) expect(outOfRange.reason).toContain('has 2')
		expect(buildShowSession(idleWithProgram, 0).ok).toBe(false)
	})
})

describe('flash window validation', () => {
	// The device enforces these for countdown sessions only, and rejects with
	// "Flash length must be ≤ flash start time" / "Flash start time must be ≤
	// session duration". Refusing locally explains the problem at the control that
	// caused it instead of leaving a warning in the log.
	it('refuses a countdown whose flash length exceeds its flash start time', () => {
		const built = buildAddSession({ mode: 'countdown', seconds: 60, flashStartSeconds: 30, flashLengthSeconds: 31 })
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.reason).toContain('cannot exceed the flash start time')
	})

	it('refuses a countdown whose flash starts after the session ends', () => {
		const built = buildAddSession({ mode: 'countdown', seconds: 30, flashStartSeconds: 31, flashLengthSeconds: 5 })
		expect(built.ok).toBe(false)
		if (!built.ok) expect(built.reason).toContain('cannot exceed the session duration')
	})

	it('accepts the boundary values the device accepts', () => {
		expect(buildAddSession({ mode: 'countdown', seconds: 30, flashStartSeconds: 30, flashLengthSeconds: 30 }).ok).toBe(
			true,
		)
		expect(buildAddSession({ mode: 'countdown', seconds: 60, flashStartSeconds: 30, flashLengthSeconds: 30 }).ok).toBe(
			true,
		)
		// Length is deliberately not compared with the duration: this fires entirely on screen.
		expect(buildAddSession({ mode: 'countdown', seconds: 60, flashStartSeconds: 55, flashLengthSeconds: 30 }).ok).toBe(
			true,
		)
	})

	it('does not apply the rules to count-up or time-of-day, which the device does not enforce', () => {
		expect(buildAddSession({ mode: 'countup', seconds: 10, flashStartSeconds: 5, flashLengthSeconds: 10 }).ok).toBe(
			true,
		)
		expect(
			buildAddSession({ mode: 'time_of_day', offset: '12:00:00', flashStartSeconds: 5, flashLengthSeconds: 10 }).ok,
		).toBe(true)
	})

	it('checks the session as an update will leave it, not just the fields in the frame', () => {
		const state = stateFrom(
			sessionsEvent([
				{
					id: 's1',
					index: 0,
					name: 'Countdown',
					mode: 'countdown',
					duration: 60,
					flash_start_time_seconds: 30,
					flash_length_seconds: 10,
					is_current: true,
				},
			]),
			controlCenterEvent({ timer_run_state: 'paused', current_session_id: 's1' }),
		)

		// Raising the length past the stored start is refused, even though only the
		// length was sent.
		const tooLong = buildUpdateSession(state, { mode: MODE_KEEP, flashLengthSeconds: 40 })
		expect(tooLong.ok).toBe(false)
		if (!tooLong.ok) expect(tooLong.reason).toContain('cannot exceed the flash start time')

		// Shortening the duration under the stored start is refused too.
		const tooShort = buildUpdateSession(state, { mode: MODE_KEEP, seconds: '20' })
		expect(tooShort.ok).toBe(false)
		if (!tooShort.ok) expect(tooShort.reason).toContain('cannot exceed the session duration')

		// Moving both together is fine.
		expect(buildUpdateSession(state, { mode: MODE_KEEP, seconds: '20', flashStartSeconds: 15 }).ok).toBe(true)
	})
})
