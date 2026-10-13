import type { Config } from './main.ts'
import type { ProtocolState } from './protocol/state.ts'

// ---- Host/port resolution ----

/** Prefers the Bonjour-discovered device, falling back to the manually entered host. */
export function getEffectiveHost(config: Pick<Config, 'host' | 'cuetime-display'>): string {
	if (config['cuetime-display']) {
		return config['cuetime-display']
	}
	return config.host || ''
}

/** The WebSocket transport lives on port 8081 (HTTP is 8080 and unused here). */
export function getEffectivePort(config: Pick<Config, 'port'>): string {
	return config.port || '8081'
}

// ---- Time formatting ----

/**
 * Formats a millisecond duration for display: `MM:SS`, or `HH:MM:SS` once it
 * passes an hour. Negative and zero inputs render as `00:00` because the
 * protocol's `timer` field is the unsigned on-screen reading.
 */
export function formatTime(ms: number): string {
	if (!ms || ms < 0) {
		return '00:00'
	}
	const totalSeconds = Math.floor(ms / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60

	const pad = (n: number): string => n.toString().padStart(2, '0')

	if (hours > 0) {
		return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
	}
	return `${pad(minutes)}:${pad(seconds)}`
}

// ---- Variables ----

/**
 * Declared as a type alias (not an interface) so it is assignable to
 * `CompanionVariableValues`, which is an index-signature type.
 */
export type VariableValues = {
	timer_run_state: string
	elapsed_time: number
	timer: number
	current_session_name: string
	current_presenter_name: string
	current_session_id: string
	current_session_mode: string
	is_playing: string
	is_glowing: string
	is_blackout: string
	message_text: string
	current_session_number: number
	total_sessions: number
	total_messages: number
	elapsed_formatted: string
	remaining_formatted: string
	previous_session_name: string
	next_session_name: string
	previous_session_presenter_name: string
	next_session_presenter_name: string
}

/**
 * Projects the pushed protocol state onto the module's variables.
 *
 * Every value is derived from state the device has actually reported, so an
 * absent field degrades to a neutral default rather than stale data.
 */
export function extractVariableValues(state: ProtocolState): VariableValues {
	const cc = state.controlCenter
	const view = state.view
	const sessions = state.sessionList
	const currentIndex = cc?.current_session_index ?? -1
	const previous = currentIndex > 0 ? sessions[currentIndex - 1] : undefined
	const next = currentIndex >= 0 ? sessions[currentIndex + 1] : undefined

	return {
		timer_run_state: cc?.timer_run_state ?? 'idle',
		elapsed_time: cc?.elapsed_time ?? 0,
		timer: cc?.timer ?? 0,
		current_session_name: cc?.current_session_name ?? '',
		current_presenter_name: cc?.current_presenter_name ?? '',
		current_session_id: cc?.current_session_id ?? '',
		current_session_mode: currentSessionMode(state) ?? '',
		is_playing: cc?.timer_run_state === 'running' ? 'Yes' : 'No',
		is_glowing: cc?.is_glowing ? 'Yes' : 'No',
		is_blackout: cc?.is_blackout ? 'Yes' : 'No',
		message_text: view?.message_text ?? '',
		current_session_number: currentIndex >= 0 ? currentIndex + 1 : 0,
		total_sessions: sessions.length,
		total_messages: state.messageList.length,
		elapsed_formatted: formatTime(view?.elapsed_time ?? cc?.elapsed_time ?? 0),
		remaining_formatted: formatTime(cc?.timer ?? 0),
		previous_session_name: previous?.name ?? '',
		next_session_name: next?.name ?? '',
		previous_session_presenter_name: previous?.presenter_name ?? '',
		next_session_presenter_name: next?.presenter_name ?? '',
	}
}

// ---- Target resolution for session/message commands ----

/**
 * Resolves the session a command should act on: an explicit id, or the device's
 * current session when the caller leaves it blank.
 *
 * Returns `null` when there is nothing to act on, so callers can skip the command
 * instead of provoking an `INVALID_COMMAND`/`INVALID_SESSION` from the device.
 */
export function resolveSessionId(state: ProtocolState, requested?: string | null): string | null {
	const explicit = (requested ?? '').trim()
	if (explicit.length > 0) return explicit

	const current = state.controlCenter?.current_session_id ?? ''
	return current.length > 0 ? current : null
}

/** 1-based position of a session in program order, or `null` when it is absent. */
export function sessionPosition(state: ProtocolState, sessionId: string): number | null {
	const index = state.sessionList.findIndex((item) => item.id === sessionId)
	return index >= 0 ? index + 1 : null
}

/**
 * Mode of the session the device reports as current, or `null` when nothing is
 * current.
 *
 * Prefers the summary's own `is_current` marker — the field vc146 designates for
 * this — and falls back to the control center's index only if no summary claims it.
 */
export function currentSessionMode(state: ProtocolState): string | null {
	const marked = state.sessionList.find((item) => item.is_current)
	if (marked) return marked.mode

	const index = state.controlCenter?.current_session_index ?? -1
	return index >= 0 ? (state.sessionList[index]?.mode ?? null) : null
}

/**
 * Whether the current session is a Time of Day wall clock.
 *
 * This matters because a wall clock cannot be paused and has no length, so vc146
 * refuses `pause_session`, `add_time`, `subtract_time` and `reset_current_session`
 * against one. Actions use this to skip locally instead of provoking a rejection the
 * operator never sees.
 */
export function isCurrentSessionTimeOfDay(state: ProtocolState): boolean {
	return currentSessionMode(state) === 'time_of_day'
}

/**
 * Maps a 1-based position in the program's message list to a message id.
 *
 * vc146 message summaries carry no position field — the list order *is* the
 * position. That makes a position the only address an operator can reason about
 * without copying opaque ids out of the device, which is why the message actions
 * are position-based rather than id-based.
 */
export function resolveMessageIdByPosition(state: ProtocolState, position: number): string | null {
	if (!Number.isInteger(position) || position < 1 || position > state.messageList.length) return null
	return state.messageList[position - 1]?.id ?? null
}

// ---- Boolean feedback logic ----
//
// `timer_run_state` (`idle` / `running` / `paused`) replaces the retired
// `is_playing` field, which could not distinguish a paused timer from an idle one.

export function checkIsPlaying(state: ProtocolState): boolean {
	return state.controlCenter?.timer_run_state === 'running'
}

export function checkIsPaused(state: ProtocolState): boolean {
	return state.controlCenter?.timer_run_state === 'paused'
}

export function checkIsIdle(state: ProtocolState): boolean {
	return (state.controlCenter?.timer_run_state ?? 'idle') === 'idle'
}

export function checkIsGlowing(state: ProtocolState): boolean {
	return state.controlCenter?.is_glowing === true
}

export function checkIsBlackout(state: ProtocolState): boolean {
	return state.controlCenter?.is_blackout === true
}

export function checkIsFlashing(state: ProtocolState): boolean {
	// The view and messages sections report the *same* message flash — §4.8 is explicit
	// that it is never the session's own flashing, which is `is_time_up_flashing`. So
	// OR-ing the two reports cannot false-positive, and it means a flash announced only
	// on `messages_status_event` is not missed.
	return state.view?.is_flashing === true || state.messagesFlashing === true
}

/** Navigation availability comes from the device, not from list arithmetic. */
export function checkHasPreviousSession(state: ProtocolState): boolean {
	return state.controlCenter?.is_previous_session === true
}

export function checkHasNextSession(state: ProtocolState): boolean {
	return state.controlCenter?.is_next_session === true
}

export function checkMessageShowing(state: ProtocolState): boolean {
	const text = state.view?.message_text
	return !!text && text.trim().length > 0
}

export function checkIsTimeUpDisplay(state: ProtocolState): boolean {
	return state.settings?.is_time_up_display === true
}

/**
 * The time-is-up flash is reported on the control center and (while it is on
 * screen) the view. It is not a settings field — unlike the retired
 * `settings.is_time_up_flashing`, which the vc146 schema does not define.
 */
export function checkIsTimeUpFlashing(state: ProtocolState): boolean {
	return state.controlCenter?.is_time_up_flashing === true || state.view?.is_time_up_flashing === true
}
