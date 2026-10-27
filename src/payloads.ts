/**
 * Pure builders for every command payload this module sends.
 *
 * These live outside the action callbacks deliberately. The `ms`-vs-deprecated-
 * `seconds` bug and the time-of-day `offset`-in-seconds bug both shipped because
 * the conversions sat inside callbacks that no test could reach — they were caught
 * by re-reading the spec, not by the suite. Anything that turns operator input into
 * wire fields belongs here instead, where it can be unit-tested directly.
 *
 * Builders do not send anything and do not read the clock: given the same state and
 * options they always produce the same result, so they are safe to assert on.
 */

import type { CommandPayloads } from './protocol/generated.ts'
import type { ProtocolState } from './protocol/state.ts'
import {
	checkIsPlaying,
	firstSessionId,
	isIdle,
	resolveMessageIdByPosition,
	resolveSessionId,
	resolveSessionIdByPosition,
	sessionPosition,
} from './logic.ts'

/**
 * A payload ready to send, or why nothing should be sent.
 *
 * `kind` separates operator mistakes from no-ops so callers can log the first at
 * `warn` and the second at `debug` — pressing "move down" on the last item is not a
 * problem worth warning about.
 */
export type Built<P> = { ok: true; payload: P } | { ok: false; kind: 'invalid' | 'noop'; reason: string }

/** vc146 rejects a countdown shorter than this. */
export const COUNTDOWN_MIN_SECONDS = 1

export const BRIGHTNESS_MIN = 0
export const BRIGHTNESS_MAX = 100

export const SESSION_MODES = ['countdown', 'countup', 'time_of_day'] as const
export type SessionMode = (typeof SESSION_MODES)[number]

function optionalText(value: unknown): string {
	return String(value ?? '').trim()
}

/**
 * Converts user-facing seconds into the whole milliseconds the protocol's `ms`
 * field wants.
 *
 * `add_time` / `subtract_time` still accept a `seconds` field, but it is
 * deprecated, whole-seconds only, and ignored outright whenever `ms` is nonzero —
 * so `ms` is the only field worth sending. Fractional seconds are fine here and
 * become whole milliseconds.
 */
export function toWholeMs(seconds: unknown): number | null {
	const value = Number(seconds ?? 0)
	if (!Number.isFinite(value)) return null
	return Math.round(value * 1000)
}

/**
 * Parses `HH:MM` / `HH:MM:SS` into **milliseconds past midnight**.
 *
 * vc146's `time_of_day` `offset` is milliseconds — confirmed against firmware
 * (sent `3600000`, echoed `3600000`) — even though it is always a whole number of
 * seconds.
 */
export function parseTimeOfDayOffsetMs(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
	if (!match) return null

	const hours = Number(match[1])
	const minutes = Number(match[2])
	const seconds = Number(match[3] ?? 0)
	if (hours > 23 || minutes > 59 || seconds > 59) return null

	return (hours * 3600 + minutes * 60 + seconds) * 1000
}

/** `add_time` / `subtract_time`. The device treats a negative amount as the inverse. */
export function buildTimeDelta(seconds: unknown): Built<CommandPayloads['add_time']> {
	const ms = toWholeMs(seconds)
	if (ms === null) return { ok: false, kind: 'invalid', reason: 'the amount must be a number of seconds' }
	return { ok: true, payload: { ms } }
}

/** `set_brightness`. The device rejects fractional or out-of-range values outright. */
export function buildBrightness(value: unknown): Built<CommandPayloads['set_brightness']> {
	const brightness = Number(value ?? 0)
	if (!Number.isInteger(brightness) || brightness < BRIGHTNESS_MIN || brightness > BRIGHTNESS_MAX) {
		return {
			ok: false,
			kind: 'invalid',
			reason: `brightness must be a whole number from ${BRIGHTNESS_MIN} to ${BRIGHTNESS_MAX}`,
		}
	}
	return { ok: true, payload: { brightness } }
}

/**
 * The flash-window rules a countdown session must satisfy.
 *
 * A countdown's cue runs from `flash_start_time_seconds` back to
 * (`flash_start_time_seconds` − `flash_length_seconds`), so the device refuses a
 * window that starts before the session does or extends past the point the
 * flashing begins:
 *
 * - `flash_length_seconds <= flash_start_time_seconds`
 * - `flash_start_time_seconds <= duration`
 *
 * Both are enforced by the device for **countdown sessions only** — a count-up has
 * no duration bounding its window, and a time-of-day session never flashes — and
 * the two rejections carry "Flash length must be ≤ flash start time" and "Flash
 * start time must be ≤ session duration". Checking here turns a device rejection
 * (which the module can only log as a warning) into an explanation at the control
 * that produced it.
 *
 * The length is deliberately *not* compared with the duration: a 60 s countdown
 * with start 55 / length 30 is valid, and it fires entirely on screen.
 */
function flashWindowProblem(
	mode: SessionMode | null,
	durationSeconds: number,
	flashStartSeconds: number,
	flashLengthSeconds: number,
): string | null {
	if (mode !== 'countdown') return null
	if (flashLengthSeconds > flashStartSeconds) {
		return `the flash length (${flashLengthSeconds}s) cannot exceed the flash start time (${flashStartSeconds}s)`
	}
	if (flashStartSeconds > durationSeconds) {
		return `the flash start time (${flashStartSeconds}s) cannot exceed the session duration (${durationSeconds}s)`
	}
	return null
}

export interface AddSessionOptions {
	name?: unknown
	mode?: unknown
	seconds?: unknown
	offset?: unknown
	presenterName?: unknown
	notes?: unknown
	flashStartSeconds?: unknown
	flashLengthSeconds?: unknown
}

/**
 * `add_session`. Appends a session; it does not select or start one.
 *
 * Sessions carry their duration in **seconds** (unlike the control-center time
 * fields, which are milliseconds) and a time-of-day session carries an `offset` in
 * **milliseconds past midnight** instead of a duration.
 */
export function buildAddSession(options: AddSessionOptions): Built<CommandPayloads['add_session']> {
	const mode = String(options.mode ?? 'countdown') as SessionMode
	if (!SESSION_MODES.includes(mode)) {
		return { ok: false, kind: 'invalid', reason: `unknown session mode '${mode}'` }
	}

	const payload: CommandPayloads['add_session'] = { mode }

	const name = optionalText(options.name)
	if (name) payload.name = name

	const presenter = optionalText(options.presenterName)
	if (presenter) payload.presenter_name = presenter

	const notes = optionalText(options.notes)
	if (notes) payload.notes = notes

	if (mode === 'time_of_day') {
		// A wall clock has no length, so it takes an offset instead of a duration.
		const offset = parseTimeOfDayOffsetMs(String(options.offset ?? ''))
		if (offset === null) {
			return {
				ok: false,
				kind: 'invalid',
				reason: 'a time-of-day session needs an offset of HH:MM:SS within 00:00:00–23:59:59',
			}
		}
		payload.offset = offset
	} else {
		const seconds = Number(options.seconds ?? 0)
		if (!Number.isInteger(seconds) || seconds < 0) {
			return {
				ok: false,
				kind: 'invalid',
				reason: 'the duration must be a whole number of seconds',
			}
		}
		// The device rejects a countdown shorter than one second; do not send one.
		if (mode === 'countdown' && seconds < COUNTDOWN_MIN_SECONDS) {
			return {
				ok: false,
				kind: 'invalid',
				reason: `a countdown needs at least ${COUNTDOWN_MIN_SECONDS} second`,
			}
		}
		payload.seconds = seconds
	}

	const flashStart = Number(options.flashStartSeconds ?? 0)
	if (Number.isFinite(flashStart) && flashStart > 0) payload.flash_start_time_seconds = flashStart

	const flashLength = Number(options.flashLengthSeconds ?? 0)
	if (Number.isFinite(flashLength) && flashLength > 0) payload.flash_length_seconds = flashLength

	const problem = flashWindowProblem(
		mode,
		Number(payload.seconds ?? 0),
		Number(payload.flash_start_time_seconds ?? 0),
		Number(payload.flash_length_seconds ?? 0),
	)
	if (problem) return { ok: false, kind: 'invalid', reason: problem }

	return { ok: true, payload }
}

export interface ShowMessageOptions {
	messageNumber?: unknown
	text?: unknown
	flash?: unknown
}

/** The two mutually exclusive addressing forms `show_message` accepts. */
export type ShowMessageTarget = { message_id: string } | { text: string }

/**
 * `show_message`, addressed **either** by a stored message's position or by literal
 * text — the schema requires exactly one of `message_id` / `text` (`anyOf`), and a
 * non-empty `message_id` wins over `text`.
 *
 * Addressed by id it names a program message; addressed by text it is an ad-hoc
 * overlay that leaves the program untouched (and, unlike the id form, needs no
 * program loaded).
 *
 * `flash` is three-state and is only ever sent when the operator asked for it:
 * omitting it leaves the flash flag alone, which is the only form whose meaning does
 * not depend on the firmware revision — `false` means "stop the flash" in the
 * current protocol revision but was a documented no-op in the revision this module
 * first pinned, and both report version code 146.
 */
export function buildShowMessage(
	state: ProtocolState,
	options: ShowMessageOptions,
): Built<CommandPayloads['show_message']> {
	const target = buildShowMessageTarget(state, options)
	if (!target.ok) return target

	const payload: CommandPayloads['show_message'] = { ...target.payload }

	const flash = String(options.flash ?? 'keep')
	if (flash === 'on') payload.flash = true
	else if (flash === 'off') payload.flash = false

	return { ok: true, payload }
}

function buildShowMessageTarget(state: ProtocolState, options: ShowMessageOptions): Built<ShowMessageTarget> {
	const position = Number(options.messageNumber ?? 0)

	if (position > 0) {
		const messageId = resolveMessageIdByPosition(state, position)
		if (!messageId) {
			return {
				ok: false,
				kind: 'invalid',
				reason: `no stored message at position ${position} (the program has ${state.messageList.length})`,
			}
		}
		return { ok: true, payload: { message_id: messageId } }
	}

	const text = String(options.text ?? '')
	if (text.trim().length === 0) {
		return {
			ok: false,
			kind: 'invalid',
			reason: 'no stored message number was given and the text is empty',
		}
	}
	return { ok: true, payload: { text } }
}

/**
 * Whether the given message is the one currently on screen, so a Show Message button
 * can act as a toggle for *its* message rather than for messages in general.
 *
 * Accepts a built payload directly. The two addressing forms are reported in
 * different fields: a stored message names itself in `view.message_id`, an ad-hoc one
 * sets `view.message_text` and leaves the id empty.
 */
export function isMessageShowing(
	state: ProtocolState,
	target: { message_id?: string | null; text?: string | null },
): boolean {
	const messageId = target.message_id ?? ''
	if (messageId.length > 0) return (state.view?.message_id ?? '') === messageId

	const text = target.text ?? ''
	if (text.length > 0) return (state.view?.message_text ?? '') === text

	// Nothing to compare against. Falling through to the text comparison here would
	// match an empty view and report that an unaddressed message is on screen.
	return false
}

/** `add_message`. Appends to the program's message list; it does not display it. */
export function buildAddMessage(content: unknown): Built<{ content: string }> {
	const text = String(content ?? '')
	if (text.trim().length === 0) {
		return { ok: false, kind: 'invalid', reason: 'the message text is empty' }
	}
	return { ok: true, payload: { content: text } }
}

/**
 * `update_message`, addressed by 1-based position in the program's message list.
 *
 * Both fields are required by the device, so an empty replacement is rejected here
 * rather than being sent as a no-op command. Unlike `delete_message`, updating the
 * message that is on screen is allowed — the device raises `DEVICE_BUSY` only for
 * deletion.
 */
export function buildUpdateMessage(
	state: ProtocolState,
	position: unknown,
	content: unknown,
): Built<{ message_id: string; content: string }> {
	const index = Number(position ?? 0)
	const messageId = resolveMessageIdByPosition(state, index)
	if (!messageId) {
		return {
			ok: false,
			kind: 'invalid',
			reason: `no message at position ${index} (the program has ${state.messageList.length})`,
		}
	}

	const text = String(content ?? '')
	if (text.trim().length === 0) {
		return { ok: false, kind: 'invalid', reason: 'the replacement text is empty' }
	}

	return { ok: true, payload: { message_id: messageId, content: text } }
}

/** `show_session`, addressed by 1-based position in program order. */
export function buildShowSession(state: ProtocolState, position: unknown): Built<{ session_id: string }> {
	const index = Number(position ?? 0)
	const sessionId = resolveSessionIdByPosition(state, index)
	if (!sessionId) {
		return {
			ok: false,
			kind: 'invalid',
			reason: `no session at position ${index} (the program has ${state.sessionList.length})`,
		}
	}
	return { ok: true, payload: { session_id: sessionId } }
}

/**
 * `start_session`, which has to be told what to start when nothing is current.
 *
 * Bare `start_session` acts on the current session, and vc146 rejects it outright when
 * there is none — `INVALID_COMMAND`, "No active session to start". Naming the first
 * session instead makes one command load *and* start it, which is what a Play button
 * should do from an idle display. Verified on firmware 1.1.2.27: idle -> running in a
 * single command.
 */
export function buildStartSession(state: ProtocolState): Built<CommandPayloads['start_session']> {
	if (!isIdle(state)) return { ok: true, payload: {} }

	const first = firstSessionId(state)
	if (!first) {
		return { ok: false, kind: 'noop', reason: 'there is no program loaded, so there is nothing to start' }
	}
	return { ok: true, payload: { session_id: first } }
}

export type NavDirection = 'next' | 'previous'

/**
 * What a forward/back button should actually send.
 *
 * `navigate_next_session` / `navigate_previous_session` are rejected when there is no
 * current session — the device explicitly has no fallback to the first session — so an
 * idle display needs `show_session` instead. Both directions select the *first* session
 * from idle: there is nothing before the start of a program, and a dead button is worse
 * than a predictable one.
 *
 * The device leaves a navigated session **paused**; starting it is a separate
 * `start_session`.
 */
export type NavigationPlan =
	| { ok: true; command: 'navigate'; direction: NavDirection }
	| { ok: true; command: 'show_session'; sessionId: string }
	| { ok: false; kind: 'noop'; reason: string }

export function planNavigation(state: ProtocolState, direction: NavDirection): NavigationPlan {
	if (isIdle(state)) {
		const first = firstSessionId(state)
		if (!first) {
			return { ok: false, kind: 'noop', reason: 'there is no program loaded, so there is nothing to navigate' }
		}
		return { ok: true, command: 'show_session', sessionId: first }
	}

	const available =
		direction === 'next'
			? state.controlCenter?.is_next_session === true
			: state.controlCenter?.is_previous_session === true

	if (!available) {
		return {
			ok: false,
			kind: 'noop',
			reason: direction === 'next' ? 'already at the last session' : 'already at the first session',
		}
	}

	return { ok: true, command: 'navigate', direction }
}

/**
 * Whether a command would touch the session whose timer is currently running.
 *
 * vc146 refuses to edit or delete a *running* session (`INVALID_COMMAND` and
 * `DEVICE_BUSY` respectively). The timer engine is single and global, so "running"
 * only ever describes the current session.
 */
function isRunningCurrentSession(state: ProtocolState, sessionId: string): boolean {
	if (!checkIsPlaying(state)) return false
	return sessionId === (state.controlCenter?.current_session_id ?? '')
}

/**
 * `delete_session`.
 *
 * A blank id means the current session. Deleting the current session while it is
 * paused or idle also clears the timer and returns the display to IDLE — a side
 * effect worth knowing, but one the device performs, not us.
 */
export function buildDeleteSession(state: ProtocolState, sessionId: unknown): Built<{ session_id: string }> {
	const resolved = resolveSessionId(state, String(sessionId ?? ''))
	if (!resolved) {
		return { ok: false, kind: 'noop', reason: 'no session to delete — none was named and none is current' }
	}

	if (isRunningCurrentSession(state, resolved)) {
		return {
			ok: false,
			kind: 'noop',
			reason: 'the current session is running; pause or reset it first',
		}
	}

	return { ok: true, payload: { session_id: resolved } }
}

/** Mode value meaning "leave the session's mode as it is". */
export const MODE_KEEP = 'keep'

export interface UpdateSessionOptions {
	sessionId?: unknown
	name?: unknown
	mode?: unknown
	seconds?: unknown
	offset?: unknown
	presenterName?: unknown
	notes?: unknown
	flashStartSeconds?: unknown
	flashLengthSeconds?: unknown
}

/**
 * `update_session` — edits an existing session, preserving every field left out.
 *
 * A blank id means the current session. Two documented rules are enforced here so the
 * operator gets an explanation instead of a bare device error:
 *
 * - a **running** session cannot be edited at all ("pause or reset it first");
 * - switching a session **to** `time_of_day` needs an `offset`, because a wall clock
 *   with no start time is not a session.
 *
 * Text fields left blank are *omitted*, which preserves them — so these actions can
 * change a field but not clear one. Clearing would need an explicit "clear" control,
 * and silently wiping a field on an action usually used to change one thing is the
 * worse failure.
 */
export function buildUpdateSession(
	state: ProtocolState,
	options: UpdateSessionOptions,
): Built<CommandPayloads['update_session']> {
	const sessionId = resolveSessionId(state, String(options.sessionId ?? ''))
	if (!sessionId) {
		return { ok: false, kind: 'noop', reason: 'no session to update — none was named and none is current' }
	}

	if (isRunningCurrentSession(state, sessionId)) {
		return {
			ok: false,
			kind: 'noop',
			reason: 'the current session is running; pause or reset it first',
		}
	}

	const requestedMode = String(options.mode ?? MODE_KEEP)
	if (requestedMode !== MODE_KEEP && !SESSION_MODES.includes(requestedMode as SessionMode)) {
		return { ok: false, kind: 'invalid', reason: `unknown session mode '${requestedMode}'` }
	}

	const existing = state.sessionList.find((item) => item.id === sessionId)
	const existingMode = existing?.mode ?? null
	// Omitted fields are preserved, so an unspecified mode means "whatever it already is".
	const effectiveMode = requestedMode === MODE_KEEP ? existingMode : requestedMode

	const payload: CommandPayloads['update_session'] = { session_id: sessionId }
	if (requestedMode !== MODE_KEEP) payload.mode = requestedMode

	const name = optionalText(options.name)
	if (name) payload.name = name

	const presenter = optionalText(options.presenterName)
	if (presenter) payload.presenter_name = presenter

	const notes = optionalText(options.notes)
	if (notes) payload.notes = notes

	const offsetText = optionalText(options.offset)
	if (offsetText.length > 0) {
		const offset = parseTimeOfDayOffsetMs(offsetText)
		if (offset === null) {
			return { ok: false, kind: 'invalid', reason: 'the offset must be HH:MM:SS within 00:00:00–23:59:59' }
		}
		payload.offset = offset
	} else if (requestedMode === 'time_of_day' && existingMode !== 'time_of_day') {
		return {
			ok: false,
			kind: 'invalid',
			reason: 'switching a session to time_of_day needs an offset of HH:MM:SS',
		}
	}

	if (effectiveMode !== 'time_of_day') {
		// The duration is entered as text so that blank can mean "leave unchanged" — a
		// number input always carries a value and would silently rewrite the duration.
		const secondsText = String(options.seconds ?? '').trim()

		if (secondsText.length > 0) {
			const seconds = Number(secondsText)
			if (!Number.isInteger(seconds) || seconds < 0) {
				return { ok: false, kind: 'invalid', reason: 'the duration must be a whole number of seconds' }
			}
			if (effectiveMode === 'countdown' && seconds < COUNTDOWN_MIN_SECONDS) {
				return {
					ok: false,
					kind: 'invalid',
					reason: `a countdown needs at least ${COUNTDOWN_MIN_SECONDS} second`,
				}
			}
			payload.seconds = seconds
		} else if (effectiveMode === 'countdown' && (existing?.duration ?? 0) < COUNTDOWN_MIN_SECONDS) {
			// Switching a session to countdown without a duration would leave a countdown
			// below the one-second floor, which the device rejects.
			return {
				ok: false,
				kind: 'invalid',
				reason: 'a countdown needs a duration of at least 1 second',
			}
		}
	}

	const flashStart = Number(options.flashStartSeconds ?? 0)
	if (Number.isFinite(flashStart) && flashStart > 0) payload.flash_start_time_seconds = flashStart

	const flashLength = Number(options.flashLengthSeconds ?? 0)
	if (Number.isFinite(flashLength) && flashLength > 0) payload.flash_length_seconds = flashLength

	// The device checks the session as it will be stored, not just the fields in the
	// frame, so a partial edit that leaves the window invalid is refused too.
	const problem = flashWindowProblem(
		effectiveMode as SessionMode | null,
		Number(payload.seconds ?? existing?.duration ?? 0),
		Number(payload.flash_start_time_seconds ?? existing?.flash_start_time_seconds ?? 0),
		Number(payload.flash_length_seconds ?? existing?.flash_length_seconds ?? 0),
	)
	if (problem) return { ok: false, kind: 'invalid', reason: problem }

	return { ok: true, payload }
}

/** `delete_message`, addressed by 1-based position in the program's message list. */
export function buildDeleteMessage(state: ProtocolState, position: unknown): Built<{ message_id: string }> {
	const index = Number(position ?? 0)
	const messageId = resolveMessageIdByPosition(state, index)
	if (!messageId) {
		return {
			ok: false,
			kind: 'invalid',
			reason: `no message at position ${index} (the program has ${state.messageList.length})`,
		}
	}
	return { ok: true, payload: { message_id: messageId } }
}

export type MoveDirection = 'up' | 'down'

/**
 * `move_message_up` / `move_message_down`, addressed by position.
 *
 * A message already at the boundary is a no-op, not an error: the device would
 * reject it with `INVALID_PARAMETER`, so there is no point asking.
 */
export function buildMessageMove(
	state: ProtocolState,
	position: unknown,
	direction: MoveDirection,
): Built<{ message_id: string }> {
	const index = Number(position ?? 0)
	const messageId = resolveMessageIdByPosition(state, index)
	if (!messageId) {
		return {
			ok: false,
			kind: 'invalid',
			reason: `no message at position ${index} (the program has ${state.messageList.length})`,
		}
	}

	if (direction === 'up' && index === 1) {
		return { ok: false, kind: 'noop', reason: 'that message is already first in program order' }
	}
	if (direction === 'down' && index === state.messageList.length) {
		return { ok: false, kind: 'noop', reason: 'that message is already last in program order' }
	}

	return { ok: true, payload: { message_id: messageId } }
}

/**
 * `move_session_up` / `move_session_down`.
 *
 * A blank session id means the **current** session, which is what an operator means
 * mid-show; an explicit id overrides it. Boundary moves are no-ops here too.
 */
export function buildSessionMove(
	state: ProtocolState,
	sessionId: unknown,
	direction: MoveDirection,
): Built<{ session_id: string }> {
	const resolved = resolveSessionId(state, String(sessionId ?? ''))
	if (!resolved) {
		return {
			ok: false,
			kind: 'noop',
			reason: 'no session to move — none was named and none is current',
		}
	}

	const position = sessionPosition(state, resolved)
	if (direction === 'up' && position === 1) {
		return { ok: false, kind: 'noop', reason: 'that session is already first in program order' }
	}
	if (direction === 'down' && position !== null && position === state.sessionList.length) {
		return { ok: false, kind: 'noop', reason: 'that session is already last in program order' }
	}

	return { ok: true, payload: { session_id: resolved } }
}
