import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import type { ModuleInstance } from './main.ts'
import { UpdateActions } from './actions.ts'
import type { CommandType } from './protocol/generated.ts'

/**
 * Regression tests for the action-dispatch contract.
 *
 * Companion runs an action callback under its own timeout. Our callbacks used to
 * `await` the device's reply, which takes up to the 5 s request timeout — or never
 * arrives if the device is unwell — and Companion logged the action as failed with
 * `Error executing action: Error: Call timed out` even though the command had been
 * delivered. These tests pin the callback to returning promptly and reporting the
 * outcome asynchronously instead.
 */
describe('action callbacks do not block on the device reply', () => {
	type ActionDef = { callback: (event: { options: Record<string, unknown> }) => unknown }

	let defs: Record<string, ActionDef>
	let sent: CommandType[]
	let logs: { level: string; message: string }[]
	/** Resolvers for commands we deliberately never answer, to prove nothing waits. */
	let unresolved: (() => void)[] = []

	function buildSelf(): ModuleInstance {
		return {
			state: {
				hello: null,
				controlCenter: {
					current_session_index: 0,
					current_session_id: 's1',
					timer_run_state: 'running',
					is_next_session: true,
					is_previous_session: true,
					is_blackout: false,
					is_glowing: false,
					is_time_up_flashing: false,
				},
				view: null,
				settings: null,
				sessionList: [{ id: 's1', mode: 'countdown', name: 'One', is_current: true }],
				messageList: [],
				messagesFlashing: false,
				program: null,
				hydrationComplete: false,
			},
			connected: true,
			log: (level: string, message: string) => logs.push({ level, message }),
			setActionDefinitions: (definitions: unknown) => {
				defs = definitions as Record<string, ActionDef>
			},
			// Never settles: a device that has gone away.
			sendCommand: async (type: CommandType) => {
				sent.push(type)
				return new Promise<void>((resolve) => unresolved.push(() => resolve()))
			},
			sendCommandDetailed: async (type: CommandType) =>
				new Promise((resolve) => {
					sent.push(type)
					unresolved.push(() => resolve({ ok: false, type: 'error_response', code: 'TIMEOUT', message: 'no reply' }))
				}),
		} as unknown as ModuleInstance
	}

	beforeEach(() => {
		defs = {}
		sent = []
		logs = []
		unresolved = []
		UpdateActions(buildSelf())
	})

	afterEach(() => {
		// Let the detached continuations finish so nothing leaks between tests.
		for (const resolve of unresolved) resolve()
	})

	/** Every action that takes no options, so all can be driven the same way. */
	const zeroOptionActions = [
		'navigate_next_session',
		'navigate_previous_session',
		'toggle_playback',
		'start_session',
		'pause_session',
		'reset_current_session',
		'reset_program_elapsed_timer',
		'toggle_glow',
		'toggle_flash',
		'hide_message',
		'show_idle',
		'toggle_is_time_up_display',
	]

	it('returns immediately even though no reply ever arrives', async () => {
		for (const name of zeroOptionActions) {
			const callback = defs[name]?.callback
			expect(callback, `${name} should exist`).toBeTypeOf('function')

			// If the callback awaited the reply this would never resolve, and Companion
			// would time the action out.
			const outcome = await Promise.race([
				Promise.resolve(callback({ options: {} })).then(() => 'returned'),
				new Promise((resolve) => setTimeout(() => resolve('hung'), 250)),
			])
			expect(outcome, `${name} must not wait for the reply`).toBe('returned')
		}
	})

	it('still dispatches each command', () => {
		for (const name of zeroOptionActions) defs[name].callback({ options: {} })
		expect(sent.length).toBeGreaterThanOrEqual(zeroOptionActions.length)
	})

	it('honours state guards before dispatching, rather than sending blindly', () => {
		// navigate_* are gated on the device's own flags; with them false nothing is sent.
		const guarded = buildSelf()
		Object.assign(guarded.state.controlCenter as object, {
			is_next_session: false,
			is_previous_session: false,
		})
		const localDefs: Record<string, ActionDef> = {}
		const localSent: CommandType[] = []
		const self = {
			...guarded,
			setActionDefinitions: (d: unknown) => Object.assign(localDefs, d),
			sendCommand: async (type: CommandType) => {
				localSent.push(type)
				return Promise.resolve()
			},
		} as unknown as ModuleInstance

		UpdateActions(self)
		localDefs['navigate_next_session'].callback({ options: {} })
		localDefs['navigate_previous_session'].callback({ options: {} })
		expect(localSent).toEqual([])
	})
})

/**
 * Option metadata that only Companion's UI consumes: without `useVariables` a typed
 * `$(…)` is sent literally, and without `disableAutoExpression` an on/off dropdown can
 * be switched to an expression whose value is not one of the choice ids (the action is
 * then silently skipped). Neither is observable from the protocol, so pin them here.
 */
describe('action option metadata', () => {
	type OptionDef = { id: string; useVariables?: boolean; disableAutoExpression?: boolean }
	let defs: Record<string, { options: OptionDef[] }>

	beforeAll(() => {
		let captured: Record<string, { options: OptionDef[] }> = {}
		const self = {
			state: {},
			setActionDefinitions: (value: Record<string, { options: OptionDef[] }>) => {
				captured = value
			},
		} as unknown as ModuleInstance
		UpdateActions(self)
		defs = captured
	})

	const field = (action: string, id: string): OptionDef => {
		const found = defs[action]?.options.find((option) => option.id === id)
		if (!found) throw new Error(`${action}.${id} is not defined`)
		return found
	}

	it('lets operators type variables into the text that goes on the glass', () => {
		const textFields: [string, string][] = [
			['show_message', 'text'],
			['add_message', 'content'],
			['update_message', 'content'],
			['add_session', 'name'],
			['add_session', 'presenter_name'],
			['add_session', 'notes'],
			['update_session', 'name'],
			['update_session', 'presenter_name'],
			['update_session', 'notes'],
		]
		for (const [action, id] of textFields) {
			expect(field(action, id).useVariables, `${action}.${id} must accept variables`).toBe(true)
		}
	})

	it('keeps the on/off dropdowns out of expression mode', () => {
		const toggles: [string, string][] = [
			['blackout', 'action'],
			['set_glow', 'enabled'],
			['set_flash', 'action'],
			['set_is_time_up_display', 'enabled'],
		]
		for (const [action, id] of toggles) {
			expect(field(action, id).disableAutoExpression, `${action}.${id} must stay a plain choice`).toBe(true)
		}
	})
})

/**
 * Toggle Playback has to work from every run state. From idle a bare
 * `start_session` is rejected by the device ("No active session to start"), so the
 * preset did nothing on a freshly loaded program while "Start / Resume Session" —
 * which names the first session — worked. That inconsistency is what these pin.
 */
describe('toggle playback across run states', () => {
	function harness(controlCenter: Record<string, unknown>, sessionList: Record<string, unknown>[]) {
		const sent: { type: string; payload?: unknown }[] = []
		const logs: { level: string; message: string }[] = []
		let defs: Record<string, { callback: (event: { options: Record<string, unknown> }) => unknown }> = {}

		const self = {
			state: {
				hello: null,
				controlCenter,
				view: null,
				settings: null,
				sessionList,
				messageList: [],
				messagesFlashing: false,
				program: null,
				hydrationComplete: true,
			},
			connected: true,
			log: (level: string, message: string) => logs.push({ level, message }),
			setActionDefinitions: (value: unknown) => {
				defs = value as typeof defs
			},
			sendCommand: async (type: string, payload?: unknown) => {
				sent.push({ type, payload })
			},
			sendCommandDetailed: async (type: string, payload?: unknown) => {
				sent.push({ type, payload })
				return { ok: true, response: { type: 'ack_response' } }
			},
		} as unknown as ModuleInstance

		UpdateActions(self)
		return {
			press: () => defs.toggle_playback.callback({ options: {} }),
			sent,
			logs,
		}
	}

	const sessions = [
		{ id: 's1', index: 0, name: 'Opening', mode: 'countdown' },
		{ id: 's2', index: 1, name: 'Keynote', mode: 'countup' },
	]

	it('starts the first session from idle, instead of sending a command the device rejects', async () => {
		const h = harness({ timer_run_state: 'idle', current_session_index: -1 }, sessions)
		await h.press()
		expect(h.sent).toEqual([{ type: 'start_session', payload: { session_id: 's1' } }])
	})

	it('resumes a paused session without renaming it', async () => {
		const h = harness({ timer_run_state: 'paused', current_session_index: 1, current_session_id: 's2' }, sessions)
		await h.press()
		expect(h.sent).toEqual([{ type: 'start_session', payload: {} }])
	})

	it('pauses a running session', async () => {
		const h = harness({ timer_run_state: 'running', current_session_index: 0, current_session_id: 's1' }, sessions)
		await h.press()
		expect(h.sent).toEqual([{ type: 'pause_session', payload: undefined }])
	})

	it('sends nothing from idle when the program holds no session', async () => {
		const h = harness({ timer_run_state: 'idle', current_session_index: -1 }, [])
		await h.press()
		expect(h.sent).toEqual([])
		expect(h.logs.some((entry) => entry.level === 'debug')).toBe(true)
	})
})
