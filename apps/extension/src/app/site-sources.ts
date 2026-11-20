// Sites whose own save TabLodge can follow (Settings › Sources): the user saves a link on the site, and the same
// link lands in that site's bookmark column. Each site is off until the user adds it in Settings, which asks for an
// optional host permission for that site only; the content script is registered only while it is granted. A new
// site is an entry here plus its adapter in shell/site-source.ts; Settings lists it in Add a site by itself.
// The manifest's optional_host_permissions must list exactly the origins here (tests/site-sources.test.ts).
import {isRecord} from '../shared/library-values';
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
	The site's source column, which takes the links unless Settings picks another, created on the first save.
	*/
	column: SourceColumnLook & {id: string};
	/**
	Match patterns for the optional host permission and the registered content script.
	*/
	origins: string[];
	/**
	Host names the content script reads on; `*.example.com` stands for any subdomain of example.com.
	*/
	hosts: string[];
	/**
	The sites (`domains`) the source column starts with when a save creates it, so a page there saved by hand goes to it too.
	*/
	columnSites: string[];
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
	/**
	The site's save control loads another page (Hacker News' favorite link), so the result of a save is kept for
	the next page in the tab to show.
	*/
	saveLoadsPage?: true;
	/**
	The adapter can tell a save before the site handles it, so Settings offers Save to TabLodge only for this site:
	the content script stops the click on the site's save control and saves the link to TabLodge alone (#296).
	*/
	keepOffSite?: true;
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
const BLUESKY_POST =
	/^\/profile\/([\w\-.:]{1,253})\/post\/([\da-z]{1,32})\/?$/i;
// First path segments that are SoundCloud's own pages, not an artist.
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
// A Medium post ends in its 12 hex character id: /<slug>-<id>, /@user/<slug>-<id>, /p/<id>.
const MEDIUM_POST = /(?:^\/p\/|-)([\da-f]{12})\/?$/;
const SUBSTACK_POST = /^\/(?:p\/[\w-]{1,200}|home\/post\/p-\d{1,15})\/?$/;

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

/**
Whether an https address is on one of the hosts, where `*.example.com` also takes example.com's subdomains.
*/
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

/**
A post as `https://bsky.app/profile/<handle>/post/<id>`.
*/
export function blueskyPostUrl(href: string): string | null {
	const url = parse(href, 'https://bsky.app/');
	const match = onHost(url, 'bsky.app')
		? BLUESKY_POST.exec(url.pathname)
		: null;
	return match ? `https://bsky.app/profile/${match[1]}/post/${match[2]}` : null;
}

/**
A track as `https://soundcloud.com/<artist>/<track>`, or a playlist as `https://soundcloud.com/<artist>/sets/<name>`.
*/
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

/**
A track, album, playlist, episode, show, or artist as `https://open.spotify.com/<kind>/<id>`, without the
language prefix or share parameters.
*/
export function spotifyItemUrl(href: string): string | null {
	const url = parse(href, 'https://open.spotify.com/');
	const match = onHost(url, 'open.spotify.com')
		? SPOTIFY_ITEM.exec(url.pathname)
		: null;
	return match ? `https://open.spotify.com/${match[1]}/${match[2]}` : null;
}

/**
A film as `https://letterboxd.com/film/<slug>/`, also from a member's page for it.
*/
export function letterboxdFilmUrl(href: string): string | null {
	const url = parse(href, 'https://letterboxd.com/');
	const match = onHost(url, 'letterboxd.com')
		? LETTERBOXD_FILM.exec(url.pathname)
		: null;
	return match ? `https://letterboxd.com/film/${match[1]}/` : null;
}

/**
A film or show as `https://www.imdb.com/title/<id>/`.
*/
export function imdbTitleUrl(href: string): string | null {
	const url = parse(href, 'https://www.imdb.com/');
	const match = onHost(url, 'www.imdb.com', 'm.imdb.com')
		? IMDB_TITLE.exec(url.pathname)
		: null;
	return match ? `https://www.imdb.com/title/${match[1]}/` : null;
}

/**
A book as `https://www.goodreads.com/book/show/<id>`; the slug after the id varies, so it is dropped.
*/
export function goodreadsBookUrl(href: string): string | null {
	const url = parse(href, 'https://www.goodreads.com/');
	const match = onHost(url, 'www.goodreads.com')
		? GOODREADS_BOOK.exec(url.pathname)
		: null;
	return match ? `https://www.goodreads.com/book/show/${match[1]}` : null;
}

/**
A post as `https://medium.com/p/<id>`, which Medium redirects to the post wherever it is published, so one post
read on medium.com and on a publication's subdomain is the same address.
*/
export function mediumPostUrl(href: string): string | null {
	const url = parse(href, 'https://medium.com/');
	const match = onHost(url, 'medium.com', '*.medium.com')
		? MEDIUM_POST.exec(url.pathname)
		: null;
	return match ? `https://medium.com/p/${match[1]}` : null;
}

/**
A post on substack.com or a publication's substack.com subdomain, without its query. A relative link is read
against `base`, the page it is on.
*/
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
	},
];

export const SITE_SOURCES: readonly SiteSource[] = SITES.map((site) => ({
	...site,
	column: {...SOURCE_COLUMNS[site.id], id: sourceColumnId(site.id)},
}));

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
	return SITE_SOURCES.find((source) => onHost(url, ...source.hosts));
}

/**
Outside the library, in chrome.storage.local unprefixed: the permission and the registered script belong to the
browser, not to a library. Two parts:

	sources  per browser, never synced: whether the site runs here, why it went off or stopped saving, and whether
	         the dashboard already pointed to a site that is on in another browser
	choices  the user's choices, synced as `source` records (docs/adr/0008-sources-settings-sync.md): one entry per
	         site that is on, holding its column and save mode. Kept as they arrived, so a site or a field this
	         version does not know goes back to the server unchanged.

A site runs here only while it has a choice and this browser grants its permission.
*/
export const SITE_SOURCES_KEY = 'tablodge.sources';

type SiteSourceLocal = {
	enabled: boolean;
	notice?: SiteSourceNotice;
	/**
	The dashboard showed that the site is on in another browser.
	*/
	pointed?: true;
};
export type SiteSourcesState = {
	sites: Record<SiteSourceId, SiteSourceLocal>;
	choices: Record<string, Record<string, unknown>>;
};

/**
A site's synced choices as this version reads them. `wanted`: the site is on, in this browser or another.
*/
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

/**
The choice with `field` set to `value`, or removed when `value` is undefined; the other fields stay as they are.
*/
/**
Stores a site's choices as they came. A computed key, so an id such as `__proto__` stays an ordinary key.
*/
export function putChoice(
	state: SiteSourcesState,
	id: string,
	value: Record<string, unknown>,
) {
	state.choices = {...state.choices, [id]: value};
}

/**
Removes a site's choices: the site is off in every browser.
*/
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
		// Built with fromEntries, so an id such as `__proto__` stays an ordinary key.
		choices = Object.fromEntries(
			Object.entries(raw.choices).filter(
				(entry): entry is [string, Record<string, unknown>] =>
					isRecord(entry[1]),
			),
		);
	} else {
		// Stored before choices synced: a site that was on, or went off when its access was revoked, keeps them.
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

/**
The local part of a site's entry without its notice.
*/
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

/**
Labels of the Undo steps source saves create; the page may only undo those.
*/
export const siteSourceUndoLabel = (source: SiteSource) =>
	`Save from ${source.column.name}`;

/**
The site whose saves on this device go into a column, so deleting that column asks whether to stop them too: its
source column, while the site is on and Settings picks no other column that still exists.
*/
export function sourceSavingInto(
	columnId: string,
	columns: ReadonlyArray<Pick<BookmarkColumn, 'id'>>,
	statuses: readonly SiteSourceStatus[],
): SiteSource | undefined {
	const source = siteSourceById(sourceColumnSite(columnId));
	const entry = statuses.find((status) => status.id === source?.id);
	const chosen = entry?.columnId;
	return source &&
		entry?.enabled &&
		(!chosen ||
			chosen === columnId ||
			columns.every((column) => column.id !== chosen))
		? source
		: undefined;
}
