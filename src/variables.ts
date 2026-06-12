import type { ModuleInstance } from './main.js'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
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
	})
}
