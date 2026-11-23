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

export function stampVersion(text: string, version: string): string {
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`Not a ZeroVer version (0.x.y): "${version}".`);
	}

	const pattern = /^([\t ]?"version"\s*:\s*")[^"]*(")/m;
	if (!pattern.test(text)) {
		throw new Error('No top-level "version" field found.');
	}

	const stamped = text.replace(
		pattern,
		(_match, before: string, after: string) => before + version + after,
	);
	if ((JSON.parse(stamped) as {version?: unknown}).version !== version) {
		throw new Error('Stamped the wrong "version" field.');
	}

	return stamped;
}

export function androidVersionCode(version: string): number {
	const match = VERSION_PATTERN.exec(version);
	if (!match) {
		throw new Error(`Not a ZeroVer version (0.x.y): "${version}".`);
	}

	const [minor, patch] = [Number(match[1]), Number(match[2])];
	if (minor >= 1000 || patch >= 1000) {
		throw new Error(
			`Version ${version} is too large for an Android version code.`,
		);
	}

	return minor * 1000 + patch;
}

export function stampAndroid(text: string, version: string): string {
	const code = androidVersionCode(version);
	const config = JSON.parse(text) as {
		expo: {version: string; android: {versionCode: number}};
	};
	config.expo.version = version;
	config.expo.android.versionCode = code;
	return `${JSON.stringify(config, undefined, '\t')}\n`;
}

function setVersion(file: string, version: string) {
	const path = resolve(projectRoot, file);
	writeFileSync(path, stampVersion(readFileSync(path, 'utf8'), version));
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
		setVersion('apps/extension/shell/manifest.json', argument);
	} else if (command === 'set-server' && argument) {
		setVersion('apps/server/package.json', argument);
	} else if (command === 'set-android' && argument) {
		const path = resolve(projectRoot, 'apps/mobile/app.json');
		writeFileSync(path, stampAndroid(readFileSync(path, 'utf8'), argument));
	} else {
		console.error(
			'Usage: node scripts/release-version.ts next | set <0.x.y> | set-android <0.x.y> | set-server <0.x.y>',
		);
		process.exitCode = 1;
	}
}
