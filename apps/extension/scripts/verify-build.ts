// Checks that each built package (dist/tablodge for Chromium, dist/tablodge-firefox for Firefox) is a
// loadable MV3 extension: every manifest-referenced file exists, built HTML only loads local bundles,
// classic scripts really are classic scripts, the manifest metadata matches package.json, and each
// manifest holds only what its browser understands.
//
//   node scripts/verify-build.ts                      verify every target
//   node scripts/verify-build.ts --target firefox     verify one target
//   node scripts/verify-build.ts --dir path           verify the Chromium package at another path
import {readFile, readdir, stat} from 'node:fs/promises';
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Script} from 'node:vm';
import {CHROMIUM_ONLY_PERMISSIONS} from './manifest-targets.ts';
import {
	TARGETS,
	outDirFor,
	parseTarget,
	readPackageJson,
	type Target,
} from './vite-shared.ts';

type Manifest = {
	version?: string;
	homepage_url?: string;
	incognito?: string;
	minimum_chrome_version?: string;
	permissions?: string[];
	background?: {service_worker?: string; scripts?: string[]; type?: string};
	sidebar_action?: {default_panel?: string};
	browser_specific_settings?: {
		gecko?: {
			id?: string;
			strict_min_version?: string;
			data_collection_permissions?: {required?: string[]};
		};
	};
	action?: {
		default_popup?: string;
		default_icon?: string | Record<string, string>;
	};
	options_page?: string;
	options_ui?: {page?: string};
	side_panel?: {default_path?: string};
	chrome_url_overrides?: {newtab?: string};
	icons?: Record<string, string>;
	content_scripts?: Array<{js?: string[]; css?: string[]}>;
	web_accessible_resources?: Array<{resources?: string[]}>;
	declarative_net_request?: {rule_resources?: Array<{path?: string}>};
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const {values} = parseArgs({
	options: {dir: {type: 'string'}, target: {type: 'string'}},
});
const errors: string[] = [];

const messageOf = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

async function isFile(file: string) {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}

function isInside(packageRoot: string, file: string) {
	const path = relative(packageRoot, file);
	return (
		path === '' ||
		(path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

function packagePath(
	packageRoot: string,
	base: string,
	resource: string,
	label: string,
) {
	const file = resolve(base, resource.split(/[#?]/, 1)[0]);
	if (!isInside(packageRoot, file)) {
		errors.push(`${label}: resource escapes extension package: ${resource}`);
		return null;
	}

	return file;
}

function objectPaths(
	value: string | Record<string, string> | undefined,
): string[] {
	if (typeof value === 'string') {
		return [value];
	}

	return !value || typeof value !== 'object'
		? []
		: Object.values(value).filter((entry) => typeof entry === 'string');
}

async function walk(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const file = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(file)));
		} else if (entry.isFile()) {
			files.push(file);
		}
	}

	return files;
}

// Content scripts, non-module workers, and plain <script> tags run as classic scripts: an
// import/export statement is a syntax error there, and there is no `process` global.
async function verifyClassicScript(file: string, label: string) {
	const code = await readFile(file, 'utf8');
	try {
		new Script(code, {filename: file});
	} catch (error) {
		errors.push(
			`${label}: ${relative(projectRoot, file)} is not a valid classic script (${messageOf(error)})`,
		);
	}

	if (/\bprocess\.env\b/.test(code)) {
		errors.push(
			`${label}: ${relative(projectRoot, file)} still references process.env`,
		);
	}
}

/**
Checks that a manifest holds what its target browser needs and nothing the other browser's package carries.
*/
function verifyTargetManifest(
	manifest: Manifest,
	target: Target,
	name: string,
) {
	if (target === 'chrome') {
		if (!manifest.background?.service_worker) {
			errors.push(
				`${name}: the Chromium manifest needs background.service_worker`,
			);
		}

		if (manifest.background?.scripts) {
			errors.push(
				`${name}: background.scripts belongs to the Firefox manifest`,
			);
		}

		if (manifest.browser_specific_settings || manifest.sidebar_action) {
			errors.push(
				`${name}: browser_specific_settings and sidebar_action belong to the Firefox manifest`,
			);
		}

		return;
	}

	const scripts = manifest.background?.scripts;
	if (!scripts || scripts.length === 0) {
		errors.push(`${name}: the Firefox manifest needs background.scripts`);
	}

	if (manifest.background?.service_worker) {
		errors.push(
			`${name}: Firefox has no extension service workers; remove background.service_worker`,
		);
	}

	const permissions = manifest.permissions ?? [];
	for (const permission of CHROMIUM_ONLY_PERMISSIONS) {
		if (permissions.includes(permission)) {
			errors.push(
				`${name}: Firefox does not know the "${permission}" permission`,
			);
		}
	}

	if (manifest.side_panel || manifest.minimum_chrome_version) {
		errors.push(
			`${name}: side_panel and minimum_chrome_version belong to the Chromium manifest`,
		);
	}

	// The dashboard shares one storage area, so the add-on stays out of private windows (Firefox has no "split").
	if (manifest.incognito !== 'not_allowed') {
		errors.push(
			`${name}: the Firefox manifest must set incognito to not_allowed`,
		);
	}

	const gecko = manifest.browser_specific_settings?.gecko;
	if (!gecko?.id || !gecko.strict_min_version) {
		errors.push(
			`${name}: the Firefox manifest needs browser_specific_settings.gecko id and strict_min_version`,
		);
	}

	if (gecko?.data_collection_permissions?.required?.join(',') !== 'none') {
		errors.push(
			`${name}: gecko.data_collection_permissions.required must be ["none"]`,
		);
	}
}

async function verifyExtension(root: string, target: Target) {
	const name = relative(projectRoot, root);
	const manifestPath = resolve(root, 'manifest.json');
	if (!(await isFile(manifestPath))) {
		errors.push(`${name}: missing manifest.json in ${root}`);
		return;
	}

	let manifest: Manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
	} catch (error) {
		errors.push(`${name}: invalid manifest.json (${messageOf(error)})`);
		return;
	}

	verifyTargetManifest(manifest, target, name);

	const required = [
		manifest.background?.service_worker,
		...(manifest.background?.scripts ?? []),
		manifest.sidebar_action?.default_panel,
		manifest.action?.default_popup,
		...objectPaths(manifest.action?.default_icon),
		manifest.options_page,
		manifest.options_ui?.page,
		manifest.side_panel?.default_path,
		manifest.chrome_url_overrides?.newtab,
		...objectPaths(manifest.icons),
		...(manifest.content_scripts || []).flatMap((entry) => [
			...(entry.js || []),
			...(entry.css || []),
		]),
		...(manifest.web_accessible_resources || []).flatMap(
			(entry) => entry.resources || [],
		),
		...(manifest.declarative_net_request?.rule_resources || []).map(
			(entry) => entry.path,
		),
	].filter((entry): entry is string => Boolean(entry));

	for (const resource of required) {
		const file = packagePath(root, root, resource, `${name}: manifest`);
		if (file && !(await isFile(file))) {
			errors.push(`${name}: manifest references missing file ${resource}`);
		}
	}

	const classicScripts = [
		...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
		...(manifest.background?.type === 'module'
			? []
			: [
					...(manifest.background?.service_worker
						? [manifest.background.service_worker]
						: []),
					...(manifest.background?.scripts ?? []),
				]),
	];
	for (const resource of classicScripts) {
		const file = packagePath(root, root, resource, `${name}: manifest`);
		if (file && (await isFile(file))) {
			await verifyClassicScript(file, `${name}: manifest`);
		}
	}

	const newTabPath = manifest.chrome_url_overrides?.newtab;
	if (newTabPath !== 'newtab.html') {
		errors.push(
			`${name}: manifest.chrome_url_overrides.newtab must point to newtab.html`,
		);
	}

	if (!(await isFile(resolve(root, 'newtab.html')))) {
		errors.push(`${name}: missing newtab.html in the loadable package`);
	}

	// Package.json is the source of the repository URL.
	const pkg = readPackageJson();

	if (!manifest.homepage_url || manifest.homepage_url !== pkg.homepage) {
		errors.push(
			`${name}: manifest homepage_url must equal package.json "homepage"`,
		);
	}

	let files: string[];
	try {
		files = await walk(root);
	} catch (error) {
		errors.push(`${name}: cannot read package files (${messageOf(error)})`);
		return;
	}

	const sourceFiles = files.filter((entry) =>
		/\.(?:ts|tsx|jsx|mjs)$/.test(entry),
	);
	for (const file of sourceFiles) {
		errors.push(
			`${relative(projectRoot, file)}: source file copied into the package`,
		);
	}

	const htmlFiles = files.filter((entry) => entry.endsWith('.html'));
	for (const file of htmlFiles) {
		const label = relative(projectRoot, file);
		const html = await readFile(file, 'utf8');
		if (/\/src\/|\.(?:jsx|tsx?)(?:[\s"#'?`]|$)/i.test(html)) {
			errors.push(
				`${label}: built HTML must not reference source paths or TS/JSX files`,
			);
		}

		for (const match of html.matchAll(
			/<(script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi,
		)) {
			const [tag, element, resource] = match;
			if (/^(?:https?:|\/\/|data:)/i.test(resource)) {
				errors.push(`${label}: non-local resource ${resource}`);
				continue;
			}

			const resolved = packagePath(root, dirname(file), resource, label);
			if (resolved && !(await isFile(resolved))) {
				errors.push(`${label}: missing local resource ${resource}`);
			} else if (
				resolved &&
				element.toLowerCase() === 'script' &&
				!/\btype=["']module["']/i.test(tag)
			) {
				await verifyClassicScript(resolved, label);
			}
		}

		if (html.includes('%APP_NAME%')) {
			errors.push(`${label}: unreplaced %APP_NAME% placeholder`);
		}

		if (/<script\b(?![^>]*\bsrc=)/i.test(html)) {
			errors.push(
				`${label}: inline script is not allowed in the extension page build`,
			);
		}

		// Every page applies the saved theme before first paint with a classic script in <head>.
		const head = html.split(/<\/head>/i, 1)[0];
		const bootTag =
			/<script\b[^>]*\bsrc=["']\.\/theme-boot\.js["'][^>]*>/i.exec(head)?.[0];
		if (!bootTag) {
			errors.push(
				`${label}: page must load ./theme-boot.js in <head> before first paint`,
			);
		} else if (/\b(?:type=["']module["']|async|defer)\b/i.test(bootTag)) {
			errors.push(`${label}: theme-boot.js must be a blocking classic script`);
		} else {
			const moduleScript = head.search(/<script\b[^>]*\btype=["']module["']/i);
			if (moduleScript !== -1 && head.indexOf(bootTag) > moduleScript) {
				errors.push(
					`${label}: theme-boot.js must load before the page's module script`,
				);
			}
		}

		if (basename(file) !== 'newtab.html') {
			continue;
		}

		if (!/<script\b[^>]*\bsrc=["'][^"']+\.js(?:[#?][^"']*)?["']/i.test(html)) {
			errors.push(`${label}: new-tab page has no bundled JavaScript entry`);
		}

		const stylesheetLink = [...html.matchAll(/<link\b[^>]*>/gi)].some(
			([tag]) =>
				/\brel=["']stylesheet["']/i.test(tag) &&
				/\bhref=["'][^"']+\.css(?:[#?][^"']*)?["']/i.test(tag),
		);
		if (!stylesheetLink) {
			errors.push(`${label}: new-tab page has no bundled stylesheet`);
		}
	}

	console.log(
		`${name}: checked ${files.length} packaged files, manifest entries, and local HTML bundles in ${root}.`,
	);
}

const targets: readonly Target[] = values.dir
	? ['chrome']
	: values.target === undefined || values.target === 'all'
		? TARGETS
		: [parseTarget(values.target)];
for (const target of targets) {
	await verifyExtension(
		values.dir ? resolve(projectRoot, values.dir) : outDirFor(target),
		target,
	);
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(`ERROR: ${error}`);
	}

	process.exitCode = 1;
} else {
	console.log(
		`Build verification passed for ${targets.join(' and ')}: no missing package resources, source HTML references, remote scripts/styles, or module syntax in classic scripts.`,
	);
}
