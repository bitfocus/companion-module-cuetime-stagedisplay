import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ModuleInstance } from './main.ts'
import { UpdateActions } from './actions.ts'
import { UpdateFeedbacks } from './feedbacks.ts'
import { UpdatePresets } from './presets.ts'
import { applyEvent, createInitialState } from './protocol/state.ts'
import type { ProtocolState } from './protocol/state.ts'
import type { CommandType } from './protocol/generated.ts'
import {
	controlCenterEvent,
	helloEvent,
	messagesEvent,
	sessionsEvent,
	settingsEvent,
	viewEvent,
} from './protocol/fixtures.ts'

/**
 * The shipped presets are a module deliverable, not user content: `UpdatePresets`
 * hands all 20 to Companion, and an operator drags them straight onto a button.
 * Nothing in the preset panel tells them an option id is misspelt - Companion
 * silently ignores unknown ids and falls back to the declared default - so a
 * broken preset looks like a working button that does the wrong thing.
 *
 * These tests drive the presets the way Companion does: every step's `actionId`
 * and options are resolved against the real action/feedback definitions, and each
 * preset action is then executed against a stub instance so the command it
 * produces can be validated against the vendored schema. That covers the whole
 * preset set in CI, with no Companion layout and no hardware.
 */

type OptionDef = {
	id: string
	type: string
	default?: unknown
	choices?: { id: string | number }[]
	min?: number
	max?: number
}

type StepAction = { actionId: string; options?: Record<string, unknown> }
type PresetFeedback = { feedbackId: string; options?: Record<string, unknown>; style?: Record<string, unknown> }
type PresetLike = {
	type: 'simple' | 'alternatives'
	name?: string
	style?: Record<string, unknown>
	steps?: { down?: StepAction[]; up?: StepAction[] }[]
	feedbacks?: PresetFeedback[]
}

type ActionDef = { name: string; options: OptionDef[]; callback: (event: unknown) => unknown }
type FeedbackDef = { name: string; options: OptionDef[]; callback: (event: unknown) => unknown }

const schema = JSON.parse(
	readFileSync(fileURLToPath(new URL('../schemas/protocol-schema.json', import.meta.url)), 'utf8'),
)
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(schema, 'protocol')
const validateCommand = ajv.getSchema('protocol#/$defs/Command')!

/** Style keys a preset/feedback may set; anything else is a typo Companion ignores. */
const STYLE_KEYS = new Set([
	'bgcolor',
	'color',
	'size',
	'text',
	'textExpression',
	'png64',
	'pngalignment',
	'alignment',
	'show_topbar',
])

/**
 * Presets that are pure displays: a label built from variables, no action. An
 * empty step is correct for these and wrong for everything else.
 */
const DISPLAY_ONLY = new Set(['session_counter', 'elapsed_time', 'remaining_time', 'time_info'])

type Sent = { type: CommandType; payload: unknown }

function stateWithFixtureProgram(): ProtocolState {
	return [
		helloEvent({ version_name: '1.1.2.27', version_code: 149 }),
		controlCenterEvent({
			timer_run_state: 'running',
			current_session_index: 1,
			current_session_id: 'session-2',
			current_session_name: 'Keynote',
			current_presenter_name: 'Grace',
			is_next_session: true,
			is_previous_session: true,
			elapsed_time: 61000,
			timer: 239000,
		}),
		viewEvent({ message_text: 'Break', elapsed_time: 61000 }),
		settingsEvent({ brightness: 80, is_time_up_display: true }),
		sessionsEvent([
			{ id: 'session-1', index: 0, name: 'Opening', presenter_name: 'Ada', mode: 'countdown' },
			{ id: 'session-2', index: 1, name: 'Keynote', presenter_name: 'Grace', mode: 'countup', is_current: true },
			{ id: 'session-3', index: 2, name: 'Close', presenter_name: 'Linus', mode: 'time_of_day' },
		]),
		messagesEvent({
			is_flashing: false,
			message_list: [
				{ id: 'msg-1', text: 'Break', is_showing: true },
				{ id: 'msg-2', text: 'Time is up!', is_showing: false },
			],
		}),
	].reduce<ProtocolState>((state, event) => applyEvent(state, event), createInitialState())
}

/** Everything a preset can reach, captured the way Companion receives it. */
function buildHarness(): {
	actions: Record<string, ActionDef>
	feedbacks: Record<string, FeedbackDef>
	presets: Record<string, PresetLike>
	structure: { id: string; name: string; definitions: { id: string; presets?: string[] }[] }[]
	sent: Sent[]
	logs: { level: string; message: string }[]
} {
	const state = stateWithFixtureProgram()
	let actions: Record<string, ActionDef> = {}
	let feedbacks: Record<string, FeedbackDef> = {}
	let presets: Record<string, PresetLike> = {}
	const structure: { id: string; name: string; definitions: { id: string; presets?: string[] }[] }[] = []
	const sent: Sent[] = []
	const logs: { level: string; message: string }[] = []

	const self = {
		state,
		connected: true,
		log: (level: string, message: string) => logs.push({ level, message }),
		setActionDefinitions: (definitions: unknown) => {
			actions = definitions as Record<string, ActionDef>
		},
		setFeedbackDefinitions: (definitions: unknown) => {
			feedbacks = definitions as Record<string, FeedbackDef>
		},
		setPresetDefinitions: (sections: unknown, definitions: unknown) => {
			structure.push(...(sections as typeof structure))
			presets = definitions as Record<string, PresetLike>
		},
		sendCommand: async (type: CommandType, payload?: unknown) => {
			sent.push({ type, payload })
		},
		sendCommandDetailed: async (type: CommandType, payload?: unknown) => {
			sent.push({ type, payload })
			return { ok: true, response: { type: 'ack_response' } }
		},
	} as unknown as ModuleInstance

	UpdateActions(self)
	UpdateFeedbacks(self)
	UpdatePresets(self)
	return { actions, feedbacks, presets, structure, sent, logs }
}

/** Problems with the options a preset supplies, as Companion would resolve them. */
function optionProblems(where: string, defs: Record<string, OptionDef>, supplied: Record<string, unknown>): string[] {
	const problems: string[] = []
	for (const [id, value] of Object.entries(supplied)) {
		const def = defs[id]
		if (!def) {
			problems.push(`${where}: option "${id}" is not declared (Companion would ignore it)`)
			continue
		}
		switch (def.type) {
			case 'number':
				if (typeof value !== 'number' || Number.isNaN(value)) {
					problems.push(`${where}.${id}: expected a number, got ${JSON.stringify(value)}`)
					break
				}
				if (def.min !== undefined && value < def.min) problems.push(`${where}.${id}: ${value} < min ${def.min}`)
				if (def.max !== undefined && value > def.max) problems.push(`${where}.${id}: ${value} > max ${def.max}`)
				break
			case 'textinput':
			case 'multiline':
				if (typeof value !== 'string') problems.push(`${where}.${id}: expected a string, got ${JSON.stringify(value)}`)
				break
			case 'checkbox':
				if (typeof value !== 'boolean')
					problems.push(`${where}.${id}: expected a boolean, got ${JSON.stringify(value)}`)
				break
			case 'colorpicker':
				if (typeof value !== 'number')
					problems.push(`${where}.${id}: expected a colour number, got ${JSON.stringify(value)}`)
				break
			case 'dropdown': {
				const allowed = (def.choices ?? []).map((choice) => choice.id)
				if (!allowed.includes(value as string)) {
					problems.push(`${where}.${id}: ${JSON.stringify(value)} is not one of ${JSON.stringify(allowed)}`)
				}
				break
			}
			default:
				break
		}
	}
	// A supplied value for an option that has no default is the risky case; the rest
	// Companion fills in itself.
	return problems
}

function optionDefs(options: OptionDef[]): Record<string, OptionDef> {
	return Object.fromEntries(options.map((option) => [option.id, option]))
}

describe('shipped presets', () => {
	const harness = buildHarness()
	const presetIds = Object.keys(harness.presets)

	it('publishes every preset to Companion', () => {
		expect(presetIds.length).toBe(20)
		expect(harness.structure).toHaveLength(20)
	})

	it('lists each preset in the section structure under its own id', () => {
		const problems: string[] = []
		for (const section of harness.structure) {
			if (!harness.presets[section.id]) problems.push(`section "${section.id}" has no preset of that id`)
			for (const definition of section.definitions ?? []) {
				for (const id of definition.presets ?? []) {
					if (!harness.presets[id]) problems.push(`section "${section.id}" references unknown preset "${id}"`)
				}
			}
			if (section.name.trim() === '') problems.push(`section "${section.id}" has an empty name`)
		}
		expect(problems).toEqual([])
	})

	it('names every preset, and paints every one', () => {
		const problems: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			if (preset.type !== 'simple') {
				problems.push(`${id}: unexpected preset type ${String(preset.type)}`)
				continue
			}
			if (!preset.name || preset.name.trim() === '') problems.push(`${id}: has no name`)
			if (!preset.style || Object.keys(preset.style).length === 0) problems.push(`${id}: has no style`)
			for (const key of Object.keys(preset.style ?? {})) {
				if (!STYLE_KEYS.has(key)) problems.push(`${id}.style: unknown style key "${key}"`)
			}
		}
		expect(problems).toEqual([])
	})

	it('binds every step to a declared action with options it accepts', () => {
		const problems: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			const steps = preset.steps ?? []
			if (steps.length === 0) problems.push(`${id}: has no steps`)
			const actionCount = steps.reduce((total, step) => total + (step.down?.length ?? 0) + (step.up?.length ?? 0), 0)
			if (actionCount === 0 && !DISPLAY_ONLY.has(id)) {
				problems.push(`${id}: runs no action, and it is not a display-only preset`)
			}
			steps.forEach((step, index) => {
				const calls = [...(step.down ?? []), ...(step.up ?? [])]
				if (calls.length === 0 && !DISPLAY_ONLY.has(id)) problems.push(`${id}: step ${index} runs nothing`)
				for (const call of calls) {
					const action = harness.actions[call.actionId]
					if (!action) {
						problems.push(`${id}: step ${index} uses unknown action "${call.actionId}"`)
						continue
					}
					problems.push(...optionProblems(`${id} → ${call.actionId}`, optionDefs(action.options), call.options ?? {}))
				}
			})
		}
		expect(problems).toEqual([])
	})

	it('binds every feedback to a declared feedback with options it accepts', () => {
		const problems: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			for (const feedback of preset.feedbacks ?? []) {
				const definition = harness.feedbacks[feedback.feedbackId]
				if (!definition) {
					problems.push(`${id}: uses unknown feedback "${feedback.feedbackId}"`)
					continue
				}
				problems.push(
					...optionProblems(`${id} → ${feedback.feedbackId}`, optionDefs(definition.options), feedback.options ?? {}),
				)
				for (const key of Object.keys(feedback.style ?? {})) {
					if (!STYLE_KEYS.has(key)) problems.push(`${id} → ${feedback.feedbackId}: unknown style key "${key}"`)
				}
			}
		}
		expect(problems).toEqual([])
	})

	it('turns every preset press into a valid protocol command', async () => {
		const problems: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			for (const step of preset.steps ?? []) {
				for (const call of step.down ?? []) {
					const action = harness.actions[call.actionId]
					if (!action) continue // reported by the structural test
					harness.sent.length = 0
					harness.logs.length = 0
					await action.callback({ options: { ...(call.options ?? {}) } })
					// Give detached continuations a turn to send.
					await Promise.resolve()

					if (harness.sent.length === 0) {
						// A local refusal is legitimate, but it must say why.
						if (harness.logs.length === 0) {
							problems.push(`${id} → ${call.actionId}: sent nothing and logged nothing`)
						}
						continue
					}
					if (harness.sent.length > 1) {
						problems.push(`${id} → ${call.actionId}: sent ${harness.sent.length} commands`)
					}
					for (const command of harness.sent) {
						const frame = { type: command.type, ...(command.payload ?? {}), request_id: 'preset-test' }
						if (!validateCommand(frame)) {
							problems.push(
								`${id} → ${call.actionId}: ${command.type} payload is invalid: ` +
									JSON.stringify(validateCommand.errors?.slice(0, 3)),
							)
						}
					}
				}
			}
		}
		expect(problems).toEqual([])
	})
})
