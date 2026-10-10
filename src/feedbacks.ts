import { combineRgb } from '@companion-module/base'
import type { CompanionAdvancedFeedbackResult } from '@companion-module/base'
import type { ModuleInstance } from './main.ts'
import { icon_eye, icon_bar_eye } from './generated-icons.ts'
import {
	checkIsPlaying,
	checkIsPaused,
	checkIsIdle,
	checkIsGlowing,
	checkIsBlackout,
	checkIsFlashing,
	checkHasPreviousSession,
	checkHasNextSession,
	checkMessageShowing,
	checkIsTimeUpDisplay,
	checkIsTimeUpFlashing,
} from './logic.ts'

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		is_connected: {
			name: 'Device Is Connected',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 200, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => self.connected,
		},
		is_playing: {
			name: 'Timer Is Running',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => checkIsPlaying(self.state),
		},
		is_paused: {
			name: 'Timer Is Paused',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => checkIsPaused(self.state),
		},
		is_idle: {
			name: 'Timer Is Idle',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(80, 80, 80),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkIsIdle(self.state),
		},
		is_glowing: {
			name: 'Glow Effect Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => checkIsGlowing(self.state),
		},
		is_blackout: {
			name: 'Blackout Mode Active',
			type: 'advanced',
			options: [],
			callback: (): CompanionAdvancedFeedbackResult => {
				if (checkIsBlackout(self.state)) {
					return {
						bgcolor: combineRgb(255, 0, 0),
						color: combineRgb(255, 255, 255),
						png64: icon_eye,
					}
				}
				return {
					bgcolor: combineRgb(0, 0, 0),
					color: combineRgb(255, 255, 255),
					png64: icon_bar_eye,
				}
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
			callback: () => checkIsFlashing(self.state),
		},
		has_previous_session: {
			name: 'Previous Session Exists',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkHasPreviousSession(self.state),
		},
		no_previous_session: {
			name: 'No Previous Session',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => !checkHasPreviousSession(self.state),
		},
		has_next_session: {
			name: 'Next Session Exists',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkHasNextSession(self.state),
		},
		no_next_session: {
			name: 'No Next Session',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 165, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => !checkHasNextSession(self.state),
		},
		message_showing: {
			name: 'Message Is Showing',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(128, 0, 255),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkMessageShowing(self.state),
		},
		is_time_up_display: {
			name: 'Time-is-Up Display Enabled',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(200, 100, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkIsTimeUpDisplay(self.state),
		},
		is_time_up_flashing: {
			name: 'Time-is-Up Flash Active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => checkIsTimeUpFlashing(self.state),
		},
	})
}
