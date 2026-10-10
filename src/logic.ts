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
	is_playing: string
	is_glowing: string
	is_blackout: string
	message_text: string
	current_session_number: number
	total_sessions: number
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
		is_playing: cc?.timer_run_state === 'running' ? 'Yes' : 'No',
		is_glowing: cc?.is_glowing ? 'Yes' : 'No',
		is_blackout: cc?.is_blackout ? 'Yes' : 'No',
		message_text: view?.message_text ?? '',
		current_session_number: currentIndex >= 0 ? currentIndex + 1 : 0,
		total_sessions: sessions.length,
		elapsed_formatted: formatTime(view?.elapsed_time ?? cc?.elapsed_time ?? 0),
		remaining_formatted: formatTime(cc?.timer ?? 0),
		previous_session_name: previous?.name ?? '',
		next_session_name: next?.name ?? '',
		previous_session_presenter_name: previous?.presenter_name ?? '',
		next_session_presenter_name: next?.presenter_name ?? '',
	}
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
	return state.view?.is_flashing === true
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
