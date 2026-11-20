/*
Whether a sync server and this app can work together, from what the server says about itself at /v1/status. A
different protocol stops sync; a missing feature only leaves its part on the device. Both apps show the result in
Settings › Sync with the same words.
*/
import {isRecord} from '../library-values';
import {PROTOCOL_VERSION} from './change-log';
import {SHARED_PAGES_FEATURE} from './shared-pages';

/**
The server's own account of itself. `version` is null for a server from before it reported one, and `0.0.0` for one
built from unreleased source.
*/
export type ServerInfo = {
	protocol: number;
	version: string | null;
	features: string[];
};

/**
Reads a /v1/status answer. Undefined when it does not look like a TabLodge sync server.
*/
export function parseServerInfo(body: unknown): ServerInfo | undefined {
	if (!isRecord(body) || !Number.isSafeInteger(body.protocol)) {
		return undefined;
	}

	return {
		protocol: body.protocol as number,
		version:
			typeof body.version === 'string' && body.version.length <= 40
				? body.version
				: null,
		// A server old enough to have no list supports none of the optional parts.
		features: Array.isArray(body.features)
			? body.features.filter(
					(feature): feature is string => typeof feature === 'string',
				)
			: [],
	};
}

/**
The first server release that speaks each protocol version. Add the new entry when `PROTOCOL_VERSION` moves.
*/
export const PROTOCOL_RELEASES: Readonly<Record<number, string>> = {
	1: '0.2.0',
};

/**
Which side to update when the server speaks another protocol, or undefined when they match.
*/
export function updateSide(
	serverProtocol: number,
): 'server' | 'app' | undefined {
	if (serverProtocol === PROTOCOL_VERSION) {
		return undefined;
	}

	return serverProtocol < PROTOCOL_VERSION ? 'server' : 'app';
}

export function incompatibleMessage(side: 'server' | 'app'): string {
	return side === 'server'
		? `Your sync server is older than this app. Update the server to ${PROTOCOL_RELEASES[PROTOCOL_VERSION]} or later.`
		: 'This app is older than your sync server. Update TabLodge.';
}

/**
What each optional server feature does for this app, and the first server release that has it. The regular
library's Settings › Sync lists the ones the connected server lacks.
*/
export const SERVER_FEATURES: ReadonlyArray<{
	name: string;
	since: string;
	missing: string;
}> = [
	{
		name: 'notes',
		since: '0.4.0',
		missing: 'Bookmark notes stay on this device.',
	},
	{
		name: 'tags',
		since: '0.4.0',
		missing: 'Bookmark tags stay on this device.',
	},
	{
		name: 'sources',
		since: '0.4.0',
		missing: 'Sources settings in the browser extension stay in each browser.',
	},
	{
		name: 'trash',
		since: '0.2.2',
		missing: 'The trash stays on this device.',
	},
	{
		name: 'preview',
		since: '0.2.2',
		missing: 'Site icons and link previews do not come through the server.',
	},
	{
		name: SHARED_PAGES_FEATURE,
		since: '0.4.0',
		missing: 'Upload to my server cannot share pages.',
	},
	{
		name: 'page-source',
		since: '0.4.0',
		missing:
			'Keep a copy on the phone fetches pages itself, not through the server.',
	},
	{
		name: 'private',
		since: '0.2.0',
		missing: 'The private library does not sync.',
	},
];

export function missingFeatures(
	info: ServerInfo,
): ReadonlyArray<(typeof SERVER_FEATURES)[number]> {
	return SERVER_FEATURES.filter(({name}) => !info.features.includes(name));
}

/**
The oldest release that has every feature in `missing`.
*/
export function releaseWithAll(
	missing: ReadonlyArray<{since: string}>,
): string | undefined {
	// Release numbers stay below 1000 (see androidVersionCode in scripts/release-version.ts).
	const rank = (version: string) =>
		version.split('.').reduce((total, part) => total * 1000 + Number(part), 0);
	let newest: string | undefined;
	for (const {since} of missing) {
		if (newest === undefined || rank(since) > rank(newest)) {
			newest = since;
		}
	}

	return newest;
}

/**
The server's version as Settings shows it.
*/
export function versionText(version: string | null): string {
	if (version === null) {
		return 'not reported (an older release)';
	}

	return version === '0.0.0' ? 'an unreleased build' : version;
}

/**
How the connected server and this app get along, read from a sync status that a page took from storage.
*/
export type Compat = {
	url: string | null;
	incompatible?: 'server' | 'app';
	server?: ServerInfo;
	missing: ReadonlyArray<(typeof SERVER_FEATURES)[number]>;
};

export function readCompat(status: {
	url: string | null;
	incompatible?: unknown;
	server?: unknown;
}): Compat {
	const server = parseServerInfo(status.server);
	const incompatible =
		status.incompatible === 'server' || status.incompatible === 'app'
			? status.incompatible
			: undefined;
	return {
		url: status.url,
		incompatible,
		server,
		// A server that cannot sync at all has nothing else worth listing.
		missing: server && !incompatible ? missingFeatures(server) : [],
	};
}

/**
The banner both apps show at the top of their main screens while the server and this app do not match: sync stopped,
or features missing. Settings › Sync has the details. Undefined when there is none.

A stopped sync stays until the problem is gone. Missing features can be dismissed: `dismissed` is what
`dismissKey` gave when the user did, and the banner stays hidden until the server version or the missing features
change.
*/
export function problemBanner(
	compat: Compat,
	dismissed?: unknown,
): {stopped: boolean; title: string; detail: string} | undefined {
	if (compat.incompatible) {
		return {
			stopped: true,
			title: 'Sync stopped',
			detail: incompatibleMessage(compat.incompatible),
		};
	}

	if (compat.missing.length === 0 || dismissed === dismissKey(compat)) {
		return undefined;
	}

	const release = releaseWithAll(compat.missing);
	return {
		stopped: false,
		title: 'Your sync server needs an update',
		detail: `Until it runs ${release ?? 'a newer release'} or later: ${compat.missing.map(({missing}) => missing).join(' ')}`,
	};
}

/**
Where each app keeps the dismissed missing-features banner, on the device only: it never syncs.
*/
export const SYNC_DISMISSED_KEY = 'tablodge.sync.dismissed';

/**
What dismissing the missing-features banner remembers: the server version and the features it lacks. Undefined while
there is nothing to dismiss, including a stopped sync, which cannot be dismissed.
*/
export function dismissKey(compat: Compat): string | undefined {
	if (compat.incompatible || compat.missing.length === 0) {
		return undefined;
	}

	const names = compat.missing.map(({name}) => name).toSorted();
	return `${compat.server?.version ?? ''} ${names.join(',')}`;
}

export const UPDATE_GUIDE_URL =
	'https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#update';
