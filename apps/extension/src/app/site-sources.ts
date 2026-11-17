// Sites whose own save TabLodge can follow (Settings › Sources): the user saves a link on the site, and the same
// link lands in that site's bookmark column. Each site is off until the user switches it on, which asks for an
// optional host permission for that site only; the content script is registered only while it is granted.
// The manifest's optional_host_permissions must list exactly the origins here (tests/site-sources.test.ts).
import {isRecord} from '../shared/library-values';
import type {SiteSourceStatus} from '../shared/types';

export type SiteSourceId = 'youtube' | 'reddit' | 'x' | 'instagram';

export type SiteSource = {
	id: SiteSourceId;
	/**
	What the user saves to, as Settings names it.
	*/
	label: string;
	/**
	The bookmark column the links go to, created on the first save.
	*/
	column: string;
	/**
	Match patterns for the optional host permission and the registered content script.
	*/
	origins: string[];
	hosts: string[];
	scriptId: string;
	/**
	The address TabLodge stores for a link the adapter read, or null when it is not a link to something saved there.
	*/
	canonicalUrl: (href: string) => string | null;
};

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;
const REDDIT_PERMALINK =
	/^\/(?:r|u|user)\/[\w-]+\/comments\/[\da-z]+(?:\/[^#/?]*(?:\/[\da-z]+)?)?\/?$/i;
// A post, and the pages under it (/photo/1, /analytics, ...), which are the same post.
const X_POST = /^\/(\w{1,15})\/status\/(\d{1,20})(?:\/|$)/;
// A post or reel, also under the author's name (/<user>/p/<id>/), as some pages link them.
const INSTAGRAM_POST =
	/^(?:\/[\w.]{1,30})?\/(p|reels?|tv)\/([\w-]{5,40})(?:\/|$)/;

function parse(href: string, base: string) {
	try {
		return new URL(href, base);
	} catch {
		return null;
	}
}

/**
A video as `https://www.youtube.com/watch?v=<id>`, from a watch, Shorts, or youtu.be address. Playlist, index, and
time parameters are dropped so the same video is always the same address.
*/
export function youtubeVideoUrl(href: string): string | null {
	const url = parse(href, 'https://www.youtube.com/');
	if (!url || url.protocol !== 'https:') {
		return null;
	}

	let id: string | null = null;
	if (url.hostname === 'youtu.be') {
		id = url.pathname.slice(1);
	} else if (/^(?:www\.|m\.)?youtube\.com$/.test(url.hostname)) {
		id =
			url.pathname === '/watch'
				? url.searchParams.get('v')
				: (/^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null);
	}

	return id && YOUTUBE_VIDEO_ID.test(id)
		? `https://www.youtube.com/watch?v=${id}`
		: null;
}

/**
A post or comment as `https://www.reddit.com<permalink>`, so old.reddit.com and www.reddit.com saves match.
*/
export function redditPermalinkUrl(href: string): string | null {
	const url = parse(href, 'https://www.reddit.com/');
	if (
		!url ||
		url.protocol !== 'https:' ||
		!/^(?:www\.|old\.)?reddit\.com$/.test(url.hostname) ||
		!REDDIT_PERMALINK.test(url.pathname)
	) {
		return null;
	}

	const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
	return `https://www.reddit.com${path}`;
}

/**
A post as `https://x.com/<user>/status/<id>`, so twitter.com and x.com saves match.
*/
export function xPostUrl(href: string): string | null {
	const url = parse(href, 'https://x.com/');
	const match =
		url?.protocol === 'https:' &&
		/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)
			? X_POST.exec(url.pathname)
			: null;
	return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
}

/**
A post as `https://www.instagram.com/p/<id>/` and a reel as `https://www.instagram.com/reel/<id>/`.
*/
export function instagramPostUrl(href: string): string | null {
	const url = parse(href, 'https://www.instagram.com/');
	const match =
		url?.protocol === 'https:' &&
		/^(?:www\.)?instagram\.com$/.test(url.hostname)
			? INSTAGRAM_POST.exec(url.pathname)
			: null;
	if (!match) {
		return null;
	}

	const kind = match[1] === 'p' || match[1] === 'tv' ? 'p' : 'reel';
	return `https://www.instagram.com/${kind}/${match[2]}/`;
}

export const SITE_SOURCES: readonly SiteSource[] = [
	{
		id: 'youtube',
		label: 'YouTube Watch later',
		column: 'YouTube',
		origins: ['https://www.youtube.com/*'],
		hosts: ['www.youtube.com'],
		scriptId: 'tablodge-source-youtube',
		canonicalUrl: youtubeVideoUrl,
	},
	{
		id: 'reddit',
		label: 'Reddit saved',
		column: 'Reddit',
		origins: ['https://www.reddit.com/*', 'https://old.reddit.com/*'],
		hosts: ['www.reddit.com', 'old.reddit.com'],
		scriptId: 'tablodge-source-reddit',
		canonicalUrl: redditPermalinkUrl,
	},
	{
		id: 'x',
		label: 'X bookmarks',
		column: 'X',
		origins: ['https://x.com/*', 'https://twitter.com/*'],
		hosts: ['x.com', 'twitter.com'],
		scriptId: 'tablodge-source-x',
		canonicalUrl: xPostUrl,
	},
	{
		id: 'instagram',
		label: 'Instagram saved',
		column: 'Instagram',
		origins: ['https://www.instagram.com/*'],
		hosts: ['www.instagram.com'],
		scriptId: 'tablodge-source-instagram',
		canonicalUrl: instagramPostUrl,
	},
];

/**
The content script every source registers; it picks its adapter from the page's host.
*/
export const SITE_SOURCE_SCRIPT = 'site-source.js';

export function siteSourceById(id: unknown): SiteSource | undefined {
	return SITE_SOURCES.find((source) => source.id === id);
}

export function siteSourceForUrl(href: unknown): SiteSource | undefined {
	if (typeof href !== 'string') {
		return undefined;
	}

	const url = parse(href, 'about:blank');
	return url?.protocol === 'https:'
		? SITE_SOURCES.find((source) => source.hosts.includes(url.hostname))
		: undefined;
}

/**
Per device, outside the library: whether each source is on, and why it went off or stopped saving. It is kept in
chrome.storage.local unprefixed, because the permission and the registered script belong to the browser, not to a
library, and it never syncs.
*/
export const SITE_SOURCES_KEY = 'tablodge.sources';

type SiteSourceEntry = Omit<SiteSourceStatus, 'id'>;
export type SiteSourcesState = Record<SiteSourceId, SiteSourceEntry>;

/**
The entry without its notice; whether it is on and its column choice stay.
*/
export const withoutNotice = ({
	notice: _notice,
	...entry
}: SiteSourceEntry): SiteSourceEntry => entry;

export function parseSiteSourcesState(raw: unknown): SiteSourcesState {
	const saved = isRecord(raw) && isRecord(raw.sources) ? raw.sources : {};
	const entries = SITE_SOURCES.map((source) => {
		const value = saved[source.id];
		const entry = isRecord(value) ? value : {};
		const notice =
			entry.notice === 'revoked' || entry.notice === 'unreadable'
				? entry.notice
				: undefined;
		const columnId =
			typeof entry.columnId === 'string' && entry.columnId.length <= 200
				? entry.columnId
				: undefined;
		return [
			source.id,
			{
				enabled: entry.enabled === true,
				...(notice && {notice}),
				...(columnId && {columnId}),
			},
		] as const;
	});
	return Object.fromEntries(entries) as SiteSourcesState;
}

export function siteSourcesValue(state: SiteSourcesState) {
	return {version: 1, sources: state};
}

export function siteSourceStatuses(
	state: SiteSourcesState,
): SiteSourceStatus[] {
	return SITE_SOURCES.map((source) => ({id: source.id, ...state[source.id]}));
}

/**
Labels of the Undo steps source saves create; the page may only undo those.
*/
export const siteSourceUndoLabel = (source: SiteSource) =>
	`Save from ${source.column}`;
