import {basename, resolve} from 'node:path';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite-plus';
import {
	SOURCE_DIR,
	alias,
	appName,
	copyStatic,
	outDirFor,
	sharedBuild,
	targetFromEnv,
	writeManifest,
} from './scripts/vite-shared.ts';

const appEntries: Record<string, string> = {
	'newtab.html': '../src/app/newtab.tsx',
	'popup.html': '../src/app/popup.tsx',
	'options.html': '../src/app/options.tsx',
	'help.html': '../src/app/help.tsx',
	'sidepanel.html': '../src/app/sidepanel.tsx',
	'name-session.html': '../src/app/name-session.tsx',
	'add-bookmark.html': '../src/app/add-bookmark.tsx',
	'palette.html': '../src/app/palette.tsx',
	'reader.html': '../src/app/reader.tsx',
	'image.html': '../src/app/image-viewer.tsx',
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

const target = targetFromEnv();
const outDir = outDirFor(target);

export default defineConfig({
	root: SOURCE_DIR,
	base: './',
	publicDir: false,
	plugins: [
		sourceEntryPlugin,
		react(),
		writeManifest(SOURCE_DIR, outDir, target),
		copyStatic(SOURCE_DIR, outDir, ['icons']),
	],
	resolve: {alias},
	build: {
		...sharedBuild(target),
		outDir,
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
