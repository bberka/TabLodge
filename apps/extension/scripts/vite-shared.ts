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
export const repoRoot = resolve(projectRoot, '..', '..');
export const fromRoot = (...segments: string[]) =>
	resolve(projectRoot, ...segments);

export const SOURCE_DIR = fromRoot('shell');
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

export const targetFromEnv = () => parseTarget(process.env.TABLODGE_TARGET);

export const outDirFor = (target: Target) =>
	fromRoot('dist', target === 'chrome' ? 'tablodge' : 'tablodge-firefox');
export const OUT_DIR = outDirFor('chrome');

type PackageJson = {
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
	readJson<PackageJson>(resolve(repoRoot, 'package.json'));
const readSourceManifest = () =>
	readJson<SourceManifest>(resolve(SOURCE_DIR, 'manifest.json'));
export const appName = () => {
	const manifest = readSourceManifest();
	return manifest.short_name ?? manifest.name;
};

const BUILD_TARGETS = {chrome: 'chrome116', firefox: 'firefox140'} as const;

export const alias = {'@': fromRoot('src')};

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
			this.addWatchFile(resolve(repoRoot, 'package.json'));
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
	entry: string;
	outDir: string;
	fileName: string;
	target: Target;
	banner?: string;
};

export function scriptConfig({
	entry,
	outDir,
	fileName,
	target,
	banner,
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
			minify: true,
			lib: {
				entry,
				formats: ['iife'],
				name: 'ExtensionScript',
				fileName: () => fileName,
			},
			...(banner && {rollupOptions: {output: {postBanner: banner}}}),
		},
	};
}
