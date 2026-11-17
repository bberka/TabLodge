// Sites whose own save TabLodge can follow (Settings › Sources): the user saves a link on the site, and the same
// link lands in that site's bookmark column. Each site is off until the user adds it in Settings, which asks for an
// optional host permission for that site only; the content script is registered only while it is granted. A new
// site is an entry here plus its adapter in shell/site-source.ts; Settings lists it in Add a site by itself.
// The manifest's optional_host_permissions must list exactly the origins here (tests/site-sources.test.ts).
import {isRecord} from '../shared/library-values';
import type {SiteSourceStatus} from '../shared/types';

export type SiteSourceId =
	| 'youtube'
	| 'reddit'
	| 'x'
	| 'instagram'
	| 'github'
	| 'hackernews'
	| 'stackoverflow'
	| 'devto'
	| 'lobsters';

export type SiteSource = {
	id: SiteSourceId;
	/**
	What the user saves to, as Settings names it.
	*/
	label: string;
	/**
	One line on what gets saved, shown in the Add a site list and under the site in Settings.
	*/
	description: string;
	/**
	The site's home page, for its icon.
	*/
	homepage: string;
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
	/**
	For a site whose items link elsewhere: the item's own discussion page, kept in the bookmark's note as
	`<name>: <address>`.
	*/
	discussion?: {name: string; url: (href: string) => string | null};
};

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;
const REDDIT_PERMALINK =
	/^\/(?:r|u|user)\/[\w-]+\/comments\/[\da-z]+(?:\/[^#/?]*(?:\/[\da-z]+)?)?\/?$/i;
// A post, and the pages under it (/photo/1, /analytics, ...), which are the same post.
const X_POST = /^\/(\w{1,15})\/status\/(\d{1,20})(?:\/|$)/;
// A post or reel, also under the author's name (/<user>/p/<id>/), as some pages link them.
const INSTAGRAM_POST =
	/^(?:\/[\w.]{1,30})?\/(p|reels?|tv)\/([\w-]{5,40})(?:\/|$)/;

// First path segments that are GitHub's own pages, not an owner.
const GITHUB_RESERVED = new Set([
	'about',
	'account',
	'apps',
	'collections',
	'customer-stories',
	'dashboard',
	'enterprise',
	'explore',
	'features',
	'issues',
	'login',
	'logout',
	'marketplace',
	'new',
	'notifications',
	'orgs',
	'organizations',
	'pricing',
	'pulls',
	'search',
	'security',
	'sessions',
	'settings',
	'signup',
	'site',
	'sponsors',
	'stars',
	'topics',
	'trending',
	'users',
]);
const GITHUB_REPO = /^\/([\da-z][\d\-a-z]{0,38})\/([\w\-.]{1,100})(?:\/|$)/i;
const STACK_OVERFLOW_QUESTION =
	/^\/(?:questions|q)\/(\d{1,12})(?:\/([\w-]{1,200}))?/;
// First path segments that are dev.to's own pages, not an author.
const DEVTO_RESERVED = new Set([
	'about',
	'api',
	'code-of-conduct',
	'dashboard',
	'enter',
	'faq',
	'latest',
	'listings',
	'new',
	'notifications',
	'p',
	'pod',
	'podcasts',
	'privacy',
	'readinglist',
	'search',
	'settings',
	'signout_confirm',
	't',
	'tags',
	'terms',
	'top',
	'users',
	'videos',
]);
const DEVTO_ARTICLE = /^\/([\w-]{1,60})\/([\w-]{1,200})\/?$/;
const LOBSTERS_STORY = /^\/s\/([\da-z]{1,12})(?:\/([\w-]{0,200}))?\/?$/i;

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

/**
A repository as `https://github.com/<owner>/<repo>`, from any page in it.
*/
export function githubRepoUrl(href: string): string | null {
	const url = parse(href, 'https://github.com/');
	const match =
		url?.protocol === 'https:' && /^(?:www\.)?github\.com$/.test(url.hostname)
			? GITHUB_REPO.exec(url.pathname)
			: null;
	if (!match || GITHUB_RESERVED.has(match[1].toLowerCase())) {
		return null;
	}

	const repo = match[2].replace(/\.git$/, '');
	return repo && repo !== '.' && repo !== '..'
		? `https://github.com/${match[1]}/${repo}`
		: null;
}

/**
A story's own page on Hacker News, `https://news.ycombinator.com/item?id=<id>`.
*/
export function hackerNewsItemUrl(href: string): string | null {
	const url = parse(href, 'https://news.ycombinator.com/');
	const id =
		url?.protocol === 'https:' &&
		url.hostname === 'news.ycombinator.com' &&
		url.pathname === '/item'
			? url.searchParams.get('id')
			: null;
	return id && /^\d{1,12}$/.test(id)
		? `https://news.ycombinator.com/item?id=${id}`
		: null;
}

/**
The address a story on Hacker News or Lobsters links to, which can be any web page, or the story's own page for a
text post. Relative links are the site's own pages.
*/
function storyUrl(base: string, ownPage: (href: string) => string | null) {
	return (href: string) => {
		const url = parse(href, base);
		if (!url || !['http:', 'https:'].includes(url.protocol)) {
			return null;
		}

		return url.hostname === new URL(base).hostname
			? ownPage(url.href)
			: url.href;
	};
}

/**
A question as `https://stackoverflow.com/questions/<id>/<slug>`, also from a `/q/<id>` short link (without a slug).
*/
export function stackOverflowQuestionUrl(href: string): string | null {
	const url = parse(href, 'https://stackoverflow.com/');
	const match =
		url?.protocol === 'https:' && url.hostname === 'stackoverflow.com'
			? STACK_OVERFLOW_QUESTION.exec(url.pathname)
			: null;
	if (!match) {
		return null;
	}

	return match[2]
		? `https://stackoverflow.com/questions/${match[1]}/${match[2]}`
		: `https://stackoverflow.com/questions/${match[1]}`;
}

/**
An article as `https://dev.to/<author>/<slug>`.
*/
export function devtoArticleUrl(href: string): string | null {
	const url = parse(href, 'https://dev.to/');
	const match =
		url?.protocol === 'https:' && url.hostname === 'dev.to'
			? DEVTO_ARTICLE.exec(url.pathname)
			: null;
	return match && !DEVTO_RESERVED.has(match[1].toLowerCase())
		? `https://dev.to/${match[1]}/${match[2]}`
		: null;
}

/**
A story's own page on Lobsters, `https://lobste.rs/s/<id>/<slug>`.
*/
export function lobstersStoryUrl(href: string): string | null {
	const url = parse(href, 'https://lobste.rs/');
	const match =
		url?.protocol === 'https:' && url.hostname === 'lobste.rs'
			? LOBSTERS_STORY.exec(url.pathname)
			: null;
	if (!match) {
		return null;
	}

	return match[2]
		? `https://lobste.rs/s/${match[1]}/${match[2]}`
		: `https://lobste.rs/s/${match[1]}`;
}

export const SITE_SOURCES: readonly SiteSource[] = [
	{
		id: 'youtube',
		label: 'YouTube Watch later',
		description: 'Videos you add to Watch later on youtube.com',
		homepage: 'https://www.youtube.com/',
		column: 'YouTube',
		origins: ['https://www.youtube.com/*'],
		hosts: ['www.youtube.com'],
		scriptId: 'tablodge-source-youtube',
		canonicalUrl: youtubeVideoUrl,
	},
	{
		id: 'reddit',
		label: 'Reddit saved',
		description: 'Posts and comments you save on reddit.com',
		homepage: 'https://www.reddit.com/',
		column: 'Reddit',
		origins: ['https://www.reddit.com/*', 'https://old.reddit.com/*'],
		hosts: ['www.reddit.com', 'old.reddit.com'],
		scriptId: 'tablodge-source-reddit',
		canonicalUrl: redditPermalinkUrl,
	},
	{
		id: 'x',
		label: 'X bookmarks',
		description: 'Posts you bookmark on x.com or twitter.com',
		homepage: 'https://x.com/',
		column: 'X',
		origins: ['https://x.com/*', 'https://twitter.com/*'],
		hosts: ['x.com', 'twitter.com'],
		scriptId: 'tablodge-source-x',
		canonicalUrl: xPostUrl,
	},
	{
		id: 'instagram',
		label: 'Instagram saved',
		description: 'Posts and reels you save on instagram.com',
		homepage: 'https://www.instagram.com/',
		column: 'Instagram',
		origins: ['https://www.instagram.com/*'],
		hosts: ['www.instagram.com'],
		scriptId: 'tablodge-source-instagram',
		canonicalUrl: instagramPostUrl,
	},
	{
		id: 'github',
		label: 'GitHub stars',
		description: 'Repositories you star on github.com',
		homepage: 'https://github.com/',
		column: 'GitHub',
		origins: ['https://github.com/*'],
		hosts: ['github.com'],
		scriptId: 'tablodge-source-github',
		canonicalUrl: githubRepoUrl,
	},
	{
		id: 'hackernews',
		label: 'Hacker News favorites',
		description: 'Stories you favorite on news.ycombinator.com',
		homepage: 'https://news.ycombinator.com/',
		column: 'Hacker News',
		origins: ['https://news.ycombinator.com/*'],
		hosts: ['news.ycombinator.com'],
		scriptId: 'tablodge-source-hackernews',
		canonicalUrl: storyUrl('https://news.ycombinator.com/', hackerNewsItemUrl),
		discussion: {name: 'Hacker News discussion', url: hackerNewsItemUrl},
	},
	{
		id: 'stackoverflow',
		label: 'Stack Overflow bookmarks',
		description: 'Questions you bookmark on stackoverflow.com',
		homepage: 'https://stackoverflow.com/',
		column: 'Stack Overflow',
		origins: ['https://stackoverflow.com/*'],
		hosts: ['stackoverflow.com'],
		scriptId: 'tablodge-source-stackoverflow',
		canonicalUrl: stackOverflowQuestionUrl,
	},
	{
		id: 'devto',
		label: 'dev.to reading list',
		description: 'Articles you save to your reading list on dev.to',
		homepage: 'https://dev.to/',
		column: 'dev.to',
		origins: ['https://dev.to/*'],
		hosts: ['dev.to'],
		scriptId: 'tablodge-source-devto',
		canonicalUrl: devtoArticleUrl,
	},
	{
		id: 'lobsters',
		label: 'Lobsters saved',
		description: 'Stories you save on lobste.rs',
		homepage: 'https://lobste.rs/',
		column: 'Lobsters',
		origins: ['https://lobste.rs/*'],
		hosts: ['lobste.rs'],
		scriptId: 'tablodge-source-lobsters',
		canonicalUrl: storyUrl('https://lobste.rs/', lobstersStoryUrl),
		discussion: {name: 'Lobsters discussion', url: lobstersStoryUrl},
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
