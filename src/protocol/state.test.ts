import { describe, it, expect } from 'vitest'
import { createInitialState, applyEvent, applyResponse } from './state.ts'
import type { Event } from './generated.ts'
import {
	controlCenter,
	controlCenterEvent,
	helloEvent,
	messages,
	messagesEvent,
	sessionsEvent,
	settings,
	settingsEvent,
	statusResponse,
	view,
	viewEvent,
} from './fixtures.ts'

describe('ProtocolState', () => {
	it('starts empty and unhydrated', () => {
		const state = createInitialState()

		expect(state.hello).toBeNull()
		expect(state.controlCenter).toBeNull()
		expect(state.view).toBeNull()
		expect(state.settings).toBeNull()
		expect(state.sessionList).toEqual([])
		expect(state.messageList).toEqual([])
		expect(state.messagesFlashing).toBe(false)
		expect(state.program).toBeNull()
		expect(state.hydrationComplete).toBe(false)
	})

	it('applies hello_event without disturbing anything else', () => {
		const hello = helloEvent({ version_name: '1.2.3' })
		const next = applyEvent(createInitialState(), hello)

		expect(next.hello).toEqual(hello)
		expect(next.controlCenter).toBeNull()
		expect(next.sessionList).toEqual([])
	})

	it('applies control_center_status_event', () => {
		const event = controlCenterEvent({ timer_run_state: 'running', elapsed_time: 2500 })
		const next = applyEvent(createInitialState(), event)

		expect(next.controlCenter?.timer_run_state).toBe('running')
		expect(next.controlCenter?.elapsed_time).toBe(2500)
		expect(next.hello).toBeNull()
	})

	it('applies view, settings and session events', () => {
		const next = [
			viewEvent({ message_text: 'hi', is_flashing: true }),
			settingsEvent({ brightness: 40 }),
			sessionsEvent([{ id: 'a' }, { id: 'b', is_current: true }]),
		].reduce((state, event) => applyEvent(state, event), createInitialState())

		expect(next.view?.message_text).toBe('hi')
		expect(next.settings?.brightness).toBe(40)
		expect(next.sessionList).toHaveLength(2)
		expect(next.sessionList[1]?.is_current).toBe(true)
	})

	it('tracks the message flash flag alongside the message list', () => {
		const event = messagesEvent({ message_list: [{ id: 'm1', text: 'Break', is_showing: true }], is_flashing: true })
		const next = applyEvent(createInitialState(), event)

		expect(next.messageList).toHaveLength(1)
		expect(next.messageList[0]?.text).toBe('Break')
		expect(next.messagesFlashing).toBe(true)
	})

	it('hydrates several sections from one status_response', () => {
		const next = applyResponse(
			createInitialState(),
			statusResponse({
				control_center: controlCenter({ timer_run_state: 'paused' }),
				view: view({ message_text: 'from hydration' }),
				settings: settings({ brightness: 55, is_time_up_display: true }),
				session_list: [{ id: '1' }],
				messages: messages({ is_flashing: false }),
			}),
		)

		expect(next.controlCenter?.timer_run_state).toBe('paused')
		expect(next.settings?.brightness).toBe(55)
		expect(next.sessionList).toHaveLength(1)
		expect(next.messagesFlashing).toBe(false)
		expect(next.hydrationComplete).toBe(true)
	})

	it('leaves sections the status_response omitted untouched', () => {
		const withView = applyEvent(createInitialState(), viewEvent({ message_text: 'kept' }))
		const next = applyResponse(withView, statusResponse({ control_center: controlCenter() }))

		expect(next.view?.message_text).toBe('kept')
		expect(next.controlCenter).not.toBeNull()
	})

	it('ignores unknown event types', () => {
		const state = createInitialState()
		const next = applyEvent(state, { type: 'unknown_event' } as unknown as Event)

		expect(next).toBe(state)
	})
})
