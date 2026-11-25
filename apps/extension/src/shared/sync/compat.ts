import {isRecord} from '../library-values';
import {PROTOCOL_VERSION} from './change-log';
import {
	SHARED_PAGE_IMPORT_FEATURE,
	SHARED_PAGE_LIVE_PASSWORD_FEATURE,
	SHARED_PAGES_FEATURE,
} from './shared-pages';

export type ServerInfo = {
	protocol: number;
	version: string | null;
	features: string[];
};

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
		features: Array.isArray(body.features)
			? body.features.filter(
					(feature): feature is string => typeof feature === 'string',
				)
			: [],
	};
}

export const PROTOCOL_RELEASES: Readonly<Record<number, string>> = {
	1: '0.2.0',
};

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
		name: 'settings',
		since: '0.4.0',
		missing: 'Settings added since 0.3.0 stay on this device.',
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
		missing: 'Get a link cannot share pages.',
	},
	{
		name: SHARED_PAGE_IMPORT_FEATURE,
		since: '0.4.0',
		missing:
			'Shared pages have no Add to TabLodge button, and Share does not list the links made from a column or session.',
	},
	{
		name: SHARED_PAGE_LIVE_PASSWORD_FEATURE,
		since: '0.4.0',
		missing:
			'Live shared links and password-protected shared pages are not available.',
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

export function releaseWithAll(
	missing: ReadonlyArray<{since: string}>,
): string | undefined {
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

export function versionText(version: string | null): string {
	if (version === null) {
		return 'not reported (an older release)';
	}

	return version === '0.0.0' ? 'an unreleased build' : version;
}

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
		missing: server && !incompatible ? missingFeatures(server) : [],
	};
}

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

export const SYNC_DISMISSED_KEY = 'tablodge.sync.dismissed';

export function dismissKey(compat: Compat): string | undefined {
	if (compat.incompatible || compat.missing.length === 0) {
		return undefined;
	}

	const names = compat.missing.map(({name}) => name).toSorted();
	return `${compat.server?.version ?? ''} ${names.join(',')}`;
}

export const UPDATE_GUIDE_URL =
	'https://github.com/bberka/TabLodge/blob/master/docs/self-hosting.md#update';
