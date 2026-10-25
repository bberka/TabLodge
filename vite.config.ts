import {defineConfig} from 'vite-plus';

// Root Vite+ config for `vp test`. Linting and formatting use XO (xo.config.ts).
// The extension package is built by scripts/build.ts from vite.pages.config.ts and the
// script builds defined there.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
});
