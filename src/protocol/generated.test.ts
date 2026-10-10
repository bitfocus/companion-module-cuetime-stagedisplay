import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import {
	COMMAND_TYPES,
	RESPONSE_TYPES,
	EVENT_TYPES,
	buildCommand,
	parseInbound,
	isResponse,
	isEvent,
} from './generated.js'
import type { CommandType, ResponseType, EventType } from './generated.js'

// The vendored schema is the contract; validating generated output against it is
// how we catch drift between the codegen and the far-side schema.
const schema = JSON.parse(
	readFileSync(fileURLToPath(new URL('../../schemas/protocol-schema.json', import.meta.url)), 'utf8'),
)

const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(schema, 'protocol')
const validateCommand = ajv.getSchema('protocol#/$defs/Command')!
const validateResponse = ajv.getSchema('protocol#/$defs/Response')!
const validateEvent = ajv.getSchema('protocol#/$defs/Event')!

function resolveRef(ref: string): any {
	let cur: any = schema
	for (const part of ref.replace(/^#\//, '').split('/')) cur = cur[part]
	return cur
}

/** Minimal value satisfying a schema property (for required-only construction). */
function minimalValue(prop: any): unknown {
	if (prop.$ref) return minimalObject(resolveRef(prop.$ref))
	if (prop.const !== undefined) return prop.const
	if (Array.isArray(prop.type)) {
		const nonNull = prop.type.filter((t: string) => t !== 'null')
		return nonNull.length === 0 ? null : minimalValue({ type: nonNull[0] })
	}
	switch (prop.type) {
		case 'string':
			return 'x'
		case 'integer':
		case 'number':
			return 1
		case 'boolean':
			return true
		case 'array':
			return []
		case 'object':
			return {}
		default:
			return null
	}
}

/** Object with only the schema-required properties set. */
function minimalObject(def: any): Record<string, unknown> {
	const required = new Set<string>(def.required ?? [])
	// Some messages express alternatives via anyOf (e.g. `ms`|`seconds`,
	// `text`|`message_id`); satisfy the first branch.
	const branch = (def.anyOf ?? def.oneOf ?? [])[0]
	for (const key of branch?.required ?? []) required.add(key)
	const out: Record<string, unknown> = {}
	for (const key of required) out[key] = minimalValue(def.properties[key])
	return out
}

function messageDef(union: string, type: string): any {
	return schema.$defs[union].$defs[type]
}

describe('generated command builders', () => {
	it('injects the discriminator and a fresh request_id', () => {
		const cmd = buildCommand('start_session', {}, 'req-1')
		expect(cmd).toEqual({ type: 'start_session', request_id: 'req-1' })
		expect(buildCommand('pause_session', {}).request_id).toMatch(/^[0-9a-f-]{36}$/)
	})

	it('never lets the payload override type/request_id', () => {
		const cmd = buildCommand('start_session', { session_id: 'abc' } as any, 'req-2')
		expect(cmd.type).toBe('start_session')
		expect(cmd.request_id).toBe('req-2')
		expect(cmd.session_id).toBe('abc')
	})

	it('produces a schema-valid envelope for every command type', () => {
		for (const type of COMMAND_TYPES) {
			const payload = minimalObject(messageDef('Command', type))
			delete payload.type
			delete payload.request_id
			const cmd = buildCommand(type as CommandType, payload as any, 'req')
			const ok = validateCommand(cmd)
			expect(ok, `${type}: ${JSON.stringify(validateCommand.errors)}`).toBe(true)
		}
	})

	it('accepts the real-world payloads the module will send', () => {
		const samples: Array<[CommandType, Record<string, unknown>]> = [
			['start_session', { session_id: 'sess-1' }],
			['add_session', { mode: 'countdown', seconds: 300, name: 'Break' }],
			['add_time', { ms: 60000 }],
			['subtract_time', { ms: 30000 }],
			['set_blackout', { action: 'enable' }],
			['set_flash', { action: 'toggle' }],
			['show_message', { text: 'Break Time', flash: true }],
			['set_brightness', { brightness: 50 }],
			['request_status', { detailed: true }],
			[
				'send_program',
				{
					program: {
						program_id: 'p1',
						program_name: 'Show',
						version: 'v1',
						settings: {},
						sessions: [{ name: 'One', id: 's1', duration_seconds: 60 }],
						messages: [{ content: 'Hello' }],
					},
				},
			],
		]
		for (const [type, payload] of samples) {
			const cmd = buildCommand(type, payload as any, 'req')
			const ok = validateCommand(cmd)
			expect(ok, `${type}: ${JSON.stringify(validateCommand.errors)}`).toBe(true)
		}
	})
})

describe('generated inbound parser', () => {
	it('parses and validates every response type', () => {
		expect(RESPONSE_TYPES.length).toBeGreaterThan(0)
		for (const type of RESPONSE_TYPES) {
			const obj = { ...minimalObject(messageDef('Response', type)), type }
			const ok = validateResponse(obj)
			expect(ok, `response ${type}: ${JSON.stringify(validateResponse.errors)}`).toBe(true)
			const parsed = parseInbound(JSON.stringify(obj))
			expect(parsed, `parse ${type}`).not.toBeNull()
			expect(isResponse(parsed!)).toBe(true)
			expect(isEvent(parsed!)).toBe(false)
			expect((parsed as any).type).toBe(type as ResponseType)
		}
	})

	it('parses and validates every event type', () => {
		for (const type of EVENT_TYPES) {
			const def = messageDef('Event', type)
			const obj: Record<string, unknown> = { ...minimalObject(def), type }
			// Events never carry request_id.
			delete obj.request_id
			const ok = validateEvent(obj)
			expect(ok, `event ${type}: ${JSON.stringify(validateEvent.errors)}`).toBe(true)
			const parsed = parseInbound(JSON.stringify(obj))
			expect(parsed, `parse ${type}`).not.toBeNull()
			expect(isEvent(parsed!)).toBe(true)
			expect(isResponse(parsed!)).toBe(false)
			expect((parsed as any).type).toBe(type as EventType)
		}
	})

	it('parses representative frames and narrows correctly', () => {
		const status = JSON.stringify({
			type: 'status_response',
			request_id: 'r1',
			control_center: {
				flash_start_time: 0,
				is_next_session: false,
				current_presenter_name: '',
				current_session_name: '',
				current_session_id: '',
				current_session_index: -1,
				is_blackout: false,
				program_time: 0,
				is_glowing: false,
				timer_run_state: 'idle',
				is_time_up_flashing: false,
				timer: 0,
				is_previous_session: false,
				elapsed_time: 0,
				flash_length: 0,
				program_elapsed_time: 0,
			},
		})
		const parsed = parseInbound(status)!
		expect(isResponse(parsed)).toBe(true)
		if (isResponse(parsed) && parsed.type === 'status_response') {
			expect(parsed.control_center?.timer_run_state).toBe('idle')
			expect(parsed.request_id).toBe('r1')
		}

		const hello = parseInbound(
			JSON.stringify({
				type: 'hello_event',
				version_name: '1.1.2',
				screen_name: 'Stage',
				version_code: 146,
				screen_id: 'abc',
			}),
		)!
		expect(isEvent(hello)).toBe(true)
		if (isEvent(hello) && hello.type === 'hello_event') {
			expect(hello.version_code).toBe(146)
		}

		const ack = parseInbound(
			JSON.stringify({ type: 'ack_response', message: 'ok', entity_id: 'sess-9', request_id: 'r2' }),
		)!
		expect(isResponse(ack)).toBe(true)

		const err = parseInbound(
			JSON.stringify({ type: 'error_response', code: 'INVALID_SESSION', message: 'nope', request_id: 'r3' }),
		)!
		expect(isResponse(err)).toBe(true)
		if (isResponse(err) && err.type === 'error_response') {
			expect(err.code).toBe('INVALID_SESSION')
		}
	})

	it('rejects malformed or unknown frames', () => {
		expect(parseInbound('not json')).toBeNull()
		expect(parseInbound('[]')).toBeNull()
		expect(parseInbound('null')).toBeNull()
		expect(parseInbound('{"no":"type"}')).toBeNull()
		expect(parseInbound('{"type":"made_up"}')).toBeNull()
	})
})
