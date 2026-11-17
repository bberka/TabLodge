// Third party notices for what a build really ships, shared by the extension build (THIRD_PARTY_NOTICES.txt in each
// package) and the Android app (apps/mobile/scripts/licences.mts, the Open source licences screen).
//
// The input is the build's own module list: the files Vite or Metro put in a bundle, and for Android the libraries
// on Gradle's release classpath. Every package found there needs a licence id and a licence text, or this throws,
// so a build cannot ship a package that has no entry.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {LicenceData} from '../apps/mobile/src/about/licence-data.ts';

export type Notice = {
	name: string;
	version: string;
	/**
	SPDX id or expression, as the package or POM states it.
	*/
	licence: string;
	url?: string;
	text: string;
	/**
	`native` for a library on the Android classpath that is not an npm package.
	*/
	kind: 'npm' | 'native';
};

const TEXTS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	'licence-texts',
);

/**
Licences whose standard text is kept in scripts/licence-texts, for packages that ship no licence file.
*/
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

/**
The folder of the npm package a bundled file belongs to, or undefined for the app's own code (anything outside
node_modules). Nested package.json files that only set `type` or `main` are skipped: the package is the nearest one
with a name and a version.
*/
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

/**
Apache-2.0 asks for a copy of the licence itself. Many packages ship only the short header that points to it, so the
full text is added after the header when it is missing.
*/
function withFullApache(licence: string, text: string): string {
	return licence.includes('Apache-2.0') &&
		!text.includes('TERMS AND CONDITIONS')
		? `${text.trimEnd()}\n\n${standardText('Apache-2.0')}`
		: text;
}

/**
The notice for one npm package folder: its licence file, plus NOTICE when it has one.
*/
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

/**
The folders of the packages a CSS file pulls in with a bare `@import`, such as `@import 'tailwindcss'`. PostCSS
inlines those, so they never show up as modules of the bundle.
*/
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

/**
One notice per npm package among the bundled files, sorted by name. Paths that do not exist (Metro's virtual
modules, Vite's `\0` helpers) are skipped. The app's own files count only for the packages their CSS imports.
*/
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

/**
What apps/mobile/scripts/native-licences.gradle writes.
*/
export type GradleLibraries = {
	artifacts: Array<{
		group: string;
		name: string;
		version: string;
		url: string;
		licences: Array<{name: string; url: string}>;
	}>;
	/**
	Folders of the Gradle projects autolinking added, each the `android` folder of an npm package.
	*/
	projects: string[];
};

/**
Maps the licence names POM files use to SPDX ids. A name not listed here fails the build until someone adds it.
*/
export function spdxFromPom(name: string): StandardLicence | undefined {
	if (/apache\b.*\b2\b/i.test(name)) {
		return 'Apache-2.0';
	}

	if (/^(?:the )?mit(?: license)?$/i.test(name.trim())) {
		return 'MIT';
	}

	return /^bsd(?: license)?$/i.test(name.trim()) ? 'BSD-3-Clause' : undefined;
}

/**
Notices for the libraries on the Android release classpath. Maven artifacts carry the licence their POM names, with
its standard text, since a POM holds no licence text and most AARs ship none. Gradle projects are npm packages with
native code; those outside node_modules are the app's own modules and are skipped.
*/
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
			// The same text for every artifact under a licence, so the app stores it once.
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

/**
Merges notice lists, keeping one entry per name and version.
*/
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

/**
The plain text file the extension ships.
*/
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

/**
The Android app's data: one row per package, with each distinct licence text stored once.
*/
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

/**
Resolves a source path from a Metro source map, which is relative to the repository root with a leading slash.
*/
export const fromMetroSource = (repoRoot: string, source: string) =>
	existsSync(source) ? source : resolve(repoRoot, `.${source}`);
