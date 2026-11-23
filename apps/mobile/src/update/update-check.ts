export const COOLDOWN_MS = 60 * 60 * 1000;
export const LATEST_RELEASE_URL =
	'https://api.github.com/repos/bberka/TabLodge/releases/latest';
export const APK_NAME = 'tablodge.apk';

const DOWNLOAD_PREFIX = 'https://github.com/bberka/TabLodge/releases/download/';

export type LatestRelease = {version: string; apkUrl?: string};

export type UpdateCache = {at: number; latest: LatestRelease};

export type UpdateOutcome =
	| {status: 'current'}
	| {status: 'available'; version: string; apkUrl: string}
	| {status: 'failed'};

type Triple = [number, number, number];

function parseVersion(text: string): Triple | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
	return match
		? [Number(match[1]), Number(match[2]), Number(match[3])]
		: undefined;
}

export function isNewer(latest: string, installed: string): boolean {
	const a = parseVersion(latest);
	const b = parseVersion(installed);
	if (!a || !b) {
		return false;
	}

	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) {
			return a[index] > b[index];
		}
	}

	return false;
}

export function parseRelease(json: unknown): LatestRelease | undefined {
	if (typeof json !== 'object' || json === null) {
		return undefined;
	}

	const {tag_name: tag, assets} = json as {
		tag_name?: unknown;
		assets?: unknown;
	};
	if (typeof tag !== 'string' || !parseVersion(tag)) {
		return undefined;
	}

	const version = tag.replace(/^v/, '');
	const apk = Array.isArray(assets)
		? (assets as Array<{name?: unknown; browser_download_url?: unknown}>).find(
				(asset) => asset?.name === APK_NAME,
			)
		: undefined;
	const url = apk?.browser_download_url;
	return typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX)
		? {version, apkUrl: url}
		: {version};
}

export function parseCache(value: unknown): UpdateCache | undefined {
	const {at, latest} = (value ?? {}) as {
		at?: unknown;
		latest?: {version?: unknown; apkUrl?: unknown};
	};
	const version = latest?.version;
	if (
		typeof at !== 'number' ||
		typeof version !== 'string' ||
		!parseVersion(version)
	) {
		return undefined;
	}

	const url = latest?.apkUrl;
	return {
		at,
		latest:
			typeof url === 'string' && url.startsWith(DOWNLOAD_PREFIX)
				? {version, apkUrl: url}
				: {version},
	};
}

function outcomeFor(latest: LatestRelease, installed: string): UpdateOutcome {
	return latest.apkUrl && isNewer(latest.version, installed)
		? {status: 'available', version: latest.version, apkUrl: latest.apkUrl}
		: {status: 'current'};
}

export async function checkForUpdate(options: {
	installed: string;
	now: number;
	cache: UpdateCache | undefined;
	fetchLatest: () => Promise<unknown>;
}): Promise<{outcome: UpdateOutcome; cache?: UpdateCache}> {
	const {installed, now, cache, fetchLatest} = options;
	if (cache && now >= cache.at && now - cache.at < COOLDOWN_MS) {
		return {outcome: outcomeFor(cache.latest, installed)};
	}

	let latest: LatestRelease | undefined;
	try {
		latest = parseRelease(await fetchLatest());
	} catch {
		latest = undefined;
	}

	return latest
		? {outcome: outcomeFor(latest, installed), cache: {at: now, latest}}
		: {outcome: {status: 'failed'}};
}

export function downloadLabel(
	bytesWritten: number,
	totalBytes: number,
): string {
	if (totalBytes > 0) {
		const percent = Math.min(
			100,
			Math.floor((bytesWritten / totalBytes) * 100),
		);
		return `Downloading… ${percent}%`;
	}

	return bytesWritten > 0
		? `Downloading… ${(bytesWritten / 1_000_000).toFixed(1)} MB`
		: 'Downloading…';
}
