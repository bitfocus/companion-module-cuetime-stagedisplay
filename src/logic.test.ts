import { describe, it, expect } from 'vitest'
import {
	getEffectiveHost,
	getEffectivePort,
	checkIsPlaying,
	checkIsGlowing,
	checkIsBlackout,
	checkIsFlashing,
	checkHasPreviousSession,
	checkHasNextSession,
	checkMessageShowing,
	checkIsTimeUpDisplay,
	extractVariableValues,
} from './logic.js'
import type { ApiResponse } from './logic.js'

// ---- Host/port resolution ----

describe('getEffectiveHost', () => {
	it('returns bonjour-discovered host when available', () => {
		const result = getEffectiveHost({ host: '10.0.0.1', 'cuetime-display': '10.0.0.2' })
		expect(result).toBe('10.0.0.2')
	})

	it('falls back to manual host when bonjour is null', () => {
		const result = getEffectiveHost({ host: '10.0.0.1', 'cuetime-display': null })
		expect(result).toBe('10.0.0.1')
	})

	it('returns empty string when neither is set', () => {
		const result = getEffectiveHost({ host: '', 'cuetime-display': null })
		expect(result).toBe('')
	})
})

describe('getEffectivePort', () => {
	it('returns the configured port', () => {
		const result = getEffectivePort({ port: '9090' })
		expect(result).toBe('9090')
	})

	it('defaults to 8080 when port is empty', () => {
		const result = getEffectivePort({ port: '' })
		expect(result).toBe('8080')
	})

	it('defaults to 8080 when port is undefined', () => {
		const result = getEffectivePort({} as any)
		expect(result).toBe('8080')
	})
})

// ---- Status helper ----

function makeStatus(overrides?: Partial<ApiResponse>): ApiResponse {
	return {
		success: true,
		control_center: {
			elapsed_time: 0,
			timer: 0,
			current_session_name: '',
			current_presenter_name: '',
			is_playing: false,
			is_glowing: false,
			is_blackout: false,
			is_previous_session: false,
			is_next_session: false,
			flash_start_time: 0,
			program_elapsed_time: 0,
			program_time: 0,
			current_session_id: '',
			current_session_index: 0,
		},
		view: {
			message_text: '',
			presenter_name: '',
			elapsed_time: 0,
			program_elapsed_time: 0,
			session_name: '',
			progress_bar: 0,
			session_id: null,
			message_id: null,
			is_flashing: false,
			is_glowing: false,
		},
		settings: {
			brightness: 80,
			default_flash_start_time: 120,
			default_flash_length: 30,
			view_only_code: '',
			is_time_up_display: true,
		},
		...overrides,
	}
}

// ---- Boolean feedbacks ----

describe('checkIsPlaying', () => {
	it('returns true when is_playing is true', () => {
		const status = makeStatus({ control_center: { is_playing: true } as any })
		expect(checkIsPlaying(status)).toBe(true)
	})

	it('returns false when is_playing is false', () => {
		const status = makeStatus({ control_center: { is_playing: false } as any })
		expect(checkIsPlaying(status)).toBe(false)
	})

	it('returns false when status is null', () => {
		expect(checkIsPlaying(null)).toBe(false)
	})
})

describe('checkIsGlowing', () => {
	it('returns true when is_glowing is true', () => {
		const status = makeStatus({ control_center: { is_glowing: true } as any })
		expect(checkIsGlowing(status)).toBe(true)
	})

	it('returns false when is_glowing is false', () => {
		expect(checkIsGlowing(makeStatus())).toBe(false)
	})

	it('returns false when status is null', () => {
		expect(checkIsGlowing(null)).toBe(false)
	})
})

describe('checkIsBlackout', () => {
	it('returns true when is_blackout is true', () => {
		const status = makeStatus({ control_center: { is_blackout: true } as any })
		expect(checkIsBlackout(status)).toBe(true)
	})

	it('returns false when is_blackout is false', () => {
		expect(checkIsBlackout(makeStatus())).toBe(false)
	})
})

describe('checkIsFlashing', () => {
	it('returns true when is_flashing is true', () => {
		const status = makeStatus({ view: { is_flashing: true } as any })
		expect(checkIsFlashing(status)).toBe(true)
	})

	it('returns false when is_flashing is false', () => {
		expect(checkIsFlashing(makeStatus())).toBe(false)
	})
})

describe('checkHasPreviousSession', () => {
	it('returns true when is_previous_session is true', () => {
		const status = makeStatus({ control_center: { is_previous_session: true } as any })
		expect(checkHasPreviousSession(status)).toBe(true)
	})

	it('returns false when is_previous_session is false', () => {
		expect(checkHasPreviousSession(makeStatus())).toBe(false)
	})
})

describe('checkHasNextSession', () => {
	it('returns true when is_next_session is true', () => {
		const status = makeStatus({ control_center: { is_next_session: true } as any })
		expect(checkHasNextSession(status)).toBe(true)
	})

	it('returns false when is_next_session is false', () => {
		expect(checkHasNextSession(makeStatus())).toBe(false)
	})
})

describe('checkMessageShowing', () => {
	it('returns true when message_text is non-empty', () => {
		const status = makeStatus({ view: { message_text: 'Break Time' } as any })
		expect(checkMessageShowing(status)).toBe(true)
	})

	it('returns false when message_text is empty', () => {
		expect(checkMessageShowing(makeStatus())).toBe(false)
	})

	it('returns false when message_text is undefined', () => {
		const status = makeStatus({ view: {} as any })
		expect(checkMessageShowing(status)).toBe(false)
	})
})

describe('checkIsTimeUpDisplay', () => {
	it('returns true when is_time_up_display is true', () => {
		const status = makeStatus({ settings: { is_time_up_display: true } as any })
		expect(checkIsTimeUpDisplay(status)).toBe(true)
	})

	it('returns false when is_time_up_display is false', () => {
		const status = makeStatus({ settings: { is_time_up_display: false } as any })
		expect(checkIsTimeUpDisplay(status)).toBe(false)
	})

	it('returns false when settings is missing', () => {
		const status = makeStatus()
		delete (status as any).settings
		expect(checkIsTimeUpDisplay(status)).toBe(false)
	})
})

// ---- Variable extraction ----

describe('extractVariableValues', () => {
	it('extracts values from a valid status response', () => {
		const status = makeStatus({
			control_center: {
				elapsed_time: 5000,
				timer: 120000,
				current_session_name: 'Keynote',
				current_presenter_name: 'Alice',
				is_playing: true,
				is_glowing: false,
				is_blackout: false,
			} as any,
			view: {
				message_text: 'Hello',
			} as any,
		})

		const result = extractVariableValues(status)
		expect(result).toEqual({
			elapsed_time: 5000,
			timer: 120000,
			current_session_name: 'Keynote',
			current_presenter_name: 'Alice',
			is_playing: 'Yes',
			is_glowing: 'No',
			is_blackout: 'No',
			message_text: 'Hello',
			current_session_number: 0,
			total_sessions: 0,
		})
	})

	it('returns null when success is false', () => {
		const status = makeStatus({ success: false })
		expect(extractVariableValues(status)).toBeNull()
	})

	it('returns null when control_center is missing', () => {
		const status = makeStatus()
		delete (status as any).control_center
		expect(extractVariableValues(status)).toBeNull()
	})

	it('handles missing view gracefully', () => {
		const status = makeStatus()
		delete (status as any).view
		const result = extractVariableValues(status)
		expect(result?.message_text).toBe('')
	})
})
