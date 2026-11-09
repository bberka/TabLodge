// Shared pieces of the extension build configs (vite.*.config.ts and scripts/build.ts).
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {InlineConfig, Plugin} from 'vite-plus';
import {manifestForTarget} from './manifest-targets.ts';

export const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'..',
);
export const fromRoot = (...segments: string[]) =>
	resolve(projectRoot, ...segments);

/**
Extension source: manifest, icons, HTML shells, and the scripts the manifest loads directly.
*/
export const SOURCE_DIR = fromRoot('extension');
export const TARGETS = ['chrome', 'firefox'] as const;
export type Target = (typeof TARGETS)[number];

export function parseTarget(value: string | undefined): Target {
	if (value === undefined || value === '') {
		return 'chrome';
	}

	const target = TARGETS.find((entry) => entry === value);
	if (!target) {
		throw new Error(
			`Unknown target "${value}". Use one of: ${TARGETS.join(', ')}.`,
		);
	}

	return target;
}

/**
The target the current build step builds. scripts/build.ts sets it per target before it starts Vite,
and the Vite config files read it, since they are loaded fresh for every build.
*/
export const targetFromEnv = () => parseTarget(process.env.TABLODGE_TARGET);

/**
The loadable unpacked extension of a target (it holds the built manifest.json). Chromium keeps the
original folder name so existing dev and test tooling is unaffected.
*/
export const outDirFor = (target: Target) =>
	fromRoot('dist', target === 'chrome' ? 'tablodge' : 'tablodge-firefox');
/**
The Chromium package folder, which the Playwright-based dev and check scripts load.
*/
export const OUT_DIR = outDirFor('chrome');

type PackageJson = {
	version: string;
	homepage?: string;
};
type SourceManifest = {
	name: string;
	short_name?: string;
	version: string;
};
const readJson = <T>(file: string) =>
	JSON.parse(readFileSync(file, 'utf8')) as T;
export const readPackageJson = () =>
	readJson<PackageJson>(fromRoot('package.json'));
const readSourceManifest = () =>
	readJson<SourceManifest>(resolve(SOURCE_DIR, 'manifest.json'));
/**
The display name: the manifest's short_name. HTML shells use `%APP_NAME%`; pages read it at runtime.
*/
export const appName = () => {
	const manifest = readSourceManifest();
	return manifest.short_name ?? manifest.name;
};

/**
Matches `minimum_chrome_version` in the Chromium manifest and `strict_min_version` in the Firefox one
(scripts/manifest-targets.ts).
*/
const BUILD_TARGETS = {chrome: 'chrome116', firefox: 'firefox140'} as const;

export const alias = {'@': fromRoot('src')};

/**
 Build options shared by every bundle. Several builds write into the same extension folder,
 so Vite never empties it; scripts/build.ts clears the package folder once before building.
 CSS is minified with esbuild because lightningcss (the Vite 8 default) rewrites the
 `color-scheme` theme rules.
 */
export const sharedBuild = (target: Target) =>
	({
		target: BUILD_TARGETS[target],
		sourcemap: false,
		emptyOutDir: false,
		cssMinify: 'esbuild',
		modulePreload: {polyfill: false},
	}) satisfies InlineConfig['build'];

async function listFiles(path: string): Promise<string[]> {
	const entries = await readdir(path, {withFileTypes: true}).catch(() => null);
	if (!entries) {
		return [path];
	}

	const nested = await Promise.all(
		entries.map((entry) => listFiles(resolve(path, entry.name))),
	);
	return nested.flat();
}

/**
 Copies static package files (icons) next to the bundle after each write and adds
 them to the watch list, so `vp run dev:chrome` picks up icon edits too.
 */
export function copyStatic(
	sourceDir: string,
	outDir: string,
	names: string[],
): Plugin {
	return {
		name: 'copy-static',
		apply: 'build',
		async buildStart() {
			for (const name of names) {
				for (const file of await listFiles(resolve(sourceDir, name))) {
					this.addWatchFile(file);
				}
			}
		},
		async writeBundle() {
			for (const name of names) {
				const destination = resolve(outDir, name);
				await mkdir(dirname(destination), {recursive: true});
				await cp(resolve(sourceDir, name), destination, {
					recursive: true,
					force: true,
				});
			}
		},
	};
}

/**
 Writes manifest.json into the package with `homepage_url` taken from package.json "homepage",
 so the repository URL has one source of truth, adapted to the target browser
 (scripts/manifest-targets.ts). Watched, so `vp run dev:chrome` picks up edits too.
 */
export function writeManifest(
	sourceDir: string,
	outDir: string,
	target: Target,
): Plugin {
	const source = resolve(sourceDir, 'manifest.json');
	return {
		name: 'write-manifest',
		apply: 'build',
		buildStart() {
			this.addWatchFile(source);
			this.addWatchFile(fromRoot('package.json'));
		},
		async writeBundle() {
			const {homepage} = readPackageJson();
			if (!homepage) {
				throw new Error(
					'package.json needs a "homepage" URL for the manifest homepage_url.',
				);
			}

			const manifest = JSON.parse(await readFile(source, 'utf8')) as Record<
				string,
				unknown
			>;
			await mkdir(outDir, {recursive: true});
			await writeFile(
				resolve(outDir, 'manifest.json'),
				`${JSON.stringify(manifestForTarget({...manifest, homepage_url: homepage}, target), null, 2)}\n`,
			);
		},
	};
}

type ScriptBuildOptions = {
	/**
	Source entry file.
	*/
	entry: string;
	/**
	Output directory (the extension package root).
	*/
	outDir: string;
	/**
	Output file name, as referenced by the manifest or HTML.
	*/
	fileName: string;
	target: Target;
};

/**
 A self-contained classic script bundle (service worker, boot script). Dependencies are
 inlined into a single file and `process.env.NODE_ENV` is replaced, since library mode does not
 do that and extension scripts have no `process` global.
 */
export function scriptConfig({
	entry,
	outDir,
	fileName,
	target,
}: ScriptBuildOptions): InlineConfig {
	return {
		configFile: false,
		root: projectRoot,
		base: './',
		publicDir: false,
		logLevel: 'warn',
		resolve: {alias},
		define: {'process.env.NODE_ENV': JSON.stringify('production')},
		build: {
			...sharedBuild(target),
			outDir,
			minify: false,
			lib: {
				entry,
				formats: ['iife'],
				name: 'ExtensionScript',
				fileName: () => fileName,
			},
		},
	};
}
