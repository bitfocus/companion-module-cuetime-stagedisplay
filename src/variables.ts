import { ModuleInstance } from './main'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions([
		{ variableId: 'elapsed_time', name: 'Elapsed Time (ms)' },
		{ variableId: 'timer', name: 'Timer (ms)' },
		{ variableId: 'current_session_name', name: 'Current Session Name' },
		{ variableId: 'current_presenter_name', name: 'Current Presenter Name' },
		{ variableId: 'is_playing', name: 'Is Playing' },
		{ variableId: 'is_glowing', name: 'Is Glowing' },
		{ variableId: 'is_blackout', name: 'Is Blackout' },
		{ variableId: 'message_text', name: 'Message Text' },
	])
}
