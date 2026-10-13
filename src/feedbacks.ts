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
	progressPercent,
} from './logic.ts'
import { renderBarImage, renderBarText } from './progress.ts'

/** Bar geometry, as a fraction of the control's height. */
const THICKNESS_MIN_PERCENT = 4
const THICKNESS_MAX_PERCENT = 100

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
		progress_bar: {
			name: 'Session Progress Bar',
			description:
				'Remaining proportion of a countdown session, drawn as a strip. The device only reports a progress percentage for a countdown, so a count-up or Time of Day session shows an empty bar for its whole life.',
			type: 'advanced',
			options: [
				{
					type: 'colorpicker',
					id: 'bar_color',
					label: 'Bar colour',
					default: combineRgb(0, 255, 0),
				},
				{
					type: 'colorpicker',
					id: 'track_color',
					label: 'Remaining track colour',
					default: combineRgb(45, 45, 45),
				},
				{
					type: 'number',
					id: 'thickness',
					label: 'Thickness (% of button height)',
					default: 12,
					min: THICKNESS_MIN_PERCENT,
					max: THICKNESS_MAX_PERCENT,
				},
				{
					type: 'dropdown',
					id: 'edge',
					label: 'Edge',
					default: 'bottom',
					choices: [
						{ id: 'bottom', label: 'Bottom' },
						{ id: 'top', label: 'Top' },
					],
				},
				{
					type: 'checkbox',
					id: 'show_percentage',
					label: 'Show the percentage as button text',
					default: false,
				},
			],
			callback: (feedback): CompanionAdvancedFeedbackResult => {
				const percent = progressPercent(self.state)
				const showPercent = feedback.options.show_percentage === true
				const barColor = Number(feedback.options.bar_color ?? 0)
				const trackColor = Number(feedback.options.track_color ?? 0)

				const image = feedback.image
				if (image && image.width > 0 && image.height > 0) {
					// Draw only a strip rather than the whole button: a raw pixel buffer is
					// ~4 bytes per pixel before base64, and this is refreshed on every event.
					const thickness = Math.min(
						THICKNESS_MAX_PERCENT,
						Math.max(THICKNESS_MIN_PERCENT, Number(feedback.options.thickness ?? 12)),
					)
					const barHeight = Math.max(1, Math.round((image.height * thickness) / 100))
					const atTop = feedback.options.edge === 'top'

					return {
						bgcolor: trackColor,
						imageBuffer: renderBarImage({
							width: image.width,
							height: barHeight,
							percent,
							barColor,
							trackColor,
						}),
						// Companion is told the format explicitly, since a bare buffer is ambiguous.
						imageBufferEncoding: { pixelFormat: 'RGBA' },
						imageBufferPosition: {
							x: 0,
							y: atTop ? 0 : image.height - barHeight,
							width: image.width,
							height: barHeight,
						},
						...textStyle(showPercent, percent),
					}
				}

				// No image buffer available on this control, so fall back to a text bar — which
				// has to be the button text, because that is all an advanced feedback owns.
				return {
					text: `${renderBarText(percent)}${showPercent ? ` ${Math.round(percent)}%` : ''}`,
					textExpression: false,
					bgcolor: trackColor,
				}
			},
		},
	})
}

/** Only overrides the button text when the operator asked for the percentage. */
function textStyle(show: boolean, percent: number): { text?: string; textExpression?: boolean } {
	if (!show) return {}
	// `textExpression: false` keeps a literal `%` from being read as an expression.
	return { text: `${Math.round(percent)}%`, textExpression: false }
}
