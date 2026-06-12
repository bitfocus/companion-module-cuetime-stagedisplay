import { combineRgb } from '@companion-module/base'
import { ModuleInstance } from './main.js'
import {
	checkIsPlaying,
	checkIsGlowing,
	checkIsBlackout,
	checkIsFlashing,
	checkHasPreviousSession,
	checkHasNextSession,
	checkMessageShowing,
	checkIsTimeUpDisplay,
} from './logic.js'

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		is_playing: {
			name: 'Timer is Running',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkIsPlaying(self.latestStatus)
			},
		},
		is_glowing: {
			name: 'Glow Effect Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkIsGlowing(self.latestStatus)
			},
		},
		is_blackout: {
			name: 'Blackout Mode Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkIsBlackout(self.latestStatus)
			},
		},
		is_flashing: {
			name: 'Flash Effect Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkIsFlashing(self.latestStatus)
			},
		},
		has_previous_session: {
			name: 'Previous Session Exists',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkHasPreviousSession(self.latestStatus)
			},
		},
		has_next_session: {
			name: 'Next Session Exists',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkHasNextSession(self.latestStatus)
			},
		},
		message_showing: {
			name: 'Message Is Showing',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(128, 0, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkMessageShowing(self.latestStatus)
			},
		},
		is_connected: {
			name: 'Device Is Connected',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 200, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: (_feedback: any) => {
				return self.connected
			},
		},
		is_time_up_display: {
			name: 'Time-is-Up Display Enabled',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(200, 100, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: (_feedback: any) => {
				return checkIsTimeUpDisplay(self.latestStatus)
			},
		},
	})
}
