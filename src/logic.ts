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

export interface ApiResponse {
	success?: boolean
	message?: string
	control_center?: ControlCenterStatus
	view?: ViewStatus
	settings?: SettingsStatus
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

	return {
		elapsed_time: cc.elapsed_time || 0,
		timer: cc.timer || 0,
		current_session_name: cc.current_session_name || '',
		current_presenter_name: cc.current_presenter_name || '',
		is_playing: cc.is_playing ? 'Yes' : 'No',
		is_glowing: cc.is_glowing ? 'Yes' : 'No',
		is_blackout: cc.is_blackout ? 'Yes' : 'No',
		message_text: view?.message_text || '',
	}
}
