import { describe, it, expect } from 'vitest'
import type { CompanionMigrationAction, CompanionStaticUpgradeProps } from '@companion-module/base'
import { UpgradeScripts } from './upgrades.ts'
import type { Config } from './main.ts'

const script = UpgradeScripts[0]!

function action(actionId: string, options: Record<string, unknown>): CompanionMigrationAction {
	return { id: `a-${actionId}`, controlId: 'c1', actionId, options: options as never }
}

function run(actions: CompanionMigrationAction[]) {
	const props = {
		config: { host: '192.168.1.53', port: '8081', 'cuetime-display': null } as Config,
		secrets: null,
		actions,
		feedbacks: [],
	} as CompanionStaticUpgradeProps<Config, undefined>
	// The context is unused by this script; only the props matter.
	return script({ currentConfig: props.config! }, props)
}

/** Reads the literal out of Companion's `{ value, isExpression }` option shape. */
function literal(options: Record<string, unknown>, key: string): unknown {
	const option = options[key] as { value?: unknown } | undefined
	return option?.value
}

describe('upgrade scripts', () => {
	it('exposes exactly one script, since Companion only tracks the highest index applied', () => {
		expect(UpgradeScripts).toHaveLength(1)
		expect(typeof script).toBe('function')
	})

	it('adds the missing message_number to stored Show Message actions', () => {
		// Without this, Companion refuses the action with "A value must be provided"
		// because the option is validated before the callback ever runs.
		const result = run([action('show_message', { text: { value: 'Hurry Up', isExpression: false } })])

		expect(result.updatedActions).toHaveLength(1)
		expect(literal(result.updatedActions[0]!.options, 'message_number')).toBe(0)
	})

	it('rewrites legacy flash values that are no longer valid choices', () => {
		const result = run([
			action('show_message', { text: { value: 'a' }, flash: { value: 'disable', isExpression: false } }),
			action('show_message', { text: { value: 'b' }, flash: { value: 'enable', isExpression: false } }),
		])

		// `disable` historically meant "leave the flag alone", which is what `keep` now says.
		expect(literal(result.updatedActions[0]!.options, 'flash')).toBe('keep')
		expect(literal(result.updatedActions[1]!.options, 'flash')).toBe('on')
	})

	it('preserves the operator text and expression flags', () => {
		const result = run([
			action('show_message', {
				text: { value: 'Hold Mic Closer', isExpression: false },
				flash: { value: 'disable', isExpression: false },
			}),
		])

		const options = result.updatedActions[0]!.options as Record<string, { value?: unknown; isExpression?: boolean }>
		expect(options.text!.value).toBe('Hold Mic Closer')
		expect(options.text!.isExpression).toBe(false)
		expect(options.flash!.isExpression).toBe(false)
	})

	it('leaves already-migrated actions alone, so it is safe to run twice', () => {
		const migrated = action('show_message', {
			message_number: { value: 0, isExpression: false },
			text: { value: 'x', isExpression: false },
			flash: { value: 'keep', isExpression: false },
		})
		expect(run([migrated]).updatedActions).toHaveLength(0)
	})

	it('touches nothing but show_message, and never the config', () => {
		const result = run([
			action('add_time', { seconds: { value: 60, isExpression: false } }),
			action('blackout', { action: { value: 'toggle', isExpression: false } }),
			action('show_message', { text: { value: 'x', isExpression: false } }),
		])

		expect(result.updatedActions.map((a) => a.actionId)).toEqual(['show_message'])
		expect(result.updatedConfig).toBeNull()
		expect(result.updatedFeedbacks).toEqual([])
	})

	it('copes with an empty option set rather than throwing', () => {
		const result = run([action('show_message', {})])
		expect(literal(result.updatedActions[0]!.options, 'message_number')).toBe(0)
	})
})
