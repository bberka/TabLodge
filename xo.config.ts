// Lint and format configuration: XO (ESLint) with its default style, Prettier formatting, and React rules.
// `vp run lint` checks, `vp run lint:fix` (alias `vp run format`) fixes and formats.
// Every rule turned off or relaxed below says why; prefer fixing the code over adding to this list.
import xoReact from 'eslint-config-xo-react';
import type {XoConfigItem} from 'xo';

const xoConfig: XoConfigItem[] = [
	{
		ignores: [
			'dist/**',
			'release/**',
			'docs/**',
			'site/**',
			'.agents/**',
			'.claude/worktrees/**',
			'skills-lock.json',
		],
	},
	{prettier: true},
	...(xoReact({prettier: true}) as XoConfigItem[]),
	{files: ['**/*.tsx'], settings: {react: {version: 'detect'}}},
	{
		// Type-aware rules need the real compiler options (paths, JSX, chrome/vite types); tsconfig.json is only a solution file.
		files: ['**/*.{ts,tsx,mts,cts}'],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: [
					'./tsconfig.app.json',
					'./tsconfig.worker.json',
					'./tsconfig.test.json',
					'./tsconfig.node.json',
				],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// Browser-provided globals that ESLint does not know in TypeScript files; declaring them lets `chrome.api?.method` feature checks lint as intended.
		languageOptions: {globals: {chrome: 'readonly', window: 'readonly'}},
	},
	{
		rules: {
			// Truthiness checks on strings, numbers, and optional values are the house style (untrusted input is normalized everywhere).
			'@typescript-eslint/strict-boolean-expressions': 'off',
			// `||` is used on purpose to also replace empty strings and 0; `??` would change behavior.
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			// `null` is what Chrome APIs, JSON, React refs/state, and stored data already use; the rule would rewrite hundreds of types and the code that produces them.
			'@typescript-eslint/no-restricted-types': 'off',
			// `String(untrusted)` is the deliberate coercion for values read from imports, forms, and messages.
			'@typescript-eslint/no-base-to-string': 'off',
			// Adding `async` to functions that return a promise changes how synchronous throws surface and adds noise to one-line callbacks.
			'@typescript-eslint/promise-function-async': 'off',
			// `() => {}` is the standard no-op for swallowed promise rejections and default callbacks.
			'@typescript-eslint/no-empty-function': 'off',
			// Shorthand callbacks such as `(open) => !open && close()` and `() => send()` are the idiom for React handlers and Chrome listeners.
			'@typescript-eslint/strict-void-return': 'off',
			'@typescript-eslint/no-confusing-void-expression': [
				'error',
				{ignoreArrowShorthand: true},
			],
			// Prettier owns brace layout and drops the clarifying parentheses in `a + (b / 2)`; these two rules would fight it forever.
			'@stylistic/curly-newline': 'off',
			'@stylistic/no-mixed-operators': 'off',
			// The `regexp/no-useless-escape` rule already checks regular expressions, and it wants the `\-` that `regexp/sort-character-class-elements` places last in a class.
			'no-useless-escape': 'off',
			// The theme boot script is an IIFE so its variables stay out of the global scope of a classic script.
			'unicorn/prefer-block-statement-over-iife': 'off',
			// `{}` marks "no extra fields" in the message map, and `{} extends Fields` is how optional arguments are derived.
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{allowObjectTypes: 'always'},
			],
			// Object literals with computed keys (`{[name]: value} as Partial<Settings>`) cannot be typed without an assertion.
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{assertionStyle: 'as', objectLiteralTypeAssertions: 'allow'},
			],
			// `handleMessage` switches on untrusted message types, so its `default` branch is the exhaustive case.
			'@typescript-eslint/switch-exhaustiveness-check': [
				'error',
				{considerDefaultExhaustiveForUnions: true},
			],
			// `void promise` marks intentional fire-and-forget calls, as no-floating-promises expects.
			'no-void': 'off',
			// `value != null` is the idiom for "neither null nor undefined".
			eqeqeq: ['error', 'always', {null: 'ignore'}],
			'no-eq-null': 'off',
			// Scripts import `.ts` files for Node's type stripping while the app uses extensionless bundler imports; the fixer would break both.
			'n/file-extension-in-import': 'off',
			// Adding the `u`/`v` flag or named groups to every pattern is churn with a risk of changing how patterns match.
			'require-unicode-regexp': 'off',
			'regexp/prefer-named-capture-group': 'off',
			// Code point escapes need the `u` flag (see above); `\u0000` in a sanitizer is clearer than `\u{0}`.
			'unicorn/prefer-unicode-code-point-escapes': 'off',
			// The import parsers are bounded by MAX_IMPORT_BYTES; rewriting their patterns risks changing what imports match.
			'regexp/no-super-linear-backtracking': 'off',
			'regexp/no-super-linear-move': 'off',
			'regexp/no-contradiction-with-assertion': 'off',
			// Size/complexity limits: the service worker is one large message dispatcher by design (it must stay a single classic script).
			complexity: 'off',
			'max-params': 'off',
			'max-lines': 'off',
			'max-depth': 'off',
			'unicorn/max-nested-calls': 'off',
			// Sequential awaits are intentional: Chrome tab and window operations must run in order.
			'no-await-in-loop': 'off',
			// `(await chrome.tabs.query({}))[0]` and `(await getStore()).settings` read clearly with Chrome's promise APIs.
			'unicorn/no-await-expression-member': 'off',
			// Naming opinions that would rename props, parameters, and event handlers across the app.
			'unicorn/consistent-boolean-name': 'off',
			'unicorn/name-replacements': 'off',
			'unicorn/catch-error-name': 'off',
			// Reordering conditions or merging adjacent ifs is only safe when side effects and evaluation order are proven unaffected.
			'unicorn/prefer-simple-condition-first': 'off',
			'unicorn/prefer-else-if': 'off',
			'@typescript-eslint/prefer-optional-chain': 'off',
			// `[a[i], a[j]] = [a[j], a[i]]` is the standard swap; `.then(run, run)` runs the next job after success or failure on purpose.
			'unicorn/no-unreadable-array-destructuring': 'off',
			'unicorn/prefer-then-catch': 'off',
			// Style-only restructuring that is not safe to automate.
			'unicorn/no-immediate-mutation': 'off',
			'unicorn/no-break-in-nested-loop': 'off',
			'unicorn/no-object-as-default-parameter': 'off',
			// ParseInt is deliberate where leading digits are read from a longer string.
			'unicorn/prefer-number-coercion': 'off',
			// Iterator helpers and Set methods (Chrome 122) are newer than `minimum_chrome_version` 116.
			'unicorn/prefer-iterator-to-array': 'off',
			'unicorn/prefer-iterator-helpers': 'off',
			'unicorn/prefer-set-methods': 'off',
			// `Array.from` also accepts array-likes (DataTransfer.types, DOMStringList); spreading them throws.
			'unicorn/prefer-spread': 'off',
			// Autofix hazards: this rule dropped `Boolean(error)` on an `unknown`-typed value, changing what is stored.
			'unicorn/no-useless-coercion': 'off',
			'@typescript-eslint/no-unnecessary-type-conversion': 'off',
			// `globalThis.ClipboardItem` is deliberate: a bare identifier throws a ReferenceError where the class does not exist (service worker, Node tests).
			'unicorn/no-unnecessary-global-this': 'off',
			// Page entry modules fire a promise on purpose; top-level await would hold up rendering.
			'unicorn/prefer-top-level-await': 'off',
			// React Compiler diagnostics; the project does not use the compiler and the flagged patterns are deliberate.
			'react-hooks/set-state-in-effect': 'off',
			'react-hooks/refs': 'off',
			// Lists derived from a text split or an import preview have no stable ids and are never reordered.
			'@eslint-react/no-array-index-key': 'off',
			// The shadcn `Checkbox` renders the form control a label wraps.
			'jsx-a11y-x/label-has-associated-control': [
				'error',
				{controlComponents: ['Checkbox']},
			],
			// Dialog fields take initial focus on purpose; Radix traps focus in the dialog and restores it on close.
			'jsx-a11y-x/no-autofocus': 'off',
		},
	},
	{
		// HTML shells are extension pages, not public web pages; the order of the boot script, styles, and bundle in <head> is deliberate.
		files: ['extension/*.html'],
		rules: {
			'@html-eslint/require-meta-description': 'off',
			'@html-eslint/require-open-graph-protocol': 'off',
			'@html-eslint/head-order': 'off',
		},
	},
	{
		// `repository` and `bugs` stay objects (`src/app/project.ts` reads `repository.url`), and Tailwind is pinned to its final 3.x release on purpose (the config is v3-only).
		files: ['package.json'],
		rules: {
			'package-json/prefer-shorthand': 'off',
			'package-json/dependency-version-range': 'off',
		},
	},
	{
		// The tsconfig files carry explanatory comments, so they are JSONC.
		files: ['tsconfig*.json'],
		language: 'json/jsonc',
	},
	{
		// Tailwind's `@tailwind base|components|utilities` directives are not standard CSS.
		files: ['styles/**/*.css'],
		languageOptions: {
			customSyntax: {atrules: {tailwind: {prelude: '<ident>'}}},
		},
	},
	{
		// Sanitizers strip C0 control characters from untrusted titles and URLs on purpose.
		files: [
			'extension/service-worker.ts',
			'src/app/{import-formats,interaction-actions,newtab,page-params}.ts{,x}',
		],
		rules: {
			'no-control-regex': 'off',
			'regexp/no-control-character': 'off',
		},
	},
	{
		// The service worker is a classic script that tests type-strip and run in a VM, so it cannot use `import type` statements; `import("...")` types keep it self-contained.
		files: ['extension/service-worker.ts'],
		rules: {'@typescript-eslint/consistent-type-imports': 'off'},
	},
	{
		// Shadcn-style primitives mirror the upstream generator output (forwardRef, Context.Provider, useContext), which is updated by regenerating, not by hand.
		files: ['src/components/ui/**'],
		rules: {
			'@eslint-react/no-forward-ref': 'off',
			'@eslint-react/no-context-provider': 'off',
			'@eslint-react/no-use-context': 'off',
			'@eslint-react/naming-convention-ref-name': 'off',
			'@eslint-react/naming-convention-id-name': 'off',
			// Heading primitives receive their content through `children` at the call site.
			'jsx-a11y-x/heading-has-content': 'off',
		},
	},
	{
		// Tests mock Chrome and web-platform globals (`getURL`, `WINDOW_ID_NONE`, `URL`), feed `javascript:` URLs to the sanitizers, and name `vm.createContext` results `context`.
		files: ['tests/**'],
		rules: {
			'@typescript-eslint/naming-convention': 'off',
			'@eslint-react/naming-convention-context-name': 'off',
			'no-script-url': 'off',
		},
	},
	{
		// `homepage_url` is a manifest key, not our naming choice.
		files: ['scripts/vite-shared.ts'],
		rules: {'@typescript-eslint/naming-convention': 'off'},
	},
	{
		// Constructing `vm.Script` is the syntax check; the instance itself is not needed.
		files: ['scripts/verify-build.ts'],
		rules: {'no-new': 'off'},
	},
	{
		// The settings page reads boolean setting values by dynamic name; presence is not the question there.
		files: ['src/app/options.tsx'],
		rules: {'unicorn/no-computed-property-existence-check': 'off'},
	},
	{
		// Lucide-react marks its brand icons deprecated, but it is the only GitHub mark the bundled icon set offers.
		files: ['src/app/help.tsx'],
		rules: {'@typescript-eslint/no-deprecated': 'off'},
	},
];

export default xoConfig;
