// Package the verified, unpacked extension as a versioned ZIP and SHA256 checksum.
// Run `vp run build` first, then `vp run pack`.
import {createHash} from 'node:crypto';
import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises';
import {basename, dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';
import {zipSync} from 'fflate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = resolve(projectRoot, 'dist/tablodge');
const releaseDir = resolve(projectRoot, 'release');

type PackageMetadata = {
	name: string;
	version: string;
};

type ManifestMetadata = {
	version: string;
};

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function addFiles(
	directory: string,
	entries: Record<string, Uint8Array>,
) {
	const children = await readdir(directory, {withFileTypes: true});
	children.sort((left, right) => left.name.localeCompare(right.name));

	for (const child of children) {
		const path = resolve(directory, child.name);
		if (child.isDirectory()) {
			await addFiles(path, entries);
		} else if (child.isFile()) {
			const archivePath = relative(packageDir, path).split(sep).join('/');
			entries[archivePath] = await readFile(path);
		} else {
			throw new Error(`Cannot package unsupported file type: ${path}`);
		}
	}
}

async function main() {
	let metadata: PackageMetadata;
	try {
		metadata = await readJson<PackageMetadata>(
			resolve(projectRoot, 'package.json'),
		);
	} catch {
		throw new Error('Cannot read package.json from the project root.');
	}

	let manifest: ManifestMetadata;
	try {
		manifest = await readJson<ManifestMetadata>(
			resolve(packageDir, 'manifest.json'),
		);
	} catch {
		throw new Error('No built extension found. Run `vp run build` first.');
	}

	if (manifest.version !== metadata.version) {
		throw new Error(
			`Built extension version ${manifest.version} does not match package version ${metadata.version}. Rebuild before packaging.`,
		);
	}

	const files: Record<string, Uint8Array> = {};
	await addFiles(packageDir, files);
	if (Object.keys(files).length === 0) {
		throw new Error('The built extension package is empty.');
	}

	const archive = zipSync(files, {level: 9});
	const archiveName = `${metadata.name}-${metadata.version}.zip`;
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

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
