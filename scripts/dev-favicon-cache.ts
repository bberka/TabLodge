import {Buffer} from 'node:buffer';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import type {Page} from 'playwright';

const cacheDir = join(homedir(), '.cache', 'tablodge');
const cachePath = join(cacheDir, 'dev-favicons.json');
const maxIconBytes = 256 * 1024;
const isImageData = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^data:image\/[+\-.0-9a-z]+;base64,/i.test(value);

type FaviconCache = {icons: Record<string, string>; checkedOrigins: string[]};

async function readCache(): Promise<FaviconCache> {
	try {
		const data: unknown = JSON.parse(await readFile(cachePath, 'utf8'));
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			return {icons: {}, checkedOrigins: []};
		}

		const record = data as Record<string, unknown>;
		const rawIcons =
			typeof record.icons === 'object' && record.icons !== null
				? (record.icons as Record<string, unknown>)
				: record;
		const icons = Object.fromEntries(
			Object.entries(rawIcons).filter((entry): entry is [string, string] =>
				isImageData(entry[1]),
			),
		);
		const checkedOrigins = Array.isArray(record.checkedOrigins)
			? record.checkedOrigins.filter(
					(origin): origin is string => typeof origin === 'string',
				)
			: Object.keys(icons);
		return {icons, checkedOrigins};
	} catch {
		return {icons: {}, checkedOrigins: []};
	}
}

async function fetchIcon(
	page: Page,
	origin: string,
): Promise<string | undefined> {
	try {
		await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 10_000});
		const iconHref = await page
			.locator('link[rel~="icon"]')
			.first()
			.getAttribute('href');
		const iconUrl = new URL(iconHref || '/favicon.ico', origin);
		const response = await fetch(iconUrl, {signal: AbortSignal.timeout(8000)});
		const contentType = response.headers.get('content-type')?.split(';', 1)[0];
		if (!response.ok || !contentType?.startsWith('image/')) {
			return undefined;
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
		return bytes.length === 0 || bytes.length > maxIconBytes
			? undefined
			: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
	} catch {
		return undefined;
	}
}

async function writeCache(cache: FaviconCache): Promise<void> {
	await mkdir(cacheDir, {recursive: true});
	const temporaryPath = `${cachePath}.${process.pid}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`);
	await rename(temporaryPath, cachePath);
}

/**
Downloads missing fixture icons once to a machine wide cache shared by all worktrees.
*/
export async function loadDevFavicons(
	page: Page,
	urls: string[],
): Promise<Record<string, string>> {
	const cache = await readCache();
	const {icons} = cache;
	const origins = [...new Set(urls.map((url) => new URL(url).origin))];
	let added = 0;
	for (const origin of origins) {
		if (cache.checkedOrigins.includes(origin)) {
			continue;
		}

		const icon = await fetchIcon(page, origin);
		cache.checkedOrigins.push(origin);
		if (!icon) {
			continue;
		}

		icons[origin] = icon;
		added += 1;
	}

	if (cache.checkedOrigins.length > 0) {
		await writeCache(cache);
	}

	console.log(
		`Loaded ${origins.filter((origin) => icons[origin] !== undefined).length} of ${origins.length} sample favicons; fetched ${added} new icons.`,
	);
	return icons;
}
