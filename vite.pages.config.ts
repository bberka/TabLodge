import {basename, resolve} from 'node:path';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite-plus';
import {
	OUT_DIR,
	SOURCE_DIR,
	alias,
	appName,
	copyStatic,
	sharedBuild,
	writeManifest,
} from './scripts/vite-shared.ts';

// Extension pages. The service worker and theme-boot script are separate
// script builds in scripts/build.ts.

// The source HTML shells only carry an empty themed #root; the React entry is injected at build time.
const appEntries: Record<string, string> = {
	'newtab.html': '../src/app/newtab.tsx',
	'popup.html': '../src/app/popup.tsx',
	'options.html': '../src/app/options.tsx',
	'help.html': '../src/app/help.tsx',
	'sidepanel.html': '../src/app/sidepanel.tsx',
	'name-session.html': '../src/app/name-session.tsx',
};

const sourceEntryPlugin: Plugin = {
	name: 'source-entrypoints',
	transformIndexHtml: {
		order: 'pre',
		handler(html, context) {
			const entry = appEntries[basename(context.filename)];
			if (!entry) {
				return html;
			}

			return html
				.replaceAll('%APP_NAME%', () => appName())
				.replace(
					'</body>',
					() => `    <script type="module" src="${entry}"></script>\n  </body>`,
				);
		},
	},
};

export default defineConfig({
	root: SOURCE_DIR,
	base: './',
	publicDir: false,
	plugins: [
		sourceEntryPlugin,
		react(),
		writeManifest(SOURCE_DIR, OUT_DIR),
		copyStatic(SOURCE_DIR, OUT_DIR, ['icons']),
	],
	resolve: {alias},
	build: {
		...sharedBuild,
		outDir: OUT_DIR,
		minify: true,
		rollupOptions: {
			input: Object.fromEntries(
				Object.keys(appEntries).map((page) => [
					basename(page, '.html'),
					resolve(SOURCE_DIR, page),
				]),
			),
		},
	},
});
