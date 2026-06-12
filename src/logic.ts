import type { Config } from './main.js'

// ---- Types shared between main and tests ----

export interface ControlCenterStatus {
	elapsed_time: number
	timer: number
	current_session_name: string
	current_presenter_name: string
	is_playing: boolean
	is_glowing: boolean
	is_blackout: boolean
	is_previous_session: boolean
	is_next_session: boolean
	flash_start_time: number
	program_elapsed_time: number
	program_time: number
	current_session_id: string
	current_session_index: number
}

export interface ViewStatus {
	message_text: string
	presenter_name: string
	elapsed_time: number
	program_elapsed_time: number
	session_name: string
	progress_bar: number
	session_id: string | null
	message_id: string | null
	is_flashing: boolean
	is_glowing: boolean
}

export interface SettingsStatus {
	brightness: number
	default_flash_start_time: number
	default_flash_length: number
	view_only_code: string
	is_time_up_display: boolean
}

export interface SessionInfo {
	id: string
	index: number
	start_time: number | null
	duration: number
	session_name: string
	presenter_name?: string
	is_playing: boolean
}

export interface SessionsStatus {
	session_list: SessionInfo[]
}

export interface ApiResponse {
	success?: boolean
	message?: string
	control_center?: ControlCenterStatus
	view?: ViewStatus
	settings?: SettingsStatus
	sessions?: SessionsStatus
}

export interface VariableValues {
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
}

// ---- Time formatting ----

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

// ---- Host/port resolution ----

export function getEffectiveHost(config: Pick<Config, 'host' | 'cuetime-display'>): string {
	if (config['cuetime-display']) {
		return config['cuetime-display']
	}
	return config.host || ''
}

export function getEffectivePort(config: Pick<Config, 'port'>): string {
	return config.port || '8080'
}

// ---- Boolean feedback logic ----

export function checkIsPlaying(status: ApiResponse | null): boolean {
	return !!status?.control_center?.is_playing
}

export function checkIsGlowing(status: ApiResponse | null): boolean {
	return !!status?.control_center?.is_glowing
}

export function checkIsBlackout(status: ApiResponse | null): boolean {
	return !!status?.control_center?.is_blackout
}

export function checkIsFlashing(status: ApiResponse | null): boolean {
	return !!status?.view?.is_flashing
}

export function checkHasPreviousSession(status: ApiResponse | null): boolean {
	return !!status?.control_center?.is_previous_session
}

export function checkHasNextSession(status: ApiResponse | null): boolean {
	return !!status?.control_center?.is_next_session
}

export function checkMessageShowing(status: ApiResponse | null): boolean {
	const text = status?.view?.message_text
	return !!text && text.length > 0
}

export function checkIsTimeUpDisplay(status: ApiResponse | null): boolean {
	return !!status?.settings?.is_time_up_display
}

// ---- Variable extraction ----

export function extractVariableValues(status: ApiResponse): VariableValues | null {
	if (!status.success || !status.control_center) {
		return null
	}

	const cc = status.control_center
	const view = status.view
	const sessions = status.sessions

	const current_session_number = cc.current_session_index !== undefined ? cc.current_session_index + 1 : 0
	const total_sessions = sessions?.session_list?.length || 0

	return {
		elapsed_time: cc.elapsed_time || 0,
		timer: cc.timer || 0,
		current_session_name: cc.current_session_name || '',
		current_presenter_name: cc.current_presenter_name || '',
		is_playing: cc.is_playing ? 'Yes' : 'No',
		is_glowing: cc.is_glowing ? 'Yes' : 'No',
		is_blackout: cc.is_blackout ? 'Yes' : 'No',
		message_text: view?.message_text || '',
		current_session_number,
		total_sessions,
	}
}
