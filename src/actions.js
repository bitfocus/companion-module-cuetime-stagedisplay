module.exports = function (self) {
	self.setActionDefinitions({
		navigate_next_event: {
			name: 'Navigate to Next Session',
			options: [],
			callback: async (event) => {
				self.sendCommand('navigate_next_event')
			},
		},
		navigate_previous_event: {
			name: 'Navigate to Previous Session',
			options: [],
			callback: async (event) => {
				self.sendCommand('navigate_previous_event')
			},
		},
	})
}
