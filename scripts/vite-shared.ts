// Shared pieces of the extension build configs (vite.*.config.ts and scripts/build.ts).
import {readFileSync} from 'node:fs';
import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {InlineConfig, Plugin, PluginOption} from 'vite-plus';

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
/**
The loadable unpacked extension (it holds the built manifest.json).
*/
export const OUT_DIR = fromRoot('dist/tablodge');

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
export const readSourceManifest = () =>
	readJson<SourceManifest>(resolve(SOURCE_DIR, 'manifest.json'));
/**
The display name: the manifest's short_name. HTML shells use `%APP_NAME%`; pages read it at runtime.
*/
export const appName = () => {
	const manifest = readSourceManifest();
	return manifest.short_name ?? manifest.name;
};

/**
Matches `minimum_chrome_version` in the manifest.
*/
export const BUILD_TARGET = 'chrome116';

export const alias = {'@': fromRoot('src')};

/**
 Build options shared by every bundle. Several builds write into the same extension folder,
 so Vite never empties it; scripts/build.ts clears the package folder once before building.
 CSS is minified with esbuild because lightningcss (the Vite 8 default) rewrites the
 `color-scheme` theme rules.
 */
export const sharedBuild = {
	target: BUILD_TARGET,
	sourcemap: false,
	emptyOutDir: false,
	cssMinify: 'esbuild',
	modulePreload: {polyfill: false},
} satisfies InlineConfig['build'];

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
 them to the watch list, so `vp run dev` picks up icon edits too.
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
 so the repository URL has one source of truth. Watched, so `vp run dev` picks up edits too.
 */
export function writeManifest(sourceDir: string, outDir: string): Plugin {
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
				`${JSON.stringify({...manifest, homepage_url: homepage}, null, 2)}\n`,
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
	/**
	`iife` for classic scripts (content scripts, non-module workers), `es` for module service workers.
	*/
	format: 'iife' | 'es';
	minify?: boolean;
	plugins?: PluginOption[];
};

/**
 A self-contained script bundle (service worker, content script, boot script). Dependencies are
 inlined into a single file and `process.env.NODE_ENV` is replaced, since library mode does not
 do that and extension scripts have no `process` global.
 */
export function scriptConfig({
	entry,
	outDir,
	fileName,
	format,
	minify = false,
	plugins = [],
}: ScriptBuildOptions): InlineConfig {
	return {
		configFile: false,
		root: projectRoot,
		base: './',
		publicDir: false,
		logLevel: 'warn',
		plugins,
		resolve: {alias},
		define: {'process.env.NODE_ENV': JSON.stringify('production')},
		build: {
			...sharedBuild,
			outDir,
			minify,
			lib: {
				entry,
				formats: [format],
				name: 'ExtensionScript',
				fileName: () => fileName,
			},
		},
	};
}
