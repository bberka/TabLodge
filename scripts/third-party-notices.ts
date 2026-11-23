import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {LicenceData} from '../apps/mobile/src/about/licence-data.ts';

export type Notice = {
	name: string;
	version: string;
	licence: string;
	url?: string;
	text: string;
	kind: 'npm' | 'native';
};

const TEXTS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'licence-texts',
);

const STANDARD_TEXTS = ['Apache-2.0', 'MIT', 'BSD-3-Clause'] as const;
type StandardLicence = (typeof STANDARD_TEXTS)[number];

const standardText = (id: StandardLicence) =>
	readFileSync(join(TEXTS_DIR, `${id}.txt`), 'utf8');

const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:[-.].*)?$/i;
const NOTICE_FILE = /^notice(?:\..*)?$/i;

type PackageJson = {
	name?: string;
	version?: string;
	license?: string | {type?: string};
	licenses?: Array<{type?: string}>;
	homepage?: string;
	repository?: string | {url?: string};
};

const readPackageJson = (dir: string): PackageJson | undefined => {
	const path = join(dir, 'package.json');
	return existsSync(path)
		? (JSON.parse(readFileSync(path, 'utf8')) as PackageJson)
		: undefined;
};

export function packageDirOf(file: string): string | undefined {
	if (!file.includes('/node_modules/')) {
		return undefined;
	}

	for (let dir = dirname(file); dir.includes('/node_modules/');) {
		const json = readPackageJson(dir);
		if (json?.name && json.version) {
			return dir;
		}

		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}

		dir = parent;
	}

	throw new Error(`No package.json with a name and version above ${file}`);
}

function licenceOf(json: PackageJson): string | undefined {
	if (typeof json.license === 'string') {
		return json.license;
	}

	return (
		json.license?.type ??
		json.licenses
			?.map((entry) => entry.type)
			.filter(Boolean)
			.join(' OR ')
	);
}

function repositoryUrl(json: PackageJson): string | undefined {
	const raw =
		typeof json.repository === 'string'
			? json.repository
			: json.repository?.url;
	if (!raw) {
		return json.homepage;
	}

	const url = raw.replace(/^git\+/, '').replace(/\.git$/, '');
	return /^[\w-]+\/[\w\-.]+$/.test(url) ? `https://github.com/${url}` : url;
}

const standardFor = (licence: string): StandardLicence | undefined =>
	STANDARD_TEXTS.find((id) => licence === id || licence === `(${id})`);

function withFullApache(licence: string, text: string): string {
	return licence.includes('Apache-2.0') &&
		!text.includes('TERMS AND CONDITIONS')
		? `${text.trimEnd()}\n\n${standardText('Apache-2.0')}`
		: text;
}

export function npmNotice(dir: string): Notice {
	const json = readPackageJson(dir);
	if (!json?.name || !json.version) {
		throw new Error(`${dir} has no package.json with a name and version`);
	}

	const id = `${json.name}@${json.version}`;
	const licence = licenceOf(json);
	if (!licence) {
		throw new Error(`${id} states no licence in its package.json`);
	}

	const files = readdirSync(dir).toSorted();
	const read = (name: string) => readFileSync(join(dir, name), 'utf8').trim();
	const licenceFiles = files.filter((name) => LICENCE_FILE.test(name));
	let text = licenceFiles.map((name) => read(name)).join('\n\n');
	if (!text) {
		const standard = standardFor(licence);
		if (!standard) {
			throw new Error(
				`${id} ships no licence file and ${licence} has no standard text in scripts/licence-texts`,
			);
		}

		text = `${json.name} ships no licence file. This is the standard ${standard} text; the copyright belongs to its authors.\n\n${standardText(standard)}`;
	}

	const notices = files.filter((name) => NOTICE_FILE.test(name));
	text = withFullApache(licence, text);
	if (notices.length > 0) {
		text += `\n\n${notices.map((name) => read(name)).join('\n\n')}`;
	}

	return {
		name: json.name,
		version: json.version,
		licence,
		url: repositoryUrl(json),
		text: `${text.trim()}\n`,
		kind: 'npm',
	};
}

const BARE_CSS_IMPORT = /@import\s+(?:url\()?["']([^"'./][^"']*)["']/g;

export function cssImportDirs(cssFile: string): string[] {
	const css = readFileSync(cssFile, 'utf8');
	return [...css.matchAll(BARE_CSS_IMPORT)].map(([, specifier = '']) => {
		const parts = specifier.split('/');
		const name = specifier.startsWith('@')
			? parts.slice(0, 2).join('/')
			: parts[0];
		for (let dir = dirname(cssFile); ; dir = dirname(dir)) {
			const candidate = join(dir, 'node_modules', name);
			if (existsSync(join(candidate, 'package.json'))) {
				return candidate;
			}

			if (dirname(dir) === dir) {
				throw new Error(`${cssFile} imports ${name}, which is not installed`);
			}
		}
	});
}

export function npmNotices(files: Iterable<string>): Notice[] {
	const dirs = new Set<string>();
	for (const file of files) {
		if (!existsSync(file)) {
			continue;
		}

		const dir = packageDirOf(file);
		if (dir) {
			dirs.add(dir);
		} else if (file.endsWith('.css')) {
			for (const imported of cssImportDirs(file)) {
				dirs.add(imported);
			}
		}
	}

	return sortNotices([...dirs].map((dir) => npmNotice(dir)));
}

export type GradleLibraries = {
	artifacts: Array<{
		group: string;
		name: string;
		version: string;
		url: string;
		licences: Array<{name: string; url: string}>;
	}>;
	projects: string[];
};

export function spdxFromPom(name: string): StandardLicence | undefined {
	if (/apache\b.*\b2\b/i.test(name)) {
		return 'Apache-2.0';
	}

	if (/^(?:the )?mit(?: license)?$/i.test(name.trim())) {
		return 'MIT';
	}

	return /^bsd(?: license)?$/i.test(name.trim()) ? 'BSD-3-Clause' : undefined;
}

export function nativeNotices(libraries: GradleLibraries): Notice[] {
	const notices: Notice[] = [];
	for (const artifact of libraries.artifacts) {
		const id = `${artifact.group}:${artifact.name}:${artifact.version}`;
		if (artifact.licences.length === 0) {
			throw new Error(`${id} declares no licence in its POM`);
		}

		const ids = artifact.licences.map((licence) => {
			const spdx = spdxFromPom(licence.name);
			if (!spdx) {
				throw new Error(
					`${id}: add the POM licence "${licence.name}" (${licence.url}) to spdxFromPom in scripts/third-party-notices.ts`,
				);
			}

			return spdx;
		});
		const unique = [...new Set(ids)];
		notices.push({
			name: `${artifact.group}:${artifact.name}`,
			version: artifact.version,
			licence: unique.join(' OR '),
			url: artifact.url || artifact.licences[0]?.url || undefined,
			text: `${unique
				.map(
					(spdx) =>
						`The standard ${spdx} text. The copyright belongs to the library's authors.\n\n${standardText(spdx)}`,
				)
				.join('\n\n')
				.trim()}\n`,
			kind: 'native',
		});
	}

	for (const projectDir of libraries.projects) {
		const dir = packageDirOf(join(projectDir, 'build.gradle'));
		if (dir) {
			notices.push(npmNotice(dir));
		}
	}

	return sortNotices(notices);
}

const sortNotices = (notices: Notice[]) =>
	notices.toSorted(
		(left, right) =>
			left.name.localeCompare(right.name, 'en') ||
			left.version.localeCompare(right.version, 'en'),
	);

export function mergeNotices(...lists: Notice[][]): Notice[] {
	const byId = new Map<string, Notice>();
	for (const notice of lists.flat()) {
		const id = `${notice.name}@${notice.version}`;
		if (!byId.has(id)) {
			byId.set(id, notice);
		}
	}

	return sortNotices([...byId.values()]);
}

export function noticesText(product: string, notices: Notice[]): string {
	const rule = '='.repeat(78);
	const parts = notices.map((notice) =>
		[
			rule,
			`${notice.name} ${notice.version}`,
			`Licence: ${notice.licence}`,
			...(notice.url ? [notice.url] : []),
			rule,
			'',
			notice.text,
		].join('\n'),
	);
	return `${product} includes the following third party software, each under its own licence.\n\n${parts.join('\n')}`;
}

export function licenceData(notices: Notice[]): LicenceData {
	const texts: string[] = [];
	const indexOf = new Map<string, number>();
	const packages = notices.map((notice) => {
		let text = indexOf.get(notice.text);
		if (text === undefined) {
			text = texts.length;
			texts.push(notice.text);
			indexOf.set(notice.text, text);
		}

		return {
			name: notice.name,
			version: notice.version,
			licence: notice.licence,
			...(notice.url && {url: notice.url}),
			...(notice.kind === 'native' && {native: true as const}),
			text,
		};
	});
	return {packages, texts};
}

export const fromMetroSource = (repoRoot: string, source: string) =>
	existsSync(source) ? source : resolve(repoRoot, `.${source}`);
