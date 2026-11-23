import {defineConfig} from 'vite-plus';

export default defineConfig({
	test: {
		include: ['apps/*/tests/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node',
	},
	staged: {
		'*.{ts,tsx,js,mjs,cjs}': 'xo',
		'package.json': 'xo',
	},
});
