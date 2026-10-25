// Checks that the built package (dist/tablodge by default) is a loadable MV3 extension: every
// manifest-referenced file exists, built HTML only loads local bundles, classic scripts really are
// classic scripts, and the manifest metadata matches package.json.
//
//   node scripts/verify-build.ts [--dir dist/tablodge]
import {readFile, readdir, stat} from 'node:fs/promises';
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Script} from 'node:vm';
import {OUT_DIR, readPackageJson} from './vite-shared.ts';

type Manifest = {
	version?: string;
	homepage_url?: string;
	background?: {service_worker?: string; type?: string};
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
	options: {dir: {type: 'string', default: relative(projectRoot, OUT_DIR)}},
});
const root = resolve(projectRoot, values.dir);
const name = relative(projectRoot, root);
const errors: string[] = [];
const warnings: string[] = [];

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

async function verifyExtension() {
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

	const required = [
		manifest.background?.service_worker,
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
		...(manifest.background?.service_worker &&
		manifest.background.type !== 'module'
			? [manifest.background.service_worker]
			: []),
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

	// Package.json is the source of the repository URL and must agree with the manifest version.
	const pkg = readPackageJson();
	if (manifest.version !== pkg.version) {
		errors.push(
			`${name}: manifest version ${manifest.version} does not match package.json version ${pkg.version}`,
		);
	}

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

await verifyExtension();
for (const warning of warnings) {
	console.warn(`WARNING: ${warning}`);
}

if (errors.length > 0) {
	for (const error of errors) {
		console.error(`ERROR: ${error}`);
	}

	process.exitCode = 1;
} else {
	console.log(
		`Build verification passed for ${name}: no missing package resources, source HTML references, remote scripts/styles, or module syntax in classic scripts.`,
	);
}
