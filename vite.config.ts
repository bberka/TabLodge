import {defineConfig} from 'vite-plus';

// Root Vite+ config for `vp test` and the commit hooks' `vp staged`. Linting and formatting use XO (xo.config.ts).
// The extension package is built by scripts/build.ts from vite.pages.config.ts and the
// script builds defined there.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
	// Run by the pre-commit hook (.vite-hooks/pre-commit). XO only checks here; `vp run lint:fix` fixes.
	staged: {
		'*.{ts,tsx,js,mjs,cjs}': 'xo',
		'package.json': 'xo',
	},
});
