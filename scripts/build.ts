// Builds the loadable MV3 packages: dist/tablodge for Chromium and dist/tablodge-firefox for Firefox
// (outDirFor in scripts/vite-shared.ts).
//
//   node scripts/build.ts                     build every target once
//   node scripts/build.ts --target firefox    build one target (chrome or firefox)
//   node scripts/build.ts --watch             build Chromium, then rebuild on source changes
//   vp run dev:chrome                         watch sources and open Chrome with the extension loaded
//   vp run dev:firefox                        watch sources and open Firefox with the add-on loaded
//
// The package is several Vite+ builds writing into one folder: the HTML pages
// (vite.pages.config.ts, which also writes manifest.json and copies icons) plus self-contained
// scripts referenced by the manifest or HTML (service worker, boot script).
import {rm} from 'node:fs/promises';
import {relative, resolve} from 'node:path';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {build, type InlineConfig} from 'vite-plus';
import {openDevBrowser} from './dev-browser.ts';
import {openDevFirefox} from './dev-firefox.ts';
import {
	SOURCE_DIR,
	TARGETS,
	fromRoot,
	outDirFor,
	parseTarget,
	projectRoot,
	scriptConfig,
	type Target,
} from './vite-shared.ts';

type BuildStep = {
	label: string;
	config: InlineConfig;
};

function stepsFor(target: Target): BuildStep[] {
	const outDir = outDirFor(target);
	return [
		{label: 'pages', config: {configFile: fromRoot('vite.pages.config.ts')}},
		// Classic (non-module) background script: a service worker for Chromium, an event page for Firefox.
		{
			label: 'service-worker.js',
			config: scriptConfig({
				entry: resolve(SOURCE_DIR, 'service-worker.ts'),
				outDir,
				fileName: 'service-worker.js',
				target,
			}),
		},
		// Loaded synchronously by every page's <head> before first paint, so it must be a classic script.
		{
			label: 'theme-boot.js',
			config: scriptConfig({
				entry: resolve(SOURCE_DIR, 'theme-boot.ts'),
				outDir,
				fileName: 'theme-boot.js',
				target,
			}),
		},
		// Starts the new-tab state read while the React page bundle is loading.
		{
			label: 'newtab-preload.js',
			config: scriptConfig({
				entry: resolve(SOURCE_DIR, 'newtab-preload.ts'),
				outDir,
				fileName: 'newtab-preload.js',
				target,
			}),
		},
		// Starts the add-bookmark window's read while the React page bundle is loading.
		{
			label: 'add-bookmark-preload.js',
			config: scriptConfig({
				entry: resolve(SOURCE_DIR, 'add-bookmark-preload.ts'),
				outDir,
				fileName: 'add-bookmark-preload.js',
				target,
			}),
		},
	];
}

const {values} = parseArgs({
	options: {
		target: {type: 'string'},
		watch: {type: 'boolean', default: false},
		'open-browser': {type: 'boolean', default: false},
		'seed-data': {type: 'boolean', default: false},
		headless: {type: 'boolean', default: false},
	},
});
const {
	watch,
	'open-browser': openBrowser,
	'seed-data': seedData,
	headless,
} = values;
// Watching and the dev browser serve one package, so they take a single target (Chromium by default).
const targets: readonly Target[] =
	values.target === 'all' || (values.target === undefined && !watch)
		? TARGETS
		: [parseTarget(values.target)];
if (watch && targets.length > 1) {
	throw new Error(
		'--watch builds one target. Pass --target chrome or firefox.',
	);
}

const initialBuilds: Array<Promise<void>> = [];
const watchers: Array<{close(): Promise<void>}> = [];

for (const target of targets) {
	const outDir = outDirFor(target);
	await rm(outDir, {recursive: true, force: true});
	// Vite.pages.config.ts is loaded by Vite for each build and reads the target from here.
	process.env.TABLODGE_TARGET = target;

	for (const step of stepsFor(target)) {
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

		watchers.push(result);

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
			? `Watching sources; rebuilt files land in ${relative(projectRoot, outDir)}/. Reload the extension in the browser after a rebuild. Press Ctrl+C to stop.`
			: `Built the loadable ${target} extension in ${relative(projectRoot, outDir)}/.`,
	);
}

if (openBrowser) {
	await Promise.all(initialBuilds);
	await (targets[0] === 'firefox' ? openDevFirefox : openDevBrowser)(
		{seedData, headless},
		watchers,
	);
}
