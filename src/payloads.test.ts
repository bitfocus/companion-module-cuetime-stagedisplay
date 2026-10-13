import { describe, it, expect } from 'vitest'
import {
	BRIGHTNESS_MAX,
	BRIGHTNESS_MIN,
	COUNTDOWN_MIN_SECONDS,
	buildAddSession,
	buildBrightness,
	buildDeleteMessage,
	buildMessageMove,
	buildSessionMove,
	buildShowMessage,
	buildTimeDelta,
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
