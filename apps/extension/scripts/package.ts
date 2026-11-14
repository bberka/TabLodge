// Package each verified, unpacked extension as a versioned ZIP and SHA256 checksum:
// release/<name>-<version>.zip for Chromium and release/<name>-<version>-firefox.zip for Firefox.
// Run `vp run build` first, then `vp run pack` (or `node scripts/package.ts --target firefox`).
import {createHash} from 'node:crypto';
import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises';
import {basename, dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {zipSync} from 'fflate';
import {
	TARGETS,
	outDirFor,
	parseTarget,
	repoRoot,
	type Target,
} from './vite-shared.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(repoRoot, 'release');

type PackageMetadata = {
	name: string;
};

type ManifestMetadata = {
	version: string;
};

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function addFiles(
	packageDir: string,
	directory: string,
	entries: Record<string, Uint8Array>,
) {
	const children = await readdir(directory, {withFileTypes: true});
	children.sort((left, right) => left.name.localeCompare(right.name));

	for (const child of children) {
		const path = resolve(directory, child.name);
		if (child.isDirectory()) {
			await addFiles(packageDir, path, entries);
		} else if (child.isFile()) {
			const archivePath = relative(packageDir, path).split(sep).join('/');
			entries[archivePath] = await readFile(path);
		} else {
			throw new Error(`Cannot package unsupported file type: ${path}`);
		}
	}
}

async function packageTarget(target: Target, metadata: PackageMetadata) {
	const packageDir = outDirFor(target);
	const label = relative(projectRoot, packageDir);
	try {
		metadata = await readJson<PackageMetadata>(
			resolve(repoRoot, 'package.json'),
		);
	} catch {
		throw new Error('Cannot read package.json from the repository root.');
	}

	let manifest: ManifestMetadata;
	try {
		manifest = await readJson<ManifestMetadata>(
			resolve(packageDir, 'manifest.json'),
		);
	} catch {
		throw new Error(
			`No built extension found in ${label}. Run \`vp run build\` first.`,
		);
	}

	const files: Record<string, Uint8Array> = {};
	await addFiles(packageDir, packageDir, files);
	if (Object.keys(files).length === 0) {
		throw new Error(`The built extension package in ${label} is empty.`);
	}

	const archive = zipSync(files, {level: 9});
	const suffix = target === 'chrome' ? '' : `-${target}`;
	const archiveName = `${metadata.name}-${manifest.version}${suffix}.zip`;
	const archivePath = resolve(releaseDir, archiveName);
	await mkdir(releaseDir, {recursive: true});
	await writeFile(archivePath, archive);

	const checksum = createHash('sha256').update(archive).digest('hex');
	await writeFile(
		`${archivePath}.sha256`,
		`${checksum}  ${basename(archivePath)}\n`,
	);

	console.log(
		`Packaged ${Object.keys(files).length} files into release/${archiveName}`,
	);
	console.log(`SHA256: ${checksum}`);
}

async function main() {
	const {values} = parseArgs({options: {target: {type: 'string'}}});
	let metadata: PackageMetadata;
	try {
		metadata = await readJson<PackageMetadata>(
			resolve(repoRoot, 'package.json'),
		);
	} catch {
		throw new Error('Cannot read package.json from the repository root.');
	}

	const targets =
		values.target === undefined || values.target === 'all'
			? TARGETS
			: [parseTarget(values.target)];
	for (const target of targets) {
		await packageTarget(target, metadata);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
