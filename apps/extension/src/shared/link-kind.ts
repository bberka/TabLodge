/*
What a saved address points to, read from the address alone: a film, a video, a repository, an article. It is worked
out each time a row is drawn and never stored, so old libraries and older apps need nothing, and a better rule reaches
every saved link at once. The extension and the Android app both draw it, as a bookmark's automatic tag (see
bookmark-tags.ts), and image, PDF, and video links also get a mark on their icon.

A site rule wins over a file ending, and an address has at most one kind. Every site in Sources (site-sources.ts) has a
rule for the links it saves; `tests/link-kind.test.ts` checks that.
*/

export type LinkKind =
	| 'movie'
	| 'show'
	| 'video'
	| 'music'
	| 'image'
	| 'pdf'
	| 'repo'
	| 'read'
	| 'docs'
	| 'discussion'
	| 'shop'
	| 'recipe'
	| 'page';

/**
Every kind but `page`, in the order filters and menus list them.
*/
export const LINK_KINDS: ReadonlyArray<Exclude<LinkKind, 'page'>> = [
	'movie',
	'show',
	'video',
	'music',
	'image',
	'pdf',
	'repo',
	'read',
	'docs',
	'discussion',
	'shop',
	'recipe',
];

export const isLinkKind = (
	value: unknown,
): value is Exclude<LinkKind, 'page'> =>
	(LINK_KINDS as readonly unknown[]).includes(value);

/**
The kinds whose links get a mark on their icon, because the link opens a file or a player rather than a page.
*/
export type MediaKind = 'image' | 'pdf' | 'video';

const MEDIA_KINDS: ReadonlySet<LinkKind> = new Set(['image', 'pdf', 'video']);

export const isMediaKind = (kind: LinkKind): kind is MediaKind =>
	MEDIA_KINDS.has(kind);

const EXTENSION_KINDS: Readonly<Record<string, LinkKind>> = {
	jpg: 'image',
	jpeg: 'image',
	png: 'image',
	gif: 'image',
	webp: 'image',
	avif: 'image',
	svg: 'image',
	bmp: 'image',
	pdf: 'pdf',
	mp4: 'video',
	m4v: 'video',
	webm: 'video',
	mov: 'video',
	mkv: 'video',
	ogv: 'video',
	mp3: 'music',
	flac: 'music',
	ogg: 'music',
	opus: 'music',
	m4a: 'music',
	wav: 'music',
};

/**
A site rule: `host` matches the address's host without "www." and "m.", and also its subdomains when it starts with
"*."; `path` is tried on the path. The first rule that matches wins.
*/
type SiteRule = {host: string; path: RegExp; kind: LinkKind};

// Paths on GitHub, GitLab, and Codeberg that are the site's own pages, not an owner.
const FORGE_RESERVED =
	/^\/(?:about|apps|collections|customer-stories|dashboard|enterprise|events|explore|features|groups|help|issues|login|marketplace|new|notifications|orgs|pricing|pulls|search|security|settings|signup|site|sponsors|topics|trending|users)(?:\/|$)/i;
const FORGE_REPO = /^\/[\w\-.]+\/[\w\-.]+(?:\/|$)/;

const SITE_RULES: readonly SiteRule[] = [
	// Films and shows.
	{host: 'imdb.com', path: /^\/(?:[a-z]{2}\/)?title\/tt\d+/, kind: 'movie'},
	{host: 'letterboxd.com', path: /^\/(?:[\w-]+\/)?film\/[\w-]+/, kind: 'movie'},
	{host: 'themoviedb.org', path: /^\/movie\/\d+/, kind: 'movie'},
	{host: 'themoviedb.org', path: /^\/tv\/\d+/, kind: 'show'},
	{host: 'trakt.tv', path: /^\/movies\/[\w-]+/, kind: 'movie'},
	{host: 'trakt.tv', path: /^\/shows\/[\w-]+/, kind: 'show'},
	{host: 'tvmaze.com', path: /^\/shows\/\d+/, kind: 'show'},
	// Music, ahead of YouTube's videos so music.youtube.com is music.
	{host: 'music.youtube.com', path: /^\/(?:watch|playlist)/, kind: 'music'},
	{
		host: 'open.spotify.com',
		path: /^\/(?:intl-[-a-z]+\/)?(?:track|album|playlist|artist)\/\w+/,
		kind: 'music',
	},
	{
		host: 'music.apple.com',
		path: /^\/[a-z]{2}\/(?:album|song|playlist)\//,
		kind: 'music',
	},
	{host: '*.bandcamp.com', path: /^\/(?:track|album)\/[\w-]+/, kind: 'music'},
	{
		host: 'soundcloud.com',
		path: /^\/(?!(?:discover|stream|search|you|upload|charts|pages|settings|people|tags)(?:\/|$))[\w-]+\/(?:sets\/)?[\w-]+\/?$/,
		kind: 'music',
	},
	// Videos.
	{
		host: 'youtube.com',
		path: /^\/(?:watch|shorts\/|embed\/|live\/)/,
		kind: 'video',
	},
	{host: 'youtu.be', path: /^\/[\w-]+/, kind: 'video'},
	{host: 'vimeo.com', path: /^\/\d+/, kind: 'video'},
	{host: 'dailymotion.com', path: /^\/video\//, kind: 'video'},
	{host: 'twitch.tv', path: /^\/videos\//, kind: 'video'},
	{host: 'instagram.com', path: /^\/(?:reels?|tv)\/[\w-]+/, kind: 'video'},
	{host: 'instagram.com', path: /^\/p\/[\w-]+/, kind: 'image'},
	{host: 'i.imgur.com', path: /^\/\w+/, kind: 'image'},
	// Files on sites that serve them at addresses without an ending.
	{host: 'arxiv.org', path: /^\/pdf\//, kind: 'pdf'},
	// Repositories.
	{host: 'github.com', path: FORGE_REPO, kind: 'repo'},
	{host: 'gitlab.com', path: FORGE_REPO, kind: 'repo'},
	{host: 'codeberg.org', path: FORGE_REPO, kind: 'repo'},
	// Discussions.
	{host: 'reddit.com', path: /^\/r\/\w+\/comments\//, kind: 'discussion'},
	{host: 'old.reddit.com', path: /^\/r\/\w+\/comments\//, kind: 'discussion'},
	{host: 'news.ycombinator.com', path: /^\/item$/, kind: 'discussion'},
	{host: 'lobste.rs', path: /^\/s\/\w+/, kind: 'discussion'},
	{
		host: 'stackoverflow.com',
		path: /^\/(?:questions|q)\/\d+/,
		kind: 'discussion',
	},
	{
		host: '*.stackexchange.com',
		path: /^\/(?:questions|q)\/\d+/,
		kind: 'discussion',
	},
	{host: 'superuser.com', path: /^\/questions\/\d+/, kind: 'discussion'},
	{host: 'x.com', path: /^\/\w+\/status\/\d+/, kind: 'discussion'},
	{host: 'twitter.com', path: /^\/\w+\/status\/\d+/, kind: 'discussion'},
	{host: 'mobile.twitter.com', path: /^\/\w+\/status\/\d+/, kind: 'discussion'},
	{host: 'bsky.app', path: /^\/profile\/[^/]+\/post\/\w+/, kind: 'discussion'},
	// Articles and books to read.
	{
		host: 'medium.com',
		path: /^\/(?:p\/\w+|@[^/]+\/[^/]+|[^/@]+\/[^/]+-[\da-f]{8,})/,
		kind: 'read',
	},
	{host: '*.medium.com', path: /^\/[^/]+-[\da-f]{8,}/, kind: 'read'},
	{host: '*.substack.com', path: /^\/p\/[\w-]+/, kind: 'read'},
	{
		host: 'dev.to',
		path: /^\/(?!(?:t|search|settings|enter|top|latest|tags|videos|listings|podcasts|about|faq)\/)[\w-]+\/[\w-]+/,
		kind: 'read',
	},
	{host: 'goodreads.com', path: /^\/book\/show\/\d+/, kind: 'read'},
	// Documentation.
	{
		host: 'developer.mozilla.org',
		path: /^\/[a-z]{2}(?:-[A-Z]{2})?\/docs\//,
		kind: 'docs',
	},
	{host: '*.readthedocs.io', path: /^\//, kind: 'docs'},
	{host: 'docs.rs', path: /^\/[\w-]+/, kind: 'docs'},
	{host: 'pkg.go.dev', path: /^\/[\w\-.]+/, kind: 'docs'},
	// Shops.
	{host: 'ebay.com', path: /^\/itm\//, kind: 'shop'},
	{host: 'etsy.com', path: /^\/(?:[a-z]{2}\/)?listing\/\d+/, kind: 'shop'},
	{host: 'aliexpress.com', path: /^\/item\//, kind: 'shop'},
	{host: 'trendyol.com', path: /-p-\d+/, kind: 'shop'},
	{host: 'hepsiburada.com', path: /-p-\w+/, kind: 'shop'},
	// Recipes.
	{host: 'allrecipes.com', path: /^\/recipe\/\d+/, kind: 'recipe'},
	{host: 'bbcgoodfood.com', path: /^\/recipes\/[\w-]+/, kind: 'recipe'},
	{host: 'cooking.nytimes.com', path: /^\/recipes\/\d+/, kind: 'recipe'},
	{host: 'seriouseats.com', path: /-recipe(?:-\d+)?$/, kind: 'recipe'},
];

// Amazon has a store per country (amazon.de, amazon.co.uk, amazon.com.tr); a product is under /dp/ or /gp/product/.
const AMAZON_HOST =
	/^amazon\.(?:com|ca|de|fr|it|es|nl|se|pl|in|sg|ae|sa|eg|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|com\.be)$/;
const AMAZON_PRODUCT = /\/(?:dp|gp\/product)\/\w{10}(?:[/?]|$)/;

const onRuleHost = (host: string, rule: string) =>
	rule.startsWith('*.')
		? host === rule.slice(2) || host.endsWith(rule.slice(1))
		: host === rule;

function siteKind(host: string, path: string): LinkKind | undefined {
	if (AMAZON_HOST.test(host) && AMAZON_PRODUCT.test(path)) {
		return 'shop';
	}

	// Documentation sites that live on a docs. subdomain, such as docs.python.org or docs.github.com; Google Docs
	// holds documents, not documentation.
	if (host.startsWith('docs.') && host !== 'docs.google.com') {
		return 'docs';
	}

	for (const rule of SITE_RULES) {
		if (
			onRuleHost(host, rule.host) &&
			rule.path.test(path) &&
			!(rule.path === FORGE_REPO && FORGE_RESERVED.test(path))
		) {
			return rule.kind;
		}
	}

	return undefined;
}

export function linkKind(address: string): LinkKind {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return 'page';
	}

	// Data and blob addresses are never saved, and say nothing a name could be read from.
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return 'page';
	}

	const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
	const site = siteKind(host, url.pathname);
	if (site) {
		return site;
	}

	// Only the last path segment counts: a query such as ?file=photo.jpg belongs to a page.
	const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0
		? (EXTENSION_KINDS[name.slice(dot + 1).toLowerCase()] ?? 'page')
		: 'page';
}

/**
The word a screen reader says for a kind, or nothing for a page.
*/
export const LINK_KIND_LABELS: Readonly<Record<LinkKind, string>> = {
	movie: 'Movie',
	show: 'Show',
	video: 'Video',
	music: 'Music',
	image: 'Image',
	pdf: 'PDF',
	repo: 'Repository',
	read: 'Article',
	docs: 'Documentation',
	discussion: 'Discussion',
	shop: 'Product',
	recipe: 'Recipe',
	page: '',
};
