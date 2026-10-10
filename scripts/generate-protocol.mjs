// Generates src/protocol/generated.ts from the vendored JSON Schema.
//
// Source: schemas/protocol-schema.json
//         (vendored from Android-Display-App @ e0b2069a, protocol vc146)
// Regen:  yarn generate-protocol
//
// The schema is a draft 2020-12 document whose three top-level unions
// (Command / Response / Event) each carry their own nested `$defs`. This script
// emits:
//   - TS interfaces for every nested object type (per union, prefixed);
//   - a per-union payload type map (message properties minus `type`/`request_id`);
//   - string-literal unions of the `const` discriminators;
//   - discriminated union types for commands, responses and events;
//   - a typed `buildCommand()` (auto `request_id`) and an inbound parser.
//
// This file is intentionally dependency-free and deterministic so CI can run it
// and assert a clean `git diff`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const schemaPath = resolve(root, 'schemas/protocol-schema.json')
const outPath = resolve(root, 'src/protocol/generated.ts')

const SOURCE_COMMIT = 'e0b2069a'

/** @type {any} */
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))

const UNIONS = ['Command', 'Response', 'Event']

/** @param {string} ref */
function refInfo(ref) {
	const m = /^#\/\$defs\/([A-Za-z]+)\/\$defs\/(.+)$/.exec(ref)
	if (!m) throw new Error(`Unsupported $ref: ${ref}`)
	return { union: m[1], name: m[2] }
}

/** @param {string} union @param {string} name */
const typeName = (union, name) => `${union}${name}`

/** @param {string} t */
function prim(t) {
	switch (t) {
		case 'string':
			return 'string'
		case 'integer':
		case 'number':
			return 'number'
		case 'boolean':
			return 'boolean'
		case 'null':
			return 'null'
		default:
			return 'unknown'
	}
}

/** @param {any} prop */
function tsType(prop) {
	if (!prop || typeof prop !== 'object') return 'unknown'
	if (prop.$ref) {
		const { union, name } = refInfo(prop.$ref)
		return typeName(union, name)
	}
	if (prop.const !== undefined) return JSON.stringify(prop.const)
	if (Array.isArray(prop.type)) {
		const nonNull = prop.type.filter((t) => t !== 'null')
		const ts = nonNull.map(prim).join(' | ') || 'null'
		return prop.type.includes('null') ? `${ts} | null` : ts
	}
	if (prop.type === 'array') return `${tsType(prop.items)}[]`
	if (prop.type === 'object') return 'Record<string, unknown>'
	if (prop.type) return prim(prop.type)
	return 'unknown'
}

/** @param {string} name @param {any} def */
function emitInterface(name, def) {
	const props = def.properties ?? {}
	const required = new Set(def.required ?? [])
	const lines = [`export interface ${name} {`]
	for (const [key, value] of Object.entries(props)) {
		const opt = required.has(key) ? '' : '?'
		lines.push(`\t${key}${opt}: ${tsType(value)}`)
	}
	lines.push('}')
	return lines.join('\n')
}

/**
 * @param {any} unionDef
 * @param {string} union
 */
function messageNames(unionDef) {
	return (unionDef.oneOf ?? []).map((v) => refInfo(v.$ref).name)
}

/**
 * @param {any} unionDef
 * @param {string} union
 * @param {string} unionName
 */
function emitUnion(unionDef, union, unionName) {
	const defs = unionDef.$defs ?? {}
	const messages = messageNames(unionDef)
	const helpers = Object.keys(defs).filter((n) => !messages.includes(n))

	const out = []
	out.push(`// ----------------------------------------------------------------`)
	out.push(`// ${unionName}`)
	out.push(`// ----------------------------------------------------------------`)
	out.push('')

	out.push(`export const ${unionName.toUpperCase()}_TYPES = [`)
	for (const n of messages) out.push(`\t${JSON.stringify(n)},`)
	out.push(`] as const`)
	out.push('')
	out.push(`export type ${unionName}Type = (typeof ${unionName.toUpperCase()}_TYPES)[number]`)
	out.push('')
	out.push(`const ${unionName.toUpperCase()}_TYPE_SET: ReadonlySet<string> = new Set(${unionName.toUpperCase()}_TYPES)`)
	out.push('')

	for (const h of helpers) {
		out.push(emitInterface(typeName(union, h), defs[h]))
		out.push('')
	}

	out.push(`export interface ${unionName}Payloads {`)
	for (const n of messages) {
		const def = defs[n]
		const props = def.properties ?? {}
		const required = new Set(def.required ?? [])
		out.push(`\t${n}: {`)
		for (const [key, value] of Object.entries(props)) {
			if (key === 'type' || key === 'request_id') continue
			const opt = required.has(key) ? '' : '?'
			out.push(`\t\t${key}${opt}: ${tsType(value)}`)
		}
		out.push(`\t}`)
	}
	out.push('}')
	out.push('')

	// Discriminated union. Commands always carry a fresh request_id; responses
	// echo one only when the client sent it; events never carry one.
	let extra = ''
	if (union === 'Command') extra = ' & { request_id: string }'
	else if (union === 'Response') extra = ' & { request_id?: string | null }'
	out.push(
		`export type ${union} = {\n\t[K in ${unionName}Type]: { type: K } & ${unionName}Payloads[K]${extra}\n}[${unionName}Type]`,
	)
	out.push('')
	return out.join('\n')
}

let output = ''
output += `// AUTO-GENERATED by scripts/generate-protocol.mjs — DO NOT EDIT.\n`
output += `//\n`
output += `// Source schema: schemas/protocol-schema.json\n`
output += `// Vendored from Android-Display-App @ ${SOURCE_COMMIT} (protocol vc146).\n`
output += `// Regenerate with: yarn generate-protocol\n`
output += `\n`

// Command sends the discriminator + a fresh request_id; the rest of the unions
// are inbound-only.
for (const union of UNIONS) {
	output += emitUnion(schema.$defs[union], union, union) + '\n'
}

output += `// ----------------------------------------------------------------\n`
output += `// Helpers\n`
output += `// ----------------------------------------------------------------\n`
output += `\n`
output += `/** Fresh correlation id for every command. */\n`
output += `export function newRequestId(): string {\n`
output += `\treturn globalThis.crypto.randomUUID()\n`
output += `}\n`
output += `\n`
output += `/**\n`
output += ` * Builds a command envelope with its \`type\` discriminator and a fresh\n`
output += ` * \`request_id\` (overridable for tests).\n`
output += ` */\n`
output += `export function buildCommand<K extends CommandType>(\n`
output += `\ttype: K,\n`
output += `\tpayload: CommandPayloads[K],\n`
output += `\trequestId: string = newRequestId(),\n`
output += `): { type: K; request_id: string } & CommandPayloads[K] {\n`
output += `\treturn { request_id: requestId, ...payload, type } as { type: K; request_id: string } & CommandPayloads[K]\n`
output += `}\n`
output += `\n`
output += `/** Parses one inbound WS frame into a typed Response or Event, or null. */\n`
output += `export function parseInbound(text: string): Response | Event | null {\n`
output += `\tlet value: unknown\n`
output += `\ttry {\n`
output += `\t\tvalue = JSON.parse(text)\n`
output += `\t} catch {\n`
output += `\t\treturn null\n`
output += `\t}\n`
output += `\tif (typeof value !== 'object' || value === null) return null\n`
output += `\tconst type = (value as { type?: unknown }).type\n`
output += `\tif (typeof type !== 'string') return null\n`
output += `\tif (RESPONSE_TYPE_SET.has(type)) return value as Response\n`
output += `\tif (EVENT_TYPE_SET.has(type)) return value as Event\n`
output += `\treturn null\n`
output += `}\n`
output += `\n`
output += `/** Narrows a parsed message to a Response. */\n`
output += `export function isResponse(msg: Response | Event): msg is Response {\n`
output += `\treturn RESPONSE_TYPE_SET.has(msg.type)\n`
output += `}\n`
output += `\n`
output += `/** Narrows a parsed message to an Event. */\n`
output += `export function isEvent(msg: Response | Event): msg is Event {\n`
output += `\treturn EVENT_TYPE_SET.has(msg.type)\n`
output += `}\n`

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, output, 'utf8')
console.log(`Wrote ${outPath} (${output.length} bytes)`)
