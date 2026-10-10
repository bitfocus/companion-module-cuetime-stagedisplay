import type { ModuleInstance } from './main.ts'
import type { CompanionVariableDefinitions } from '@companion-module/base'

/**
 * Variable definitions mirror `VariableValues` in `logic.ts` — keep the two in
 * step, since only the definitions are visible to Companion's expression editor.
 */
export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions = {
		timer_run_state: { name: 'Timer Run State (idle/running/paused)' },
		elapsed_time: { name: 'Elapsed Time (ms)' },
		timer: { name: 'Timer (ms)' },
		current_session_name: { name: 'Current Session Name' },
		current_presenter_name: { name: 'Current Presenter Name' },
		is_playing: { name: 'Is Playing' },
		is_glowing: { name: 'Is Glowing' },
		is_blackout: { name: 'Is Blackout' },
		message_text: { name: 'Message Text' },
		current_session_number: { name: 'Current Session Number' },
		total_sessions: { name: 'Total Sessions' },
		elapsed_formatted: { name: 'Elapsed Time' },
		remaining_formatted: { name: 'Remaining Time' },
		previous_session_name: { name: 'Previous Session Name' },
		next_session_name: { name: 'Next Session Name' },
		previous_session_presenter_name: { name: 'Previous Session Presenter Name' },
		next_session_presenter_name: { name: 'Next Session Presenter Name' },
	}

	self.setVariableDefinitions(definitions)
}
