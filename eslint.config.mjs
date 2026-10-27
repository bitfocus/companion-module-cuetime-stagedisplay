import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

export default [
	...(await generateEslintConfig({
		enableTypescript: true,
		ignores: [
			// Generated from schemas/protocol-schema.json by scripts/generate-protocol.mjs
			'src/protocol/generated.ts',
			// Generated from icons_*/ by scripts/generate-icons.mjs (gitignored)
			'src/generated-icons.ts',
			'.yarn/**',
			'pkg/**',
		],
	})),
	{
		// Type-aware linting needs a project covering root-level TS too (vitest.config.ts).
		// Scoped to TS so the shared config's project-less handling of .mjs files still applies.
		files: ['**/*.ts', '**/*.cts', '**/*.mts'],
		languageOptions: { parserOptions: { project: ['./tsconfig.eslint.json'] } },
	},
	{
		files: ['**/*.ts'],
		rules: {
			// TypeScript ESM: import specifiers carry a .js extension but resolve to .ts sources,
			// which eslint-plugin-n cannot follow.
			'n/no-missing-import': 'off',
			// Nothing here is published raw — companion-module-build bundles the sources into
			// main.js with esbuild — so the rule only produces noise (src imports the generated
			// icons module, tests import vitest, vitest.config.ts imports vitest).
			'n/no-unpublished-import': 'off',
			// Companion option values are untyped (unknown); coercing them with String(x ?? '')
			// is deliberate, and the fallbacks guarantee a string. Revisit if these gain types.
			'@typescript-eslint/no-base-to-string': 'off',
		},
	},
	{
		// Build scripts are run directly by node, so exiting non-zero on failure is intended.
		files: ['scripts/**/*.mjs'],
		rules: { 'n/hashbang': 'off', 'n/no-process-exit': 'off' },
	},
]
