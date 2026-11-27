import xoReact from 'eslint-config-xo-react';
import type {XoConfigItem} from 'xo';
import baseline from './scripts/comment-baseline.json' with {type: 'json'};
import {
	BANNED_COMMENT_MESSAGE,
	isAllowedComment,
} from './scripts/comment-policy.ts';

type RuleDefinition = NonNullable<
	NonNullable<XoConfigItem['plugins']>[string]['rules']
>[string];

type SourceComment = {
	type: 'Line' | 'Block' | 'Shebang';
	value: string;
	loc?: {
		start: {line: number; column: number};
		end: {line: number; column: number};
	} | null;
};

const noComments: RuleDefinition = {
	meta: {
		type: 'problem',
		docs: {description: 'Ban code comments except directives with a reason.'},
		schema: [],
		messages: {banned: BANNED_COMMENT_MESSAGE},
	},
	create(context) {
		const sourceCode = context.sourceCode as unknown as {
			getAllComments(): SourceComment[];
		};
		return {
			// eslint-disable-next-line @typescript-eslint/naming-convention -- ESLint names the visitor after the AST node
			Program() {
				for (const comment of sourceCode.getAllComments()) {
					if (
						comment.loc &&
						!isAllowedComment(
							comment.type === 'Line'
								? 'line'
								: comment.type === 'Block'
									? 'block'
									: 'shebang',
							comment.value,
						)
					) {
						context.report({loc: comment.loc, messageId: 'banned'});
					}
				}
			},
		};
	},
};

const xoConfig: XoConfigItem[] = [
	{
		ignores: [
			'apps/extension/scripts/browser/perf-profile.ts',
			'apps/extension/scripts/browser/perf-matrix.ts',
			'dist/**',
			'release/**',
			'docs/**',
			'apps/site/**',
			'apps/server/cloudflare-deploy/worker.js',
			'**/dist/**',
			'.agents/**',
			'.claude/worktrees/**',
			'skills-lock.json',
			'apps/extension/tests/fixtures/page-copy/**',
			'apps/extension/tests/fixtures/site-sources/**',
		],
	},
	{prettier: true},
	{
		plugins: {local: {rules: {'no-comments': noComments}}},
		rules: {'local/no-comments': 'error'},
	},
	...(Object.keys(baseline).length > 0
		? [
				{
					files: Object.keys(baseline),
					rules: {'local/no-comments': 'off' as const},
				},
			]
		: []),
	...(xoReact({prettier: true}) as XoConfigItem[]),
	{files: ['**/*.tsx'], settings: {react: {version: 'detect'}}},
	{
		files: ['**/*.{ts,tsx,mts,cts}'],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: [
					'./apps/extension/tsconfig.json',
					'./apps/extension/tsconfig.worker.json',
					'./apps/extension/tsconfig.node.json',
					'./apps/server/tsconfig.json',
					'./apps/server/tsconfig.worker.json',
					'./apps/mobile/tsconfig.json',
					'./tsconfig/test.json',
					'./tsconfig/node.json',
				],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		languageOptions: {globals: {chrome: 'readonly', window: 'readonly'}},
	},
	{
		rules: {
			'@typescript-eslint/strict-boolean-expressions': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			'@typescript-eslint/no-restricted-types': 'off',
			'@typescript-eslint/no-base-to-string': 'off',
			'@typescript-eslint/promise-function-async': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/strict-void-return': 'off',
			'@typescript-eslint/no-confusing-void-expression': [
				'error',
				{ignoreArrowShorthand: true},
			],
			'@stylistic/curly-newline': 'off',
			'@stylistic/no-mixed-operators': 'off',
			'no-useless-escape': 'off',
			'unicorn/prefer-block-statement-over-iife': 'off',
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{allowObjectTypes: 'always'},
			],
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{assertionStyle: 'as', objectLiteralTypeAssertions: 'allow'},
			],
			'@typescript-eslint/switch-exhaustiveness-check': [
				'error',
				{considerDefaultExhaustiveForUnions: true},
			],
			'no-void': 'off',
			eqeqeq: ['error', 'always', {null: 'ignore'}],
			'no-eq-null': 'off',
			'n/file-extension-in-import': 'off',
			'require-unicode-regexp': 'off',
			'regexp/prefer-named-capture-group': 'off',
			'unicorn/prefer-unicode-code-point-escapes': 'off',
			'regexp/no-super-linear-backtracking': 'off',
			'regexp/no-super-linear-move': 'off',
			'regexp/no-contradiction-with-assertion': 'off',
			complexity: 'off',
			'max-params': 'off',
			'max-lines': 'off',
			'max-depth': 'off',
			'unicorn/max-nested-calls': 'off',
			'no-await-in-loop': 'off',
			'unicorn/no-await-expression-member': 'off',
			'unicorn/consistent-boolean-name': 'off',
			'unicorn/name-replacements': 'off',
			'unicorn/catch-error-name': 'off',
			'unicorn/prefer-simple-condition-first': 'off',
			'unicorn/prefer-else-if': 'off',
			'@typescript-eslint/prefer-optional-chain': 'off',
			'unicorn/no-unreadable-array-destructuring': 'off',
			'unicorn/prefer-then-catch': 'off',
			'unicorn/no-immediate-mutation': 'off',
			'unicorn/no-break-in-nested-loop': 'off',
			'unicorn/no-object-as-default-parameter': 'off',
			'unicorn/prefer-number-coercion': 'off',
			'unicorn/prefer-iterator-to-array': 'off',
			'unicorn/prefer-iterator-helpers': 'off',
			'unicorn/prefer-set-methods': 'off',
			'unicorn/prefer-spread': 'off',
			'unicorn/no-useless-coercion': 'off',
			'@typescript-eslint/no-unnecessary-type-conversion': 'off',
			'unicorn/no-unnecessary-global-this': 'off',
			'unicorn/prefer-top-level-await': 'off',
			'react-hooks/set-state-in-effect': 'off',
			'react-hooks/refs': 'off',
			'@eslint-react/no-array-index-key': 'off',
			'jsx-a11y-x/label-has-associated-control': [
				'error',
				{controlComponents: ['Checkbox']},
			],
			'jsx-a11y-x/no-autofocus': 'off',
		},
	},
	{
		files: ['apps/extension/shell/*.html'],
		rules: {
			'@html-eslint/require-meta-description': 'off',
			'@html-eslint/require-open-graph-protocol': 'off',
			'@html-eslint/head-order': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {'package-json/prefer-shorthand': 'off'},
	},
	{
		files: ['apps/extension/package.json'],
		rules: {'package-json/dependency-version-range': 'off'},
	},
	{
		files: ['apps/mobile/**/*.{ts,tsx}', 'apps/server/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/extension/src/app/*', '**/extension/scripts/*'],
							message:
								'Import shared code from apps/extension/src/shared instead (see docs/agents/cross-app.md).',
						},
					],
				},
			],
		},
	},
	{
		files: ['apps/server/src/node.ts'],
		rules: {'unicorn/no-process-exit': 'off'},
	},
	{
		files: [
			'tsconfig.json',
			'tsconfig/*.json',
			'apps/*/tsconfig*.json',
			'apps/server/wrangler.jsonc',
		],
		language: 'json/jsonc',
	},
	{
		files: ['apps/extension/styles/**/*.css'],
		languageOptions: {
			customSyntax: {
				atrules: {
					theme: {prelude: '<ident>*'},
					source: {prelude: '<string> | not <string>'},
				},
			},
		},
	},
	{
		files: [
			'apps/extension/shell/service-worker.ts',
			'apps/extension/src/shared/bookmark-rules.ts',
			'apps/extension/src/shared/library-normalize.ts',
			'apps/extension/src/shared/session-folders.ts',
			'apps/extension/src/shared/import-formats.ts',
			'apps/extension/src/app/bookmark-drag.ts',
			'apps/extension/src/app/{interaction-actions,newtab,page-params}.ts{,x}',
		],
		rules: {
			'no-control-regex': 'off',
			'regexp/no-control-character': 'off',
		},
	},
	{
		files: ['apps/extension/shell/service-worker.ts'],
		rules: {'@typescript-eslint/consistent-type-imports': 'off'},
	},
	{
		files: ['apps/extension/src/components/ui/**'],
		rules: {
			'@eslint-react/no-forward-ref': 'off',
			'@eslint-react/no-context-provider': 'off',
			'@eslint-react/no-use-context': 'off',
			'@eslint-react/naming-convention-ref-name': 'off',
			'@eslint-react/naming-convention-id-name': 'off',
			'jsx-a11y-x/heading-has-content': 'off',
		},
	},
	{
		files: ['apps/*/tests/**', 'scripts/**/*.test.ts'],
		rules: {
			'@typescript-eslint/naming-convention': 'off',
			'@eslint-react/naming-convention-context-name': 'off',
			'no-script-url': 'off',
		},
	},
	{
		files: [
			'apps/extension/scripts/vite-shared.ts',
			'apps/extension/scripts/manifest-targets.ts',
		],
		rules: {'@typescript-eslint/naming-convention': 'off'},
	},
	{
		files: ['apps/extension/scripts/verify-build.ts'],
		rules: {'no-new': 'off'},
	},
	{
		files: ['apps/extension/src/app/options.tsx'],
		rules: {'unicorn/no-computed-property-existence-check': 'off'},
	},
	{
		files: ['apps/extension/src/app/help.tsx'],
		rules: {'@typescript-eslint/no-deprecated': 'off'},
	},
	{
		files: ['apps/mobile/package.json'],
		rules: {
			'package-json/dependency-version-range': 'off',
			'package-json/prefer-type-module': 'off',
			'package-json/prefer-exports': 'off',
			'package-json/require-engines': 'off',
			'package-json/no-orphan-script-hooks': 'off',
		},
	},
];

export default xoConfig;
