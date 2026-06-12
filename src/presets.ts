import type { ModuleInstance } from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import {
	icon_next,
	icon_previous,
	icon_play_pause,
	icon_add_minute,
	icon_subtrack_miniute,
	icon_msg_1,
	icon_msg_2,
	icon_frame,
} from './generated-icons.js'

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {
		navigate_next: {
			type: 'simple',
			name: 'Navigate to Next Session',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_next,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'navigate_next_session', options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		},
		navigate_previous: {
			type: 'simple',
			name: 'Navigate to Previous Session',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_previous,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'navigate_previous_session', options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		},
		toggle_playback: {
			type: 'simple',
			name: 'Toggle Playback',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_play_pause,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'toggle_playback', options: {} }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'is_playing',
					options: {},
					style: { bgcolor: 0x00ff00, color: 0x000000 },
				},
			],
		},
		pause: {
			type: 'simple',
			name: 'Pause Timer',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_play_pause,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'pause_timer', options: {} }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'is_playing',
					options: {},
					style: { bgcolor: 0x00ff00, color: 0x000000 },
				},
			],
		},
		add_time: {
			type: 'simple',
			name: 'Add Time',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_add_minute,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'add_time', options: { seconds: 60 } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		subtract_time: {
			type: 'simple',
			name: 'Subtract Time',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_subtrack_miniute,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'subtract_time', options: { seconds: 30 } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		show_message_1: {
			type: 'simple',
			name: 'Show Message (Break Time)',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_msg_1,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'show_message', options: { text: 'Break Time', flash: 'disable' } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		show_message_2: {
			type: 'simple',
			name: 'Show Message (Lunch)',
			style: {
				text: '',
				size: 'auto',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_msg_2,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'show_message', options: { text: 'Lunch', flash: 'disable' } }],
					up: [],
				},
			],
			feedbacks: [],
		},
		session_counter: {
			type: 'simple',
			name: 'Session Counter',
			style: {
				text: '$(cuetime:current_session_number)/$(cuetime:total_sessions)\n$(cuetime:current_session_name)',
				size: '14',
				color: 0xffffff,
				bgcolor: 0x000000,
				png64: icon_frame,
				show_topbar: false,
			},
			steps: [
				{
					down: [],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'is_playing',
					options: {},
					style: { bgcolor: 0x00ff00, color: 0x000000 },
				},
			],
		},
	}

	const structure: CompanionPresetSection[] = Object.keys(presets).map((id) => ({
		id,
		name: presets[id]?.name || '',
		definitions: [
			{
				id: 'default',
				name: presets[id]?.name || '',
				description: '',
				type: 'simple',
				presets: [id],
			},
		],
	}))

	self.setPresetDefinitions(structure, presets as any)
}
