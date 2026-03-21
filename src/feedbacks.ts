import { combineRgb } from '@companion-module/base'
import { ModuleInstance } from './main'

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		ChannelState: {
			name: 'Example Feedback',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff0000,
				color: 0x000000,
			},
			options: [
				{
					id: 'num',
					type: 'number',
					label: 'Test',
					default: 5,
					min: 0,
					max: 10,
				},
			],
			callback: (feedback: any) => {
				console.log('Hello world!', feedback.options.num)
				if (feedback.options.num > 5) {
					return true
				} else {
					return false
				}
			},
		},
	})
}
