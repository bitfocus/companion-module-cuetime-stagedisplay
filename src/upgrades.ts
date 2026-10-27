import type {
	CompanionMigrationAction,
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import type { Config } from './main.ts'

/**
 * Legacy `show_message` flash option values, mapped onto the current three-state forms.
 *
 * The option used to be `enable` / `disable` with `disable` as the preset default.
 * Under the protocol revision this module was first built against, `false` meant
 * "leave the flash flag alone", so the honest mapping for `disable` is `keep`
 * (alongside omitting the field, which is the same thing). `enable` genuinely meant
 * "turn it on", so it maps to `on`.
 *
 * Anything already unrecognised is deliberately rewired to `keep` rather than guessed
 * at: leaving the flash untouched is the only behaviour that was ever safe, because
 * `false` means "stop the flash" in the current protocol revision.
 */
const LEGACY_FLASH_VALUES: Record<string, string> = {
	enable: 'on',
	disable: 'keep',
}

/** Option value shape Companion stores: a literal or an expression. */
type StoredOption = { value?: unknown; isExpression?: boolean } | undefined

function literalValue(option: StoredOption): string {
	if (!option || typeof option !== 'object') return ''
	return String(option.value ?? '')
}

/**
 * Brings stored `show_message` actions up to date.
 *
 * Two things broke existing buttons when the action gained its stored-message form:
 *
 * 1. `message_number` is a new option, and Companion validates options *before* it
 *    calls the action — a missing required option fails the action outright with
 *    "A value must be provided". Supplying the default keeps those buttons working.
 * 2. The old `flash` values are no longer in the choice list, which fails validation
 *    with "Value is not in the list of choices".
 *
 * Neither error is visible in the module's own code — Companion rejects the action
 * before it runs — so this cannot be fixed by making the action tolerant.
 */
function upgradeShowMessage(action: CompanionMigrationAction, changed: CompanionMigrationAction[]): void {
	if (action.actionId !== 'show_message') return

	const options = { ...action.options }
	let touched = false

	if (options.message_number === undefined) {
		// 0 means "no stored message; use the text field", which is what these buttons did.
		options.message_number = { value: 0, isExpression: false }
		touched = true
	}

	const flash = LEGACY_FLASH_VALUES[literalValue(options.flash)]
	if (flash !== undefined) {
		options.flash = { value: flash, isExpression: false }
		touched = true
	}

	if (touched) changed.push({ ...action, options })
}

/**
 * Upgrade scripts, run by Companion for an instance whose stored data predates them.
 *
 * There is exactly one, and it exists because an action gained a required option and
 * changed its choice ids — a shape change that breaks stored buttons until it is
 * rewritten. New shape changes of that kind need a script each; they are cumulative
 * and must never be removed, since Companion tracks only the highest index applied.
 */
export const UpgradeScripts: CompanionStaticUpgradeScript<Config>[] = [
	function migrateShowMessageOptions(
		_context: CompanionUpgradeContext<Config>,
		props: CompanionStaticUpgradeProps<Config, undefined>,
	): CompanionStaticUpgradeResult<Config, undefined> {
		const updatedActions: CompanionMigrationAction[] = []
		for (const action of props.actions) {
			upgradeShowMessage(action, updatedActions)
		}

		return {
			updatedConfig: null,
			updatedActions,
			updatedFeedbacks: [],
		}
	},
]
