// Release versioning (ZeroVer): every release is 0.<minor>.<patch>.
// <minor> comes from the root VERSION file; <patch> is derived from the existing v0.* release tags:
//   - no release for this minor yet → 0.<minor>.0
//   - latest release has the same minor → patch + 1
//   - VERSION lower than the latest released minor → error (versions never go backwards)
//
// CLI (used by .github/workflows/release.yml):
//   node scripts/release-version.ts next        print the next release version
//   node scripts/release-version.ts set 0.2.0   write a version into package.json and extension/manifest.json
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseMinor(text: string): number {
	const value = text.trim();
	if (!/^(?:0|[1-9]\d*)$/.test(value)) {
		throw new Error(
			`VERSION must contain a single whole number (the middle version part), got "${value}".`,
		);
	}

	return Number(value);
}

/**
Parses a ZeroVer release tag such as "v0.1.2" (or "0.1.2"); returns null for anything else.
*/
export function parseReleaseTag(
	tag: string,
): {minor: number; patch: number} | null {
	const match = VERSION_PATTERN.exec(tag.trim().replace(/^v/, ''));
	return match ? {minor: Number(match[1]), patch: Number(match[2])} : null;
}

export function nextVersion(minor: number, tags: readonly string[]): string {
	let latest: {minor: number; patch: number} | null = null;
	for (const tag of tags) {
		const release = parseReleaseTag(tag);
		if (
			release &&
			(!latest ||
				release.minor > latest.minor ||
				(release.minor === latest.minor && release.patch > latest.patch))
		) {
			latest = release;
		}
	}

	if (!latest || latest.minor < minor) {
		return `0.${minor}.0`;
	}

	if (latest.minor === minor) {
		return `0.${minor}.${latest.patch + 1}`;
	}

	throw new Error(
		`VERSION is ${minor}, but release 0.${latest.minor}.${latest.patch} already exists. Set VERSION to ${latest.minor} or higher.`,
	);
}

function setVersion(version: string) {
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`Not a ZeroVer version (0.x.y): "${version}".`);
	}

	for (const file of ['package.json', 'extension/manifest.json']) {
		const path = resolve(projectRoot, file);
		const json = JSON.parse(readFileSync(path, 'utf8')) as {version: string};
		json.version = version;
		writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [command, argument] = process.argv.slice(2);
	if (command === 'next') {
		const minor = parseMinor(
			readFileSync(resolve(projectRoot, 'VERSION'), 'utf8'),
		);
		const tags = execFileSync('git', ['tag', '--list', 'v0.*'], {
			cwd: projectRoot,
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean);
		console.log(nextVersion(minor, tags));
	} else if (command === 'set' && argument) {
		setVersion(argument);
	} else {
		console.error('Usage: node scripts/release-version.ts next | set <0.x.y>');
		process.exitCode = 1;
	}
}
