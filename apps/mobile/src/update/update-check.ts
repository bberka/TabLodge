/*
Whether a newer release is out. This file holds no storage, no network, and no React Native, so every rule here runs
under Node. `app-update.ts` supplies the clock, the saved answer, and the request.
*/

export const COOLDOWN_MS = 60 * 60 * 1000;
export const LATEST_RELEASE_URL =
	'https://api.github.com/repos/bberka/TabLodge/releases/latest';
export const APK_NAME = 'tablodge.apk';

// The APK is only fetched from this repository's own releases.
const DOWNLOAD_PREFIX = 'https://github.com/bberka/TabLodge/releases/download/';

/**
The newest release. `apkUrl` is missing while the release workflow has not attached the APK yet, which happens a few
minutes after the release is published.
*/
export type LatestRelease = {version: string; apkUrl?: string};

/**
The last answer GitHub gave and when, so a tap within the cooldown asks nothing.
*/
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

/**
Whether `latest` is a higher version than `installed`. A version that is not `x.y.z` is never newer.
*/
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

/**
Reads GitHub's "latest release" answer. Returns undefined when it is not a release this app understands.
*/
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

/**
Reads a saved cache back, or undefined when it is missing or damaged.
*/
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

/**
Answers "is there an update" from the saved answer while it is under an hour old, and otherwise by asking. Only an
answer starts the cooldown: a failed request leaves it alone, so the next tap can try again. The saved answer is
compared with the installed version each time, so installing the update ends its notice at once.
*/
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

/**
The label while the APK downloads: a percentage once the server has said how large the file is, and the megabytes so
far until then.
*/
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
