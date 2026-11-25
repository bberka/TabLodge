import {canonicalJson, isRecord} from '../shared/library-values';
import {
	SOURCE_COLUMNS,
	type SiteSourceId,
	sourceColumnId,
	sourceColumnSite,
	type SourceColumnLook,
} from '../shared/source-columns';
import type {
	BookmarkColumn,
	SiteSourceNotice,
	SiteSourceStatus,
} from '../shared/types';

export type {SiteSourceId} from '../shared/source-columns';

export type SiteSource = {
	id: SiteSourceId;
	label: string;
	description: string;
	homepage: string;
	column: SourceColumnLook & {id: string};
	origins: string[];
	hosts: string[];
	columnSites: string[];
	scriptId: string;
	canonicalUrl: (href: string) => string | null;
	discussion?: {name: string; url: (href: string) => string | null};
	saveLoadsPage?: true;
	keepOffSite?: true;
};

const YOUTUBE_VIDEO_ID = /^[\w-]{11}$/;
const REDDIT_PERMALINK =
	/^\/(?:r|u|user)\/[\w-]+\/comments\/[\da-z]+(?:\/[^#/?]*(?:\/[\da-z]+)?)?\/?$/i;
const X_POST = /^\/(\w{1,15})\/status\/(\d{1,20})(?:\/|$)/;
const INSTAGRAM_POST =
	/^(?:\/[\w.]{1,30})?\/(p|reels?|tv)\/([\w-]{5,40})(?:\/|$)/;

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
const BLUESKY_POST =
	/^\/profile\/([\w\-.:]{1,253})\/post\/([\da-z]{1,32})\/?$/i;
const SOUNDCLOUD_RESERVED = new Set([
	'charts',
	'discover',
	'feed',
	'messages',
	'notifications',
	'pages',
	'people',
	'search',
	'settings',
	'stations',
	'stream',
	'upload',
	'you',
]);
const SOUNDCLOUD_ITEM =
	/^\/([\w-]{1,100})\/(?:sets\/([\w-]{1,200})|([\w-]{1,200}))\/?$/;
const SPOTIFY_ITEM =
	/^(?:\/intl-[-a-z]{2,10})?\/(track|album|playlist|episode|show|artist)\/([\dA-Za-z]{22})\/?$/;
const LETTERBOXD_FILM = /^(?:\/[\w-]{1,40})?\/film\/([\w-]{1,200})(?:\/|$)/;
const IMDB_TITLE =
	/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/title\/(tt\d{5,12})(?:\/|$)/;
const GOODREADS_BOOK = /^\/book\/show\/(\d{1,12})(?:[-.][^/]*)?\/?$/;
const MEDIUM_POST = /(?:^\/p\/|-)([\da-f]{12})\/?$/;
const SUBSTACK_POST = /^\/(?:p\/[\w-]{1,200}|home\/post\/p-\d{1,15})\/?$/;

function parse(href: string, base: string) {
	try {
		return new URL(href, base);
	} catch {
		return null;
	}
}

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

export function xPostUrl(href: string): string | null {
	const url = parse(href, 'https://x.com/');
	const match =
		url?.protocol === 'https:' &&
		/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)
			? X_POST.exec(url.pathname)
			: null;
	return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
}

export function instagramPostUrl(href: string): string | null {
	const url = parse(href, 'https://www.instagram.com/');
	const match =
		url?.protocol === 'https:' &&
		/^(?:www\.)?instagram\.com$/.test(url.hostname)
			? INSTAGRAM_POST.exec(url.pathname)
			: null;
	return match ? `https://www.instagram.com/p/${match[2]}/` : null;
}

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

function onHost(url: URL | null, ...hosts: string[]): url is URL {
	return (
		url?.protocol === 'https:' &&
		hosts.some((host) =>
			host.startsWith('*.')
				? url.hostname === host.slice(2) || url.hostname.endsWith(host.slice(1))
				: url.hostname === host,
		)
	);
}

export function blueskyPostUrl(href: string): string | null {
	const url = parse(href, 'https://bsky.app/');
	const match = onHost(url, 'bsky.app')
		? BLUESKY_POST.exec(url.pathname)
		: null;
	return match ? `https://bsky.app/profile/${match[1]}/post/${match[2]}` : null;
}

export function soundcloudItemUrl(href: string): string | null {
	const url = parse(href, 'https://soundcloud.com/');
	const match = onHost(url, 'soundcloud.com', 'm.soundcloud.com')
		? SOUNDCLOUD_ITEM.exec(url.pathname)
		: null;
	if (!match || SOUNDCLOUD_RESERVED.has(match[1].toLowerCase())) {
		return null;
	}

	return match[2]
		? `https://soundcloud.com/${match[1]}/sets/${match[2]}`
		: `https://soundcloud.com/${match[1]}/${match[3]}`;
}

export function spotifyItemUrl(href: string): string | null {
	const url = parse(href, 'https://open.spotify.com/');
	const match = onHost(url, 'open.spotify.com')
		? SPOTIFY_ITEM.exec(url.pathname)
		: null;
	return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : null;
}

export function letterboxdFilmUrl(href: string): string | null {
	const url = parse(href, 'https://letterboxd.com/');
	const match = onHost(url, 'letterboxd.com')
		? LETTERBOXD_FILM.exec(url.pathname)
		: null;
	return match ? `https://letterboxd.com/film/${match[1]}/` : null;
}

export function imdbTitleUrl(href: string): string | null {
	const url = parse(href, 'https://www.imdb.com/');
	const match = onHost(url, 'www.imdb.com', 'm.imdb.com')
		? IMDB_TITLE.exec(url.pathname)
		: null;
	return match ? `https://www.imdb.com/title/${match[1]}/` : null;
}

export function goodreadsBookUrl(href: string): string | null {
	const url = parse(href, 'https://www.goodreads.com/');
	const match = onHost(url, 'www.goodreads.com')
		? GOODREADS_BOOK.exec(url.pathname)
		: null;
	return match ? `https://www.goodreads.com/book/show/${match[1]}` : null;
}

export function mediumPostUrl(href: string): string | null {
	const url = parse(href, 'https://medium.com/');
	const match = onHost(url, 'medium.com', '*.medium.com')
		? MEDIUM_POST.exec(url.pathname)
		: null;
	return match ? `https://medium.com/p/${match[1]}` : null;
}

export function substackPostUrl(
	href: string,
	base = 'https://substack.com/',
): string | null {
	const url = parse(href, base);
	return onHost(url, 'substack.com', '*.substack.com') &&
		SUBSTACK_POST.test(url.pathname)
		? `https://${url.hostname}${url.pathname.replace(/\/$/, '')}`
		: null;
}

const SITES: ReadonlyArray<Omit<SiteSource, 'column'>> = [
	{
		id: 'youtube',
		label: 'YouTube Watch later',
		description: 'Videos you add to Watch later on youtube.com',
		homepage: 'https://www.youtube.com/',
		origins: ['https://www.youtube.com/*'],
		hosts: ['www.youtube.com'],
		columnSites: ['youtube.com', 'youtu.be'],
		scriptId: 'tablodge-source-youtube',
		canonicalUrl: youtubeVideoUrl,
		keepOffSite: true,
	},
	{
		id: 'reddit',
		label: 'Reddit saved',
		description: 'Posts and comments you save on reddit.com',
		homepage: 'https://www.reddit.com/',
		origins: ['https://www.reddit.com/*', 'https://old.reddit.com/*'],
		hosts: ['www.reddit.com', 'old.reddit.com'],
		columnSites: ['reddit.com'],
		scriptId: 'tablodge-source-reddit',
		canonicalUrl: redditPermalinkUrl,
		keepOffSite: true,
	},
	{
		id: 'x',
		label: 'X bookmarks',
		description: 'Posts you bookmark on x.com or twitter.com',
		homepage: 'https://x.com/',
		origins: ['https://x.com/*', 'https://twitter.com/*'],
		hosts: ['x.com', 'twitter.com'],
		columnSites: ['x.com', 'twitter.com'],
		scriptId: 'tablodge-source-x',
		canonicalUrl: xPostUrl,
		keepOffSite: true,
	},
	{
		id: 'instagram',
		label: 'Instagram saved',
		description: 'Posts and reels you save on instagram.com',
		homepage: 'https://www.instagram.com/',
		origins: ['https://www.instagram.com/*'],
		hosts: ['www.instagram.com'],
		columnSites: ['instagram.com'],
		scriptId: 'tablodge-source-instagram',
		canonicalUrl: instagramPostUrl,
		keepOffSite: true,
	},
	{
		id: 'github',
		label: 'GitHub stars',
		description: 'Repositories you star on github.com',
		homepage: 'https://github.com/',
		origins: ['https://github.com/*'],
		hosts: ['github.com'],
		columnSites: ['github.com'],
		scriptId: 'tablodge-source-github',
		canonicalUrl: githubRepoUrl,
		keepOffSite: true,
	},
	{
		id: 'hackernews',
		label: 'Hacker News favorites',
		description: 'Stories you favorite on news.ycombinator.com',
		homepage: 'https://news.ycombinator.com/',
		origins: ['https://news.ycombinator.com/*'],
		hosts: ['news.ycombinator.com'],
		columnSites: ['news.ycombinator.com'],
		scriptId: 'tablodge-source-hackernews',
		canonicalUrl: storyUrl('https://news.ycombinator.com/', hackerNewsItemUrl),
		discussion: {name: 'Hacker News discussion', url: hackerNewsItemUrl},
		saveLoadsPage: true,
		keepOffSite: true,
	},
	{
		id: 'stackoverflow',
		label: 'Stack Overflow bookmarks',
		description: 'Questions you bookmark on stackoverflow.com',
		homepage: 'https://stackoverflow.com/',
		origins: ['https://stackoverflow.com/*'],
		hosts: ['stackoverflow.com'],
		columnSites: ['stackoverflow.com'],
		scriptId: 'tablodge-source-stackoverflow',
		canonicalUrl: stackOverflowQuestionUrl,
		keepOffSite: true,
	},
	{
		id: 'devto',
		label: 'dev.to reading list',
		description: 'Articles you save to your reading list on dev.to',
		homepage: 'https://dev.to/',
		origins: ['https://dev.to/*'],
		hosts: ['dev.to'],
		columnSites: ['dev.to'],
		scriptId: 'tablodge-source-devto',
		canonicalUrl: devtoArticleUrl,
		keepOffSite: true,
	},
	{
		id: 'lobsters',
		label: 'Lobsters saved',
		description: 'Stories you save on lobste.rs',
		homepage: 'https://lobste.rs/',
		origins: ['https://lobste.rs/*'],
		hosts: ['lobste.rs'],
		columnSites: ['lobste.rs'],
		scriptId: 'tablodge-source-lobsters',
		canonicalUrl: storyUrl('https://lobste.rs/', lobstersStoryUrl),
		discussion: {name: 'Lobsters discussion', url: lobstersStoryUrl},
		keepOffSite: true,
	},
	{
		id: 'bluesky',
		label: 'Bluesky saved posts',
		description: 'Posts you save on bsky.app',
		homepage: 'https://bsky.app/',
		origins: ['https://bsky.app/*'],
		hosts: ['bsky.app'],
		columnSites: ['bsky.app'],
		scriptId: 'tablodge-source-bluesky',
		canonicalUrl: blueskyPostUrl,
		keepOffSite: true,
	},
	{
		id: 'soundcloud',
		label: 'SoundCloud likes',
		description: 'Tracks and playlists you like on soundcloud.com',
		homepage: 'https://soundcloud.com/',
		origins: ['https://soundcloud.com/*', 'https://m.soundcloud.com/*'],
		hosts: ['soundcloud.com', 'm.soundcloud.com'],
		columnSites: ['soundcloud.com'],
		scriptId: 'tablodge-source-soundcloud',
		canonicalUrl: soundcloudItemUrl,
		keepOffSite: true,
	},
	{
		id: 'spotify',
		label: 'Spotify library',
		description:
			'Songs, albums, playlists, shows, and episodes you save on open.spotify.com',
		homepage: 'https://open.spotify.com/',
		origins: ['https://open.spotify.com/*'],
		hosts: ['open.spotify.com'],
		columnSites: ['open.spotify.com'],
		scriptId: 'tablodge-source-spotify',
		canonicalUrl: spotifyItemUrl,
		keepOffSite: true,
	},
	{
		id: 'letterboxd',
		label: 'Letterboxd watchlist',
		description: 'Films you add to your watchlist on letterboxd.com',
		homepage: 'https://letterboxd.com/',
		origins: ['https://letterboxd.com/*'],
		hosts: ['letterboxd.com'],
		columnSites: ['letterboxd.com'],
		scriptId: 'tablodge-source-letterboxd',
		canonicalUrl: letterboxdFilmUrl,
		keepOffSite: true,
	},
	{
		id: 'imdb',
		label: 'IMDb watchlist',
		description: 'Films and shows you add to your watchlist on imdb.com',
		homepage: 'https://www.imdb.com/',
		origins: ['https://www.imdb.com/*', 'https://m.imdb.com/*'],
		hosts: ['www.imdb.com', 'm.imdb.com'],
		columnSites: ['imdb.com'],
		scriptId: 'tablodge-source-imdb',
		canonicalUrl: imdbTitleUrl,
		keepOffSite: true,
	},
	{
		id: 'goodreads',
		label: 'Goodreads Want to Read',
		description: 'Books you mark Want to Read on goodreads.com',
		homepage: 'https://www.goodreads.com/',
		origins: ['https://www.goodreads.com/*'],
		hosts: ['www.goodreads.com'],
		columnSites: ['goodreads.com'],
		scriptId: 'tablodge-source-goodreads',
		canonicalUrl: goodreadsBookUrl,
		keepOffSite: true,
	},
	{
		id: 'medium',
		label: 'Medium reading list',
		description:
			'Stories you bookmark on medium.com and its publication subdomains',
		homepage: 'https://medium.com/',
		origins: ['https://medium.com/*', 'https://*.medium.com/*'],
		hosts: ['medium.com', '*.medium.com'],
		columnSites: ['medium.com'],
		scriptId: 'tablodge-source-medium',
		canonicalUrl: mediumPostUrl,
	},
	{
		id: 'substack',
		label: 'Substack saved',
		description:
			'Posts you save on substack.com and publications at substack.com addresses',
		homepage: 'https://substack.com/',
		origins: ['https://substack.com/*', 'https://*.substack.com/*'],
		hosts: ['substack.com', '*.substack.com'],
		columnSites: ['substack.com'],
		scriptId: 'tablodge-source-substack',
		canonicalUrl: substackPostUrl,
		keepOffSite: true,
	},
];

export const SITE_SOURCES: readonly SiteSource[] = SITES.map((site) => ({
	...site,
	column: {...SOURCE_COLUMNS[site.id], id: sourceColumnId(site.id)},
}));

export const SITE_SOURCE_SCRIPT = 'site-source.js';

export function siteSourceById(id: unknown): SiteSource | undefined {
	return SITE_SOURCES.find((source) => source.id === id);
}

export function siteSourceForUrl(href: unknown): SiteSource | undefined {
	if (typeof href !== 'string') {
		return undefined;
	}

	const url = parse(href, 'about:blank');
	return SITE_SOURCES.find((source) => onHost(url, ...source.hosts));
}

export const SITE_SOURCES_KEY = 'tablodge.sources';

type SiteSourceLocal = {
	enabled: boolean;
	notice?: SiteSourceNotice;
	pointed?: true;
};
export type SiteSourcesState = {
	sites: Record<SiteSourceId, SiteSourceLocal>;
	choices: Record<string, Record<string, unknown>>;
};

export function sourceChoice(
	state: SiteSourcesState,
	source: SiteSource,
): {wanted: boolean; columnId?: string; keepOffSite?: true} {
	const choice = state.choices[source.id];
	if (!isRecord(choice)) {
		return {wanted: false};
	}

	const {columnId, keepOffSite} = choice;
	return {
		wanted: true,
		...(typeof columnId === 'string' &&
			columnId !== '' &&
			columnId.length <= 200 && {columnId}),
		...(keepOffSite === true && source.keepOffSite && {keepOffSite: true}),
	};
}

export function putChoice(
	state: SiteSourcesState,
	id: string,
	value: Record<string, unknown>,
) {
	state.choices = {...state.choices, [id]: value};
}

export function applySyncedChoices(
	state: SiteSourcesState,
	put: ReadonlyArray<{id: string; value: Record<string, unknown>}>,
	remove: readonly string[],
	was: ReadonlyMap<string, unknown>,
): {removed: SiteSource[]; kept: string[]} {
	const kept: string[] = [];
	const unchanged = (id: string) => {
		const same =
			canonicalJson(
				Object.hasOwn(state.choices, id) ? state.choices[id] : null,
			) === canonicalJson(was.get(id) ?? null);
		if (!same) {
			kept.push(id);
		}

		return same;
	};

	for (const {id, value} of put) {
		if (unchanged(id)) {
			putChoice(state, id, value);
		}
	}

	const removed: SiteSource[] = [];
	for (const id of remove) {
		if (!unchanged(id)) {
			continue;
		}

		withoutChoice(state, id);
		const source = siteSourceById(id);
		if (!source) {
			continue;
		}

		removed.push(source);
		state.sites[source.id] = {enabled: false};
	}

	return {removed, kept};
}

export function withoutChoice(state: SiteSourcesState, id: string) {
	const {[id]: _removed, ...rest} = state.choices;
	state.choices = rest;
}

export function withChoice(
	state: SiteSourcesState,
	source: SiteSource,
	field: 'columnId' | 'keepOffSite',
	value: string | true | undefined,
) {
	const {[field]: _previous, ...rest} = state.choices[source.id] ?? {};
	state.choices[source.id] =
		value === undefined ? rest : {...rest, [field]: value};
}

export function parseSiteSourcesState(raw: unknown): SiteSourcesState {
	const saved = isRecord(raw) && isRecord(raw.sources) ? raw.sources : {};
	const entries = SITE_SOURCES.map((source) => {
		const value = saved[source.id];
		const entry = isRecord(value) ? value : {};
		const notice =
			entry.notice === 'revoked' || entry.notice === 'unreadable'
				? entry.notice
				: undefined;
		return [
			source.id,
			{
				enabled: entry.enabled === true,
				...(notice && {notice}),
				...(entry.pointed === true && {pointed: true}),
			},
		] as const;
	});
	let choices: SiteSourcesState['choices'] = {};
	if (isRecord(raw) && isRecord(raw.choices)) {
		choices = Object.fromEntries(
			Object.entries(raw.choices).filter(
				(entry): entry is [string, Record<string, unknown>] =>
					isRecord(entry[1]),
			),
		);
	} else {
		for (const source of SITE_SOURCES) {
			const value = saved[source.id];
			const entry = isRecord(value) ? value : {};
			if (entry.enabled !== true && entry.notice !== 'revoked') {
				continue;
			}

			const {columnId, keepOffSite} = entry;
			choices[source.id] = {
				...(typeof columnId === 'string' && {columnId}),
				...(keepOffSite === true && {keepOffSite}),
			};
		}
	}

	return {
		sites: Object.fromEntries(entries) as SiteSourcesState['sites'],
		choices,
	};
}

export function siteSourcesValue(state: SiteSourcesState) {
	return {version: 1, sources: state.sites, choices: state.choices};
}

export const withoutNotice = ({
	notice: _notice,
	...entry
}: SiteSourceLocal): SiteSourceLocal => entry;

export function siteSourceStatuses(
	state: SiteSourcesState,
): SiteSourceStatus[] {
	return SITE_SOURCES.map((source) => ({
		id: source.id,
		...state.sites[source.id],
		...sourceChoice(state, source),
	}));
}

export const siteSourceUndoLabel = (source: SiteSource) =>
	`Save from ${source.column.name}`;

export function sourceSavingInto(
	columnId: string,
	columns: ReadonlyArray<Pick<BookmarkColumn, 'id'>>,
	statuses: readonly SiteSourceStatus[],
): SiteSource | undefined {
	const source = siteSourceById(sourceColumnSite(columnId));
	const entry = statuses.find((status) => status.id === source?.id);
	const chosen = entry?.columnId;
	return source &&
		(entry?.wanted || entry?.enabled) &&
		(!chosen ||
			chosen === columnId ||
			columns.every((column) => column.id !== chosen))
		? source
		: undefined;
}
