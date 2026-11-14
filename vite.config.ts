import {defineConfig} from 'vite-plus';

// Root Vite+ config for `vp test` and the commit hooks' `vp staged`. Linting and formatting use XO (xo.config.ts).
// Each app's tests live in apps/<app>/tests; the extension is built by apps/extension/scripts/build.ts.
export default defineConfig({
	test: {
		include: ['apps/*/tests/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node',
	},
	// Run by the pre-commit hook (.hooks/pre-commit). XO only checks here; `vp run lint:fix` fixes.
	staged: {
		'*.{ts,tsx,js,mjs,cjs}': 'xo',
		'package.json': 'xo',
	},
});
