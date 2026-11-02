import { describe, it, expect } from 'vitest'
import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.ts'
import { FEEDBACK_IDS, UpdateFeedbacks } from './feedbacks.ts'
import { createInitialState } from './protocol/state.ts'

/**
 * Companion only re-runs a feedback when the module asks it to, so the list passed to
 * `checkFeedbacks` is part of each feedback's contract. `progress_bar` was missing
 * from that list in 0.1.0 and drew once, then froze. These tests keep the list and
 * the definitions from drifting apart.
 */
describe('feedback refresh list', () => {
	function definitions(): CompanionFeedbackDefinitions {
		let captured: CompanionFeedbackDefinitions = {}
		const self = {
			state: createInitialState(),
			setFeedbackDefinitions: (value: CompanionFeedbackDefinitions) => {
				captured = value
			},
		} as unknown as ModuleInstance
		UpdateFeedbacks(self)
		return captured
	}

	it('names every defined feedback, and nothing that does not exist', () => {
		expect([...FEEDBACK_IDS].sort()).toEqual(Object.keys(definitions()).sort())
	})

	it('includes the session progress bar, which used to be refreshed never', () => {
		expect(FEEDBACK_IDS).toContain('progress_bar')
	})

	it('declares affectedProperties on every advanced feedback (API 2.1 requires it)', () => {
		// `false` is a legal definition value (the feedback is disabled), hence the cast.
		const all = definitions() as Record<string, { type?: string; affectedProperties?: unknown } | false | undefined>
		for (const [id, definition] of Object.entries(all)) {
			if (!definition) continue
			if (definition.type === 'advanced') {
				expect(definition.affectedProperties, `${id} must declare affectedProperties`).toBeDefined()
			}
		}
	})
})
