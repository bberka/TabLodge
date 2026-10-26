// Builds the loadable MV3 package into dist/tablodge (OUT_DIR in scripts/vite-shared.ts).
//
//   node scripts/build.ts            build once
//   node scripts/build.ts --watch    build, then rebuild on source changes
//   pnpm dev                         watch sources and open Chrome with the extension loaded
//
// The package is several Vite+ builds writing into one folder: the HTML pages
// (vite.pages.config.ts, which also writes manifest.json and copies icons) plus self-contained
// scripts referenced by the manifest or HTML (service worker, boot script).
import {rm} from 'node:fs/promises';
import {relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {build, type InlineConfig} from 'vite-plus';
import {openDevBrowser} from './dev-browser.ts';
import {
	OUT_DIR,
	SOURCE_DIR,
	fromRoot,
	projectRoot,
	scriptConfig,
} from './vite-shared.ts';

type BuildStep = {
	label: string;
	config: InlineConfig;
};

const steps: BuildStep[] = [
	{label: 'pages', config: {configFile: fromRoot('vite.pages.config.ts')}},
	// Classic (non-module) service worker; the manifest declares no "type": "module".
	{
		label: 'service-worker.js',
		config: scriptConfig({
			entry: resolve(SOURCE_DIR, 'service-worker.ts'),
			outDir: OUT_DIR,
			fileName: 'service-worker.js',
			format: 'iife',
		}),
	},
	// Loaded synchronously by every page's <head> before first paint, so it must be a classic script.
	{
		label: 'theme-boot.js',
		config: scriptConfig({
			entry: resolve(SOURCE_DIR, 'theme-boot.ts'),
			outDir: OUT_DIR,
			fileName: 'theme-boot.js',
			format: 'iife',
		}),
	},
];

const {values} = parseArgs({
	options: {
		watch: {type: 'boolean', default: false},
		'open-browser': {type: 'boolean', default: false},
	},
});
const {watch, 'open-browser': openBrowser} = values;
const outLabel = relative(projectRoot, OUT_DIR);
const initialBuilds: Array<Promise<void>> = [];

await rm(OUT_DIR, {recursive: true, force: true});

for (const step of steps) {
	const {config} = step;
	const initialBuild = watch ? Promise.withResolvers<void>() : undefined;
	const result = await build({
		...config,
		mode: 'production',
		build: {...config.build, ...(watch && {watch: {}})},
	});
	if (!(watch && 'on' in result)) {
		continue;
	}

	if (initialBuild) {
		initialBuilds.push(initialBuild.promise);
	}

	result.on('event', (event) => {
		if (event.code === 'BUNDLE_END') {
			initialBuild?.resolve();
			console.log(
				`[${new Date().toLocaleTimeString()}] rebuilt ${step.label} in ${event.duration}ms`,
			);
		}

		if (event.code === 'ERROR') {
			console.error(
				`[${new Date().toLocaleTimeString()}] ${step.label} failed: ${event.error.message}`,
			);
		}

		if ('result' in event && event.result) {
			void event.result.close();
		}
	});
}

console.log(
	watch
		? `Watching sources; rebuilt files land in ${outLabel}/. Reload the extension in the browser after a rebuild. Press Ctrl+C to stop.`
		: `Built the loadable MV3 extension in ${outLabel}/.`,
);

if (openBrowser) {
	await Promise.all(initialBuilds);
	await openDevBrowser();
}
