import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseHTML} from 'linkedom';
import {test} from 'vite-plus/test';
import {manifestForTarget} from '../scripts/manifest-targets';
import {isColumnColor} from '../src/shared/accent-colors';
import {columnForUrl, domainsField} from '../src/shared/column-sites';
import {ICON_IDS} from '../src/shared/icon-ids';
import {
	blueskyPostUrl,
	devtoArticleUrl,
	goodreadsBookUrl,
	imdbTitleUrl,
	letterboxdFilmUrl,
	mediumPostUrl,
	soundcloudItemUrl,
	spotifyItemUrl,
	substackPostUrl,
	githubRepoUrl,
	hackerNewsItemUrl,
	instagramPostUrl,
	lobstersStoryUrl,
	parseSiteSourcesState,
	putChoice,
	redditPermalinkUrl,
	SITE_SOURCES,
	siteSourceById,
	siteSourceForUrl,
	siteSourcesValue,
	siteSourceStatuses,
	sourceChoice,
	sourceSavingInto,
	withChoice,
	stackOverflowQuestionUrl,
	xPostUrl,
	youtubeVideoUrl,
} from '../src/app/site-sources';
import {createBlueskyReader} from '../src/app/source-bluesky';
import {createDevtoReader} from '../src/app/source-devto';
import {createGoodreadsReader} from '../src/app/source-goodreads';
import {createImdbReader} from '../src/app/source-imdb';
import {createLetterboxdReader} from '../src/app/source-letterboxd';
import {createMediumReader} from '../src/app/source-medium';
import {createSoundcloudReader} from '../src/app/source-soundcloud';
import {createSpotifyReader} from '../src/app/source-spotify';
import {createSubstackReader} from '../src/app/source-substack';
import {createGithubReader} from '../src/app/source-github';
import {createHackerNewsReader} from '../src/app/source-hackernews';
import {createInstagramReader} from '../src/app/source-instagram';
import {createLobstersReader} from '../src/app/source-lobsters';
import {
	excerpt,
	type SourceRead,
	type SourceReader,
} from '../src/app/source-reader';
import {
	createRedditReader,
	readRedditSavedPage,
} from '../src/app/source-reddit';
import {
	catchUpAsks,
	catchUpCountText,
	dismissMissing,
	parseCatchUpState,
} from '../src/app/source-catch-up';
import {
	type KeptSave,
	listenForSaves,
	settleKeptSave,
} from '../src/app/source-keep-off';
import {createStackOverflowReader} from '../src/app/source-stackoverflow';
import {createTwitterReader} from '../src/app/source-x';
import {createYoutubeReader} from '../src/app/source-youtube';
import {
	TOAST_TOKENS,
	toastAppearance,
	toastColors,
} from '../src/app/source-toast';

const fixture = (name: string) =>
	readFileSync(
		join(import.meta.dirname, 'fixtures', 'site-sources', name),
		'utf8',
	);

/**
A parsed fixture at `url`: linkedom has no address of its own, and the YouTube reader reads the watched video from it.
*/
function load(name: string, url: string) {
	const {window, document} = parseHTML(fixture(name));
	Object.defineProperty(document, 'location', {value: new URL(url)});
	return {window, document};
}

/**
A fixture page at `url` with a reader listening the way the content script does: on the window, in the capture
phase. `click(id)` clicks an element and returns what the reader made of it.
*/
function page(
	name: string,
	url: string,
	reader: (document: Document) => SourceReader,
) {
	const {window, document} = load(name, url);
	const read = reader(document);
	let last: SourceRead;
	window.addEventListener(
		'click',
		(event) => {
			last = read(event);
		},
		{capture: true},
	);
	const element = (id: string) => {
		const found = document.querySelector<HTMLElement>(`#${id}`);
		assert.ok(found, `fixture has #${id}`);
		return found;
	};

	return {
		document,
		element,
		click(id: string): SourceRead {
			last = undefined;
			// An svg element has no click(); a real click on an icon still reaches the window.
			element(id).dispatchEvent(new window.Event('click', {bubbles: true}));
			return last;
		},
	};
}

const youtube = (name: string, url = 'https://www.youtube.com/') =>
	page(name, url, (document) => createYoutubeReader(document));
const reddit = (name: string, url = 'https://www.reddit.com/') =>
	page(name, url, () => createRedditReader());
const x = (name: string, url = 'https://x.com/home') =>
	page(name, url, (document) => createTwitterReader(document));
const instagram = (name: string, url = 'https://www.instagram.com/') =>
	page(name, url, (document) => createInstagramReader(document));

test('the manifest asks for exactly the sources origins, optionally, with no content scripts', () => {
	const manifest = JSON.parse(
		readFileSync(
			join(import.meta.dirname, '..', 'shell', 'manifest.json'),
			'utf8',
		),
	) as Record<string, unknown>;
	const origins = SITE_SOURCES.flatMap((source) => source.origins);
	for (const target of ['chrome', 'firefox'] as const) {
		const built = manifestForTarget(manifest, target);
		assert.deepEqual(built.optional_host_permissions, origins, target);
		assert.equal(built.host_permissions, undefined, target);
		assert.equal(built.content_scripts, undefined, target);
	}
});

test('each source column gets an icon and a color a column can hold', () => {
	for (const source of SITE_SOURCES) {
		assert.ok(ICON_IDS.includes(source.column.icon), source.id);
		assert.ok(isColumnColor(source.column.color), source.id);
	}
});

test("each source column's sites are valid and claim every host its source reads on", () => {
	for (const source of SITE_SOURCES) {
		assert.deepEqual(
			domainsField(source.columnSites).domains,
			source.columnSites,
			source.id,
		);
		const column = {
			id: source.column.id,
			name: source.column.name,
			domains: source.columnSites,
			createdAt: 0,
			isDefault: false,
		};
		for (const host of source.hosts) {
			const address = `https://${host.replace('*.', 'someone.')}/page`;
			assert.equal(columnForUrl([column], address)?.id, column.id, address);
		}
	}
});

test('the in-page toast uses the same tokens as the extension stylesheet', () => {
	const css = readFileSync(
		join(import.meta.dirname, '..', 'styles', 'extension-app.css'),
		'utf8',
	);
	const block = (selector: string) => {
		const start = css.indexOf(`${selector} {`);
		assert.notEqual(start, -1, selector);
		return css.slice(start, css.indexOf('}', start));
	};

	const value = (text: string, name: string) =>
		new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(text)?.[1]?.trim();
	const light = block('\t:root');
	const dark = block(":root[data-theme='dark']");
	const names = {
		popover: 'popover',
		popoverForeground: 'popover-foreground',
		border: 'border',
		destructive: 'destructive',
	} as const;
	for (const [key, name] of Object.entries(names) as Array<
		[keyof typeof names, string]
	>) {
		assert.equal(TOAST_TOKENS.light[key], value(light, name), name);
		assert.equal(TOAST_TOKENS.dark[key], value(dark, name), name);
	}

	assert.equal(TOAST_TOKENS.light.primary, value(light, 'brand-primary-light'));
	assert.equal(TOAST_TOKENS.dark.primary, value(light, 'brand-primary-dark'));
	const radius = value(light, 'radius') ?? '';
	assert.match(radius, /^\d+(?:\.\d+)?rem$/);
	assert.equal(TOAST_TOKENS.radius, `${Number.parseFloat(radius) * 16}px`);
});

// WCAG contrast between two `rgb(r g b)` colors.
function contrast(...colors: string[]) {
	const [high, low] = colors
		.map((color) => {
			const channels = (/\d+ \d+ \d+/.exec(color)?.[0] ?? '')
				.split(' ')
				.map((value) => {
					const channel = Number(value) / 255;
					return channel <= 0.03928
						? channel / 12.92
						: ((channel + 0.055) / 1.055) ** 2.4;
				});
			return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
		})
		.toSorted((a, b) => b - a);
	return (high + 0.05) / (low + 0.05);
}

test('the in-page toast follows the theme and accent chosen in Settings', () => {
	const os = {systemDark: true, incognito: false};
	const incognito = {...os, incognito: true};
	assert.deepEqual(toastAppearance({}, os), {theme: 'dark', accent: 'default'});
	assert.deepEqual(toastAppearance({uiTheme: 'light', uiAccent: 'green'}, os), {
		theme: 'light',
		accent: 'green',
	});
	assert.deepEqual(
		toastAppearance(
			{uiTheme: 'sepia', uiAccent: 'url(x)'},
			{...os, systemDark: false},
		),
		{theme: 'light', accent: 'default'},
	);
	// A private window shows its own accent, or the regular one when it is set to the same.
	const config = (accent: string) => ({'tablodge.private.config': {accent}});
	assert.equal(
		toastAppearance({uiAccent: 'green', ...config('rose')}, incognito).accent,
		'rose',
	);
	assert.equal(
		toastAppearance({uiAccent: 'green', ...config('same')}, incognito).accent,
		'green',
	);
	assert.equal(
		toastAppearance({uiAccent: 'green', ...config('rose')}, os).accent,
		'green',
	);
	assert.equal(toastAppearance({uiAccent: 'green'}, incognito).accent, 'teal');

	assert.deepEqual(toastColors('light', undefined), {
		background: 'rgb(255 255 255)',
		text: 'rgb(24 24 27)',
		border: 'rgb(228 228 231)',
		errorBorder: 'rgb(220 38 38 / 0.4)',
		destructive: 'rgb(220 38 38)',
		primary: 'rgb(98 84 215)',
	});
	assert.equal(toastColors('dark', [21, 128, 61]).background, 'rgb(17 17 20)');
	// These grays read on the dark page but not on the toast's lighter background, so they are lifted to 4.5:1.
	for (const gray of [121, 122]) {
		const colors = toastColors('dark', [gray, gray, gray]);
		assert.ok(
			contrast(colors.primary, colors.background) >= 4.5,
			colors.primary,
		);
	}

	// Amber is too light to read on the light page, so it darkens there, as the pages' accent does.
	assert.notEqual(
		toastColors('light', [217, 119, 6]).primary,
		'rgb(217 119 6)',
	);
});

test('a source is found only on its own https hosts', () => {
	assert.equal(
		siteSourceForUrl('https://www.youtube.com/watch?v=x')?.id,
		'youtube',
	);
	assert.equal(siteSourceForUrl('https://old.reddit.com/r/a/')?.id, 'reddit');
	assert.equal(siteSourceForUrl('https://twitter.com/a/status/1')?.id, 'x');
	assert.equal(siteSourceForUrl('https://x.com/home')?.id, 'x');
	assert.equal(siteSourceForUrl('https://www.instagram.com/')?.id, 'instagram');
	assert.equal(
		siteSourceForUrl('https://instagram.com.example.org/'),
		undefined,
	);
	assert.equal(siteSourceForUrl('wss://www.youtube.com/'), undefined);
	assert.equal(siteSourceForUrl('https://youtube.com.example.org/'), undefined);
	assert.equal(siteSourceForUrl(undefined), undefined);
});

test('videos are stored as one watch address, whatever link they came from', () => {
	const canonical = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
	for (const href of [
		'/watch?v=dQw4w9WgXcQ&list=WL&index=3&t=42s',
		'https://www.youtube.com/shorts/dQw4w9WgXcQ',
		'https://youtu.be/dQw4w9WgXcQ',
		'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
	]) {
		assert.equal(youtubeVideoUrl(href), canonical, href);
	}

	assert.equal(youtubeVideoUrl('/watch?v=short'), null);
	assert.equal(youtubeVideoUrl('/playlist?list=WL'), null);
	assert.equal(
		youtubeVideoUrl('https://example.com/watch?v=dQw4w9WgXcQ'),
		null,
	);
});

test('posts and comments from both Reddit interfaces get the same address', () => {
	assert.equal(
		redditPermalinkUrl(
			'https://old.reddit.com/r/typescript/comments/1abcde/strict_mode_tips',
		),
		'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
	);
	assert.equal(
		redditPermalinkUrl(
			'/r/typescript/comments/1abcde/strict_mode_tips/xyz789/?context=3',
		),
		'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/xyz789/',
	);
	assert.equal(redditPermalinkUrl('/r/typescript/'), null);
	assert.equal(
		redditPermalinkUrl('https://example.com/r/a/comments/b/c/'),
		null,
	);
});

test('X posts get one x.com address, from twitter.com and from the pages under a post', () => {
	const canonical = 'https://x.com/alice/status/1850000000000000001';
	for (const href of [
		'/alice/status/1850000000000000001',
		'https://twitter.com/alice/status/1850000000000000001',
		'https://mobile.twitter.com/alice/status/1850000000000000001?s=20',
		'https://x.com/alice/status/1850000000000000001/photo/1',
	]) {
		assert.equal(xPostUrl(href), canonical, href);
	}

	assert.equal(xPostUrl('/alice'), null);
	assert.equal(xPostUrl('/alice/status/abc'), null);
	assert.equal(xPostUrl('https://example.com/alice/status/1'), null);
});

test('Instagram posts and reels get one address each, also when linked under the author', () => {
	assert.equal(
		instagramPostUrl('/natgeo/p/C1a2B3c4D5e/?img_index=2'),
		'https://www.instagram.com/p/C1a2B3c4D5e/',
	);
	assert.equal(
		instagramPostUrl('https://instagram.com/p/C1a2B3c4D5e/comments/'),
		'https://www.instagram.com/p/C1a2B3c4D5e/',
	);
	for (const href of [
		'/reel/C9x8Y7w6V5u',
		'/reels/C9x8Y7w6V5u/',
		'/nasa/reel/C9x8Y7w6V5u/',
	]) {
		assert.equal(
			instagramPostUrl(href),
			'https://www.instagram.com/reel/C9x8Y7w6V5u/',
			href,
		);
	}

	assert.equal(instagramPostUrl('/natgeo/'), null);
	assert.equal(instagramPostUrl('/explore/'), null);
	assert.equal(instagramPostUrl('https://example.com/p/C1a2B3c4D5e/'), null);
});

test('a long post text is cut at a word near 100 characters', () => {
	assert.equal(excerpt('  Short  text '), 'Short text');
	const cut = excerpt(`${'word '.repeat(30)}end`);
	assert.ok(cut.length <= 101, cut);
	assert.match(cut, /^word( word)+…$/);
});

test('stored source state is read defensively: off unless saved as on', () => {
	const off = parseSiteSourcesState(undefined);
	assert.deepEqual(off.choices, {});
	assert.equal(Object.keys(off.sites).length, SITE_SOURCES.length);
	assert.ok(Object.values(off.sites).every((entry) => !entry.enabled));
	const state = parseSiteSourcesState({
		version: 1,
		sources: {
			youtube: {enabled: true, notice: 'unreadable', pointed: true},
			reddit: {enabled: 'yes', notice: 'other'},
			extra: {enabled: true},
		},
		choices: {youtube: {}, mastodon: {columnId: 'c', later: 1}, bad: 'x'},
	});
	assert.deepEqual(state.sites.youtube, {
		enabled: true,
		notice: 'unreadable',
		pointed: true,
	});
	assert.deepEqual(state.sites.reddit, {enabled: false});
	assert.equal('extra' in state.sites, false);
	// Choices are kept as they came, sites this version does not know included, so they sync back unchanged.
	assert.deepEqual(state.choices, {
		youtube: {},
		mastodon: {columnId: 'c', later: 1},
	});
});

test('a site id such as __proto__ from the server stays an ordinary choice', () => {
	const state = parseSiteSourcesState(
		JSON.parse('{"version":1,"choices":{"__proto__":{"x":1}}}'),
	);
	assert.deepEqual(Object.keys(state.choices), ['__proto__']);
	assert.equal(Object.getPrototypeOf(state.choices), Object.prototype);
	putChoice(state, '__proto__', {y: 2});
	assert.deepEqual(Object.keys(state.choices), ['__proto__']);
	assert.equal(Object.getPrototypeOf(state.choices), Object.prototype);
});

test('state stored before choices synced is read once into choices', () => {
	const state = parseSiteSourcesState({
		version: 1,
		sources: {
			youtube: {enabled: true, columnId: 'mine'},
			x: {enabled: false, notice: 'revoked', keepOffSite: true},
			github: {enabled: false, columnId: 'kept-while-off'},
		},
	});
	assert.deepEqual(state.choices, {
		youtube: {columnId: 'mine'},
		x: {keepOffSite: true},
	});
	assert.deepEqual(siteSourcesValue(state).choices, state.choices);
});

test('a site is on while it has a choice, and runs here only while enabled here', () => {
	const state = parseSiteSourcesState({
		version: 1,
		sources: {reddit: {enabled: true}},
		choices: {
			reddit: {columnId: 'mine', keepOffSite: true},
			youtube: {keepOffSite: true, columnId: 'x'.repeat(201)},
		},
	});
	const statuses = siteSourceStatuses(state);
	assert.deepEqual(
		statuses.find(({id}) => id === 'reddit'),
		{
			id: 'reddit',
			enabled: true,
			wanted: true,
			columnId: 'mine',
			keepOffSite: true,
		},
	);
	// On in another browser: wanted, not enabled here. A save mode the site does not have is not read.
	assert.deepEqual(
		statuses.find(({id}) => id === 'youtube'),
		{id: 'youtube', enabled: false, wanted: true},
	);
	assert.deepEqual(
		statuses.find(({id}) => id === 'x'),
		{id: 'x', enabled: false, wanted: false},
	);
	// Changing one field keeps the others as stored.
	const youtubeSource = siteSourceById('youtube')!;
	withChoice(state, youtubeSource, 'columnId', 'picked');
	assert.deepEqual(state.choices.youtube, {
		keepOffSite: true,
		columnId: 'picked',
	});
	withChoice(state, youtubeSource, 'columnId', undefined);
	assert.deepEqual(state.choices.youtube, {keepOffSite: true});
	assert.deepEqual(sourceChoice(state, youtubeSource), {wanted: true});
});

test('YouTube: the Watch later button on a thumbnail saves that video', () => {
	const site = youtube('youtube-home.html');
	assert.deepEqual(site.click('watch-later'), {
		kind: 'save',
		link: {
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			title: 'Never Gonna Give You Up',
		},
	});
	assert.deepEqual(site.click('lockup-watch-later'), {
		kind: 'save',
		link: {
			url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
			title: 'Despacito',
		},
	});
});

test('YouTube: removing from Watch later and other controls save nothing', () => {
	const site = youtube('youtube-home.html');
	assert.equal(site.click('added'), undefined);
	assert.equal(site.click('menu-button'), undefined);
	assert.equal(site.click('menu-queue'), undefined);
});

test('YouTube: "Save to Watch later" in a menu saves the video the menu opened from', () => {
	const site = youtube('youtube-home.html');
	site.click('menu-button');
	assert.deepEqual(site.click('menu-watch-later'), {
		kind: 'save',
		link: {
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			title: 'Never Gonna Give You Up',
		},
	});
});

test('YouTube: a menu save with no known video, or a changed thumbnail, is unreadable', () => {
	assert.deepEqual(youtube('youtube-home.html').click('menu-watch-later'), {
		kind: 'unreadable',
	});
	assert.deepEqual(youtube('youtube-home.html').click('changed-watch-later'), {
		kind: 'unreadable',
	});
});

test('YouTube: the menu context expires, so an old click is never matched to a later save', () => {
	let now = 0;
	const {window, document} = load(
		'youtube-home.html',
		'https://www.youtube.com/',
	);
	const read = createYoutubeReader(document, () => now);
	const results: SourceRead[] = [];
	window.addEventListener(
		'click',
		(event) => {
			results.push(read(event));
		},
		{capture: true},
	);
	document.querySelector<HTMLElement>('#menu-button')!.click();
	now = 61_000;
	document.querySelector<HTMLElement>('#menu-watch-later')!.click();
	assert.deepEqual(results.at(-1), {kind: 'unreadable'});
});

test('YouTube: ticking Watch later in the Save dialog saves the watched video', () => {
	const site = youtube(
		'youtube-watch.html',
		'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=10s',
	);
	site.click('save-button');
	assert.deepEqual(site.click('option-watch-later'), {
		kind: 'save',
		link: {
			url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
			title: 'Big Buck Bunny',
		},
	});
	assert.equal(site.click('option-other'), undefined);
});

test('YouTube: the Save dialog opened from a related video saves that video', () => {
	const site = youtube(
		'youtube-watch.html',
		'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
	);
	site.click('related-menu');
	assert.deepEqual(site.click('option-watch-later'), {
		kind: 'save',
		link: {
			url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
			title: 'Me at the zoo',
		},
	});
});

test('YouTube: unticking Watch later in the Save dialog saves nothing', () => {
	const site = youtube(
		'youtube-watch.html',
		'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
	);
	site
		.element('option-watch-later')
		.querySelector(':scope [role="checkbox"]')!
		.setAttribute('aria-checked', 'true');
	site.click('save-button');
	assert.equal(site.click('option-watch-later'), undefined);
});

test('Reddit: Save in a post or comment menu saves its permalink', () => {
	const site = reddit('reddit-new.html');
	assert.deepEqual(site.click('post-save'), {
		kind: 'save',
		link: {
			url: 'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
			title: 'Strict mode tips',
		},
	});
	assert.deepEqual(site.click('comment-save'), {
		kind: 'save',
		link: {
			url: 'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/xyz789/',
			title: 'Comment by u/carol',
		},
	});
});

test('Reddit: unsaving and other Save buttons save nothing', () => {
	const site = reddit('reddit-new.html');
	assert.equal(site.click('post-unsave'), undefined);
	assert.equal(site.click('comment-editor-save'), undefined);
});

test('Reddit: a menu drawn outside the post saves the post whose menu was opened', () => {
	const site = reddit('reddit-new.html');
	site.click('post-overflow');
	assert.equal(
		(site.click('floating-save') as {link: {url: string}}).link.url,
		'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
	);
	assert.deepEqual(reddit('reddit-new.html').click('floating-save'), {
		kind: 'unreadable',
	});
});

test('Reddit: a post without its permalink is unreadable', () => {
	assert.deepEqual(reddit('reddit-new.html').click('broken-save'), {
		kind: 'unreadable',
	});
});

test('Reddit: Save inside the overflow menu shadow root is still found', () => {
	const site = reddit('reddit-new.html');
	const menu = site
		.element('t3_1abcde')
		.querySelector(':scope shreddit-post-overflow-menu')!;
	const root = menu.attachShadow({mode: 'open'});
	const item = site.document.createElement('li');
	item.setAttribute('role', 'menuitem');
	item.textContent = 'Save';
	root.append(item);
	// The browser's composed path for a click inside the shadow root: the item, the root, then the host's ancestors.
	const path: EventTarget[] = [item, root];
	for (let node: Element | null = menu; node; node = node.parentElement) {
		path.push(node);
	}

	const found = createRedditReader()({
		composedPath: () => path,
	} as unknown as Event);
	assert.equal(
		(found as {link: {url: string}} | undefined)?.link.url,
		'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
	);
});

test('old Reddit: the save link of a post or comment saves its permalink', () => {
	const site = reddit(
		'reddit-old.html',
		'https://old.reddit.com/r/typescript/',
	);
	assert.deepEqual(site.click('post-save'), {
		kind: 'save',
		link: {
			url: 'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
			title: 'Strict mode tips',
		},
	});
	assert.deepEqual(site.click('comment-save'), {
		kind: 'save',
		link: {
			url: 'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/xyz789/',
			title: 'Comment by u/carol',
		},
	});
	assert.equal(site.click('post-unsave'), undefined);
	assert.deepEqual(site.click('broken-save'), {kind: 'unreadable'});
});

test('X: Bookmark on a post saves it, titled with the start of its text', () => {
	const site = x('x-home.html');
	const found = site.click('bookmark-icon') as {
		kind: string;
		link: {url: string; title: string};
	};
	assert.equal(found.kind, 'save');
	assert.equal(
		found.link.url,
		'https://x.com/alice/status/1850000000000000001',
	);
	assert.match(found.link.title, /^Local first software keeps working .*…$/);
	assert.ok(found.link.title.length <= 101);
});

test('X: a quoting post saves itself, not the post it quotes', () => {
	assert.deepEqual(x('x-home.html').click('quote-bookmark'), {
		kind: 'save',
		link: {
			url: 'https://x.com/carol/status/1850000000000000003',
			title: 'This, exactly.',
		},
	});
});

test('X: a post with no text is titled by its author', () => {
	assert.deepEqual(x('x-home.html').click('image-bookmark'), {
		kind: 'save',
		link: {
			url: 'https://x.com/erin/status/1850000000000000004',
			title: 'Post by @erin',
		},
	});
});

test('X: removing a bookmark and other controls save nothing', () => {
	const site = x('x-home.html');
	assert.equal(site.click('remove-bookmark'), undefined);
	assert.equal(site.click('share'), undefined);
	assert.equal(site.click('menu-copy'), undefined);
	site.click('share');
	assert.equal(site.click('menu-remove-bookmark'), undefined);
});

test('X: Bookmark in the Share menu saves the post the menu opened from', () => {
	const site = x('x-home.html');
	site.click('share');
	assert.equal(
		(site.click('menu-bookmark') as {link: {url: string}}).link.url,
		'https://x.com/alice/status/1850000000000000001',
	);
	assert.deepEqual(x('x-home.html').click('menu-bookmark'), {
		kind: 'unreadable',
	});
});

test('X: a post whose timestamp is no longer a link is unreadable', () => {
	assert.deepEqual(x('x-home.html').click('changed-bookmark'), {
		kind: 'unreadable',
	});
});

test('X: on a post page, the post and a reply each save themselves', () => {
	const site = x(
		'x-status.html',
		'https://x.com/grace/status/1850000000000000010',
	);
	assert.deepEqual(site.click('focal-bookmark'), {
		kind: 'save',
		link: {
			url: 'https://x.com/grace/status/1850000000000000010',
			title: 'Shipping the release today.',
		},
	});
	assert.equal(
		(site.click('reply-bookmark') as {link: {url: string}}).link.url,
		'https://x.com/heidi/status/1850000000000000011',
	);
});

test('X: Bookmark in the photo viewer saves the post at its address, and only there', () => {
	assert.deepEqual(
		x(
			'x-status.html',
			'https://x.com/grace/status/1850000000000000010/photo/1',
		).click('viewer-bookmark'),
		{
			kind: 'save',
			link: {
				url: 'https://x.com/grace/status/1850000000000000010',
				title: 'Post by @grace',
			},
		},
	);
	assert.deepEqual(
		x('x-status.html', 'https://x.com/grace/status/1850000000000000010').click(
			'viewer-bookmark',
		),
		{kind: 'unreadable'},
	);
});

test('Instagram: Save on a feed post saves it, wherever on the icon the click lands', () => {
	const expected = {
		kind: 'save',
		link: {
			url: 'https://www.instagram.com/p/C1a2B3c4D5e/',
			title:
				'A snow leopard crosses a ridge in the Himalayas at dawn, photographed over three winters of patient…',
		},
	};
	for (const id of ['save', 'save-icon', 'save-shape']) {
		assert.deepEqual(instagram('instagram-feed.html').click(id), expected, id);
	}
});

test('Instagram: Save on a reel saves the reel, titled as one when it has no caption', () => {
	assert.deepEqual(instagram('instagram-feed.html').click('reel-save'), {
		kind: 'save',
		link: {
			url: 'https://www.instagram.com/reel/C9x8Y7w6V5u/',
			title: 'Instagram reel',
		},
	});
});

test('Instagram: un-saving and other Save buttons save nothing', () => {
	const site = instagram('instagram-feed.html');
	assert.equal(site.click('remove'), undefined);
	assert.equal(site.click('text-save'), undefined);
});

test('Instagram: a post without its link is unreadable', () => {
	assert.deepEqual(instagram('instagram-feed.html').click('changed-save'), {
		kind: 'unreadable',
	});
});

test('Instagram: a post in a dialog or on its own page saves the post at the address', () => {
	assert.deepEqual(
		instagram(
			'instagram-post.html',
			'https://www.instagram.com/p/Cdialog1234/',
		).click('dialog-save'),
		{
			kind: 'save',
			link: {
				url: 'https://www.instagram.com/p/Cdialog1234/',
				title: 'Northern lights over Tromsø.',
			},
		},
	);
	// The grid behind the dialog is never read as the post.
	assert.deepEqual(
		instagram('instagram-post.html', 'https://www.instagram.com/natgeo/').click(
			'dialog-save',
		),
		{kind: 'unreadable'},
	);
});

const github = (name: string, url = 'https://github.com/trending') =>
	page(name, url, (document) => createGithubReader(document));
const hackerNews = (name: string, url = 'https://news.ycombinator.com/') =>
	page(name, url, (document) => createHackerNewsReader(document));
const stackOverflow = (
	name: string,
	url = 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
) => page(name, url, (document) => createStackOverflowReader(document));

test('GitHub repositories get one address, from any page in them, and GitHub pages are not repositories', () => {
	for (const href of [
		'/sindresorhus/ky',
		'https://github.com/sindresorhus/ky/tree/main/source',
		'https://www.github.com/sindresorhus/ky.git',
		'/sindresorhus/ky/star',
	]) {
		assert.equal(
			githubRepoUrl(href),
			'https://github.com/sindresorhus/ky',
			href,
		);
	}

	for (const href of [
		'/sindresorhus',
		'/topics/rust',
		'/orgs/github/repositories',
		'https://gist.github.com/a/b',
		'https://example.com/a/b',
	]) {
		assert.equal(githubRepoUrl(href), null, href);
	}
});

test('Hacker News, Stack Overflow, dev.to, and Lobsters addresses', () => {
	assert.equal(
		hackerNewsItemUrl('item?id=41000001&p=2'),
		'https://news.ycombinator.com/item?id=41000001',
	);
	assert.equal(hackerNewsItemUrl('https://news.ycombinator.com/news'), null);
	assert.equal(hackerNewsItemUrl('https://example.com/item?id=1'), null);
	assert.equal(
		stackOverflowQuestionUrl(
			'/questions/11227809/why-is-processing?noredirect=1#comment1',
		),
		'https://stackoverflow.com/questions/11227809/why-is-processing',
	);
	assert.equal(
		stackOverflowQuestionUrl('https://stackoverflow.com/q/11227809'),
		'https://stackoverflow.com/questions/11227809',
	);
	assert.equal(stackOverflowQuestionUrl('/users/1/alice'), null);
	assert.equal(
		stackOverflowQuestionUrl('https://superuser.com/questions/1/a'),
		null,
	);
	assert.equal(
		devtoArticleUrl('https://dev.to/alice/local-first-apps-4k2j?utm_source=x'),
		'https://dev.to/alice/local-first-apps-4k2j',
	);
	assert.equal(devtoArticleUrl('/t/javascript'), null);
	assert.equal(devtoArticleUrl('/alice'), null);
	assert.equal(
		lobstersStoryUrl('https://lobste.rs/s/abc123/rust_in_production#c_x'),
		'https://lobste.rs/s/abc123/rust_in_production',
	);
	assert.equal(lobstersStoryUrl('/u/alice'), null);
});

test('GitHub: Star on a repository page saves it, titled with its name and description', () => {
	const expected = {
		kind: 'save',
		link: {
			url: 'https://github.com/sindresorhus/ky',
			title:
				'sindresorhus/ky: Tiny and elegant JavaScript HTTP client based on the Fetch API',
		},
	};
	for (const id of ['star', 'star-icon', 'star-shape', 'star-text']) {
		assert.deepEqual(
			github('github-repo.html', 'https://github.com/sindresorhus/ky').click(
				id,
			),
			expected,
			id,
		);
	}
});

test('GitHub: Unstar and other buttons save nothing', () => {
	const site = github('github-repo.html', 'https://github.com/sindresorhus/ky');
	assert.equal(site.click('unstar'), undefined);
	assert.equal(site.click('watch'), undefined);
});

test('GitHub: a Star button outside its form on a repository page saves that repository', () => {
	assert.equal(
		(
			github('github-repo.html', 'https://github.com/sindresorhus/ky').click(
				'changed-star',
			) as {link: {url: string}}
		).link.url,
		'https://github.com/sindresorhus/ky',
	);
});

test('GitHub: the React star button saves the repository at the address, and "Starred" saves nothing', () => {
	const site = github('github-react.html', 'https://github.com/denoland/deno');
	assert.deepEqual(site.click('react-star-text'), {
		kind: 'save',
		link: {
			url: 'https://github.com/denoland/deno',
			title: 'denoland/deno: A modern runtime for JavaScript and TypeScript.',
		},
	});
	const template = site.element('starred-variant') as HTMLTemplateElement;
	site.document.body.append(template.content.cloneNode(true));
	assert.equal(site.click('react-starred'), undefined);
});

test('GitHub: Star in a list saves that row, with or without a description', () => {
	const site = github('github-trending.html');
	assert.deepEqual(site.click('deno-star'), {
		kind: 'save',
		link: {
			url: 'https://github.com/denoland/deno',
			title: 'denoland/deno: A modern runtime for JavaScript and TypeScript.',
		},
	});
	assert.deepEqual(site.click('bare-star'), {
		kind: 'save',
		link: {
			url: 'https://github.com/octocat/Spoon-Knife',
			title: 'octocat/Spoon-Knife',
		},
	});
});

test('GitHub: a topic star saves nothing, and a list Star without its form is unreadable', () => {
	const site = github('github-trending.html');
	assert.equal(site.click('topic-star'), undefined);
	assert.deepEqual(site.click('changed-star'), {kind: 'unreadable'});
});

test('Hacker News: favorite on a story saves its link, with the discussion', () => {
	assert.deepEqual(
		hackerNews(
			'hackernews-item.html',
			'https://news.ycombinator.com/item?id=41000001',
		).click('fave'),
		{
			kind: 'save',
			link: {
				url: 'https://example.com/local-first',
				title: 'Local-first software: you own your data',
				discussion: 'https://news.ycombinator.com/item?id=41000001',
			},
		},
	);
});

test('Hacker News: an Ask HN post saves its own page', () => {
	assert.deepEqual(hackerNews('hackernews-list.html').click('ask-fave'), {
		kind: 'save',
		link: {
			url: 'https://news.ycombinator.com/item?id=41000002',
			title: 'Ask HN: What are you working on?',
			discussion: 'https://news.ycombinator.com/item?id=41000002',
		},
	});
});

test('Hacker News: un-favorite and a comment favorite save nothing; a story without its link is unreadable', () => {
	const list = hackerNews('hackernews-list.html');
	assert.equal(list.click('unfave'), undefined);
	assert.deepEqual(list.click('changed-fave'), {kind: 'unreadable'});
	assert.equal(
		hackerNews(
			'hackernews-item.html',
			'https://news.ycombinator.com/item?id=41000001',
		).click('comment-fave'),
		undefined,
	);
});

test('Stack Overflow: the bookmark button on a question saves it, wherever on the icon the click lands', () => {
	const expected = {
		kind: 'save',
		link: {
			url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
			title:
				'Why is processing a sorted array faster than processing an unsorted array?',
		},
	};
	for (const id of [
		'question-save',
		'question-save-icon',
		'question-save-shape',
	]) {
		assert.deepEqual(
			stackOverflow('stackoverflow-question.html').click(id),
			expected,
			id,
		);
	}
});

test('Stack Overflow: saving an answer or un-saving saves nothing; a question heading without its link is unreadable', () => {
	assert.equal(
		stackOverflow('stackoverflow-question.html').click('answer-save'),
		undefined,
	);
	const saved = stackOverflow(
		'stackoverflow-saved.html',
		'https://stackoverflow.com/questions/927358/how-do-i-undo',
	);
	assert.equal(saved.click('saved'), undefined);
	assert.deepEqual(saved.click('changed-save'), {kind: 'unreadable'});
});

const devto = (name: string, url = 'https://dev.to/') =>
	page(name, url, (document) => createDevtoReader(document));
const lobsters = (name: string, url = 'https://lobste.rs/') =>
	page(name, url, () => createLobstersReader());

test('dev.to: Save on a feed card saves that article, wherever on the icon the click lands', () => {
	const expected = {
		kind: 'save',
		link: {
			url: 'https://dev.to/alice/local-first-apps-4k2j',
			title: 'Building local-first apps with IndexedDB',
		},
	};
	for (const id of ['article-save-button-1001', 'save-icon', 'save-shape']) {
		assert.deepEqual(devto('devto-feed.html').click(id), expected, id);
	}

	// A server drawn card, with a tracking parameter on its link.
	assert.deepEqual(devto('devto-feed.html').click('server-save-initial'), {
		kind: 'save',
		link: {
			url: 'https://dev.to/carol/sqlite-in-the-browser-9z8y',
			title: 'SQLite in the browser',
		},
	});
});

test('dev.to: the reading list button on an article page saves the page, not its canonical link', () => {
	const site = devto(
		'devto-article.html',
		'https://dev.to/alice/local-first-apps-4k2j?utm_source=feed',
	);
	assert.deepEqual(site.click('readinglist-icon'), {
		kind: 'save',
		link: {
			url: 'https://dev.to/alice/local-first-apps-4k2j',
			title: 'Building local-first apps with IndexedDB',
		},
	});
	assert.equal(site.click('reaction-butt-like'), undefined);
});

test('dev.to: un-saving saves nothing; a card without its link, or a button off an article page, is unreadable', () => {
	const site = devto('devto-feed.html');
	assert.equal(site.click('saved'), undefined);
	assert.deepEqual(site.click('article-save-button-1003'), {
		kind: 'unreadable',
	});
	assert.deepEqual(
		devto('devto-article.html', 'https://dev.to/readinglist').click(
			'reaction-butt-readinglist',
		),
		{kind: 'unreadable'},
	);
});

test('Lobsters: save on a story saves its link, with the discussion', () => {
	assert.deepEqual(lobsters('lobsters-list.html').click('save'), {
		kind: 'save',
		link: {
			url: 'https://example.org/rust',
			title: 'Rust in production',
			discussion: 'https://lobste.rs/s/abc123/rust_in_production',
		},
	});
});

test('Lobsters: on a story page, each merged story saves its own link, with the page as the discussion', () => {
	const site = lobsters(
		'lobsters-story.html',
		'https://lobste.rs/s/abc123/rust_in_production',
	);
	assert.deepEqual(site.click('story-save'), {
		kind: 'save',
		link: {
			url: 'https://example.org/rust',
			title: 'Rust in production',
			discussion: 'https://lobste.rs/s/abc123',
		},
	});
	assert.equal(
		(site.click('merged-save') as {link: {url: string}}).link.url,
		'https://example.com/rust-at-scale',
	);
});

test('Lobsters: a text post saves its own page', () => {
	assert.deepEqual(lobsters('lobsters-list.html').click('text-save'), {
		kind: 'save',
		link: {
			url: 'https://lobste.rs/s/def456/what_are_you_doing_this_week',
			title: 'What are you doing this week?',
			discussion: 'https://lobste.rs/s/def456/what_are_you_doing_this_week',
		},
	});
});

test('Lobsters: unsave and hide save nothing; a story without its link is unreadable', () => {
	const site = lobsters('lobsters-list.html');
	assert.equal(site.click('unsave'), undefined);
	assert.equal(site.click('hide'), undefined);
	assert.deepEqual(site.click('changed-save'), {kind: 'unreadable'});
});

test('the new sources are found only on their own hosts', () => {
	assert.equal(siteSourceForUrl('https://github.com/a/b')?.id, 'github');
	assert.equal(
		siteSourceForUrl('https://news.ycombinator.com/item?id=1')?.id,
		'hackernews',
	);
	assert.equal(
		siteSourceForUrl('https://stackoverflow.com/questions/1')?.id,
		'stackoverflow',
	);
	assert.equal(siteSourceForUrl('https://dev.to/a/b')?.id, 'devto');
	assert.equal(siteSourceForUrl('https://lobste.rs/')?.id, 'lobsters');
	assert.equal(siteSourceForUrl('https://gist.github.com/a'), undefined);
	assert.equal(siteSourceForUrl('https://superuser.com/'), undefined);
});

test('reading and listening sources are found on their own hosts, subdomains only where listed', () => {
	assert.equal(siteSourceForUrl('https://bsky.app/')?.id, 'bluesky');
	assert.equal(
		siteSourceForUrl('https://m.soundcloud.com/a')?.id,
		'soundcloud',
	);
	assert.equal(siteSourceForUrl('https://open.spotify.com/')?.id, 'spotify');
	assert.equal(siteSourceForUrl('https://letterboxd.com/')?.id, 'letterboxd');
	assert.equal(siteSourceForUrl('https://m.imdb.com/')?.id, 'imdb');
	assert.equal(siteSourceForUrl('https://www.goodreads.com/')?.id, 'goodreads');
	assert.equal(siteSourceForUrl('https://medium.com/')?.id, 'medium');
	assert.equal(siteSourceForUrl('https://karpathy.medium.com/')?.id, 'medium');
	assert.equal(
		siteSourceForUrl('https://example.substack.com/')?.id,
		'substack',
	);
	assert.equal(siteSourceForUrl('https://notmedium.com/'), undefined);
	assert.equal(siteSourceForUrl('https://medium.com.example/'), undefined);
	assert.equal(siteSourceForUrl('https://spotify.com/'), undefined);
});

test('posts, tracks, films, and books each get one address', () => {
	assert.equal(
		blueskyPostUrl('/profile/alice.bsky.social/post/3kabc123xyz?x=1'),
		'https://bsky.app/profile/alice.bsky.social/post/3kabc123xyz',
	);
	assert.equal(blueskyPostUrl('/profile/alice.bsky.social'), null);
	assert.equal(
		soundcloudItemUrl('https://m.soundcloud.com/nils-frahm/says?in=x'),
		'https://soundcloud.com/nils-frahm/says',
	);
	assert.equal(
		soundcloudItemUrl('/nils-frahm/sets/spaces/'),
		'https://soundcloud.com/nils-frahm/sets/spaces',
	);
	assert.equal(soundcloudItemUrl('/discover/sets/new'), null);
	assert.equal(soundcloudItemUrl('/you/likes'), null);
	assert.equal(
		spotifyItemUrl('/intl-de/track/1h2xVEoJORqrg71HocgqXd?si=abc'),
		'https://open.spotify.com/track/1h2xVEoJORqrg71HocgqXd',
	);
	assert.equal(spotifyItemUrl('/genre/pop'), null);
	assert.equal(
		letterboxdFilmUrl('/someone/film/parasite-2019/activity/'),
		'https://letterboxd.com/film/parasite-2019/',
	);
	assert.equal(
		imdbTitleUrl('https://m.imdb.com/title/tt6751668/?ref_=nv'),
		'https://www.imdb.com/title/tt6751668/',
	);
	assert.equal(imdbTitleUrl('/name/nm0094435/'), null);
	assert.equal(letterboxdFilmUrl('/film/parasite%20other/'), null);
	assert.equal(
		goodreadsBookUrl('/book/show/18423.The_Left_Hand_of_Darkness'),
		'https://www.goodreads.com/book/show/18423',
	);
	assert.equal(
		goodreadsBookUrl('/book/show/18423-the-left-hand'),
		'https://www.goodreads.com/book/show/18423',
	);
	assert.equal(
		mediumPostUrl(
			'https://karpathy.medium.com/software-2-0-a64152b37c35?source=x',
		),
		'https://medium.com/p/a64152b37c35',
	);
	assert.equal(
		mediumPostUrl('/@karpathy/a-recipe-c6aaa0d0d6b1'),
		'https://medium.com/p/c6aaa0d0d6b1',
	);
	assert.equal(mediumPostUrl('/@karpathy'), null);
	assert.equal(
		substackPostUrl('https://example.substack.com/p/local-first-notes/?utm=x'),
		'https://example.substack.com/p/local-first-notes',
	);
	assert.equal(
		substackPostUrl('https://substack.com/home/post/p-123456789'),
		'https://substack.com/home/post/p-123456789',
	);
	assert.equal(substackPostUrl('https://example.substack.com/archive'), null);
});

const bluesky = (url = 'https://bsky.app/') =>
	page('bluesky-feed.html', url, (document) => createBlueskyReader(document));

test('Bluesky: the save button and the menu item save the post; removing saves nothing', () => {
	const site = bluesky(
		'https://bsky.app/profile/carol.bsky.social/post/3kmain111',
	);
	const text =
		'Local first apps keep working when the network does not, and that matters more than any sync…';
	assert.deepEqual(site.click('feed-save-icon'), {
		kind: 'save',
		link: {
			url: 'https://bsky.app/profile/alice.bsky.social/post/3kabc123xyz',
			title: text,
		},
	});
	assert.equal(site.click('feed-unsave'), undefined);
	// Another language's label is not taken for a save, so removing a post there saves nothing.
	assert.equal(site.click('feed-unsave-fr'), undefined);
	// The thread's main post is the page; quoted posts after its text are not, even one by the same author.
	assert.deepEqual(site.click('main-save'), {
		kind: 'save',
		link: {
			url: 'https://bsky.app/profile/carol.bsky.social/post/3kmain111',
			title: 'The main post of this thread.',
		},
	});
	assert.deepEqual(site.click('reply-save'), {
		kind: 'save',
		link: {
			url: 'https://bsky.app/profile/erin.bsky.social/post/3kreply777',
			title: 'A reply.',
		},
	});
	// The menu opens outside the post, so it saves the post clicked last.
	site.click('feed-menu');
	assert.deepEqual(site.click('menu-save'), {
		kind: 'save',
		link: {
			url: 'https://bsky.app/profile/alice.bsky.social/post/3kabc123xyz',
			title: text,
		},
	});
});

test('Bluesky: the menu item with no post clicked first is unreadable', () => {
	assert.deepEqual(bluesky().click('menu-save'), {kind: 'unreadable'});
});

test('SoundCloud: Like saves the row, the player, or the page; Liked saves nothing', () => {
	const site = page(
		'soundcloud-stream.html',
		'https://soundcloud.com/nils-frahm/says',
		(document) => createSoundcloudReader(document),
	);
	assert.deepEqual(site.click('row-like'), {
		kind: 'save',
		link: {
			url: 'https://soundcloud.com/nils-frahm/familiar',
			title: 'Familiar',
		},
	});
	assert.equal(site.click('row-unlike'), undefined);
	assert.deepEqual(site.click('player-like'), {
		kind: 'save',
		link: {url: 'https://soundcloud.com/olafur-arnalds/saman', title: 'saman'},
	});
	assert.deepEqual(site.click('page-like'), {
		kind: 'save',
		link: {url: 'https://soundcloud.com/nils-frahm/says', title: 'Says'},
	});
});

test('Spotify: saving the album, a song row, or the playing song; a saved one saves nothing', () => {
	const site = page(
		'spotify-album.html',
		'https://open.spotify.com/album/6GjwtEZcfenmOf6l18N7T7',
		(document) => createSpotifyReader(document),
	);
	assert.deepEqual(site.click('album-save'), {
		kind: 'save',
		link: {
			url: 'https://open.spotify.com/album/6GjwtEZcfenmOf6l18N7T7',
			title: 'Kid A',
		},
	});
	assert.deepEqual(site.click('row-save'), {
		kind: 'save',
		link: {
			url: 'https://open.spotify.com/track/6LgJvl0Xdtc73RJ1mmpotq',
			title: 'Everything In Its Right Place',
		},
	});
	assert.equal(site.click('row-saved'), undefined);
	// An episode card on the page saves the episode, not the page.
	assert.deepEqual(site.click('episode-save'), {
		kind: 'save',
		link: {
			url: 'https://open.spotify.com/episode/5Xt5DXGzch68nYYamXrNxZ',
			title: 'Episode one',
		},
	});
	// The playing song, not the album page it is played from.
	assert.deepEqual(site.click('player-save'), {
		kind: 'save',
		link: {
			url: 'https://open.spotify.com/track/1h2xVEoJORqrg71HocgqXd',
			title: 'Idioteque',
		},
	});
});

test('Spotify: the save button of an album of one song saves the album, not the song', () => {
	const site = page(
		'spotify-single.html',
		'https://open.spotify.com/album/1aBcDeFgHiJkLmNoPqRsTu',
		(document) => createSpotifyReader(document),
	);
	assert.deepEqual(site.click('album-save'), {
		kind: 'save',
		link: {
			url: 'https://open.spotify.com/album/1aBcDeFgHiJkLmNoPqRsTu',
			title: 'One Song Album',
		},
	});
});

test('Letterboxd: the film page and a poster menu add to the watchlist; removing saves nothing', () => {
	const site = page(
		'letterboxd-film.html',
		'https://letterboxd.com/film/parasite-2019/',
		(document) => createLetterboxdReader(document),
	);
	assert.deepEqual(site.click('page-add'), {
		kind: 'save',
		link: {
			url: 'https://letterboxd.com/film/parasite-2019/',
			title: 'Parasite',
		},
	});
	assert.equal(site.click('page-remove'), undefined);
	assert.deepEqual(site.click('menu-add'), {kind: 'unreadable'});
	site.click('poster-image');
	assert.deepEqual(site.click('menu-add'), {
		kind: 'save',
		link: {
			url: 'https://letterboxd.com/film/memories-of-murder/',
			title: 'Memories of Murder (2003)',
		},
	});
	assert.equal(site.click('menu-remove'), undefined);
});

test('IMDb: the title button and a poster ribbon add to the watchlist; a pressed one saves nothing', () => {
	const site = page(
		'imdb-title.html',
		'https://www.imdb.com/title/tt6751668/?ref_=x',
		(document) => createImdbReader(document),
	);
	assert.deepEqual(site.click('page-add'), {
		kind: 'save',
		link: {url: 'https://www.imdb.com/title/tt6751668/', title: 'Parasite'},
	});
	assert.equal(site.click('page-remove'), undefined);
	assert.deepEqual(site.click('ribbon-icon'), {
		kind: 'save',
		link: {
			url: 'https://www.imdb.com/title/tt0353969/',
			title: 'Memories of Murder',
		},
	});
	assert.equal(site.click('ribbon-remove'), undefined);
});

test('Goodreads: Want to Read on the book page and on a list row; other shelves save nothing', () => {
	const site = page(
		'goodreads-book.html',
		'https://www.goodreads.com/book/show/18423.The_Left_Hand_of_Darkness',
		(document) => createGoodreadsReader(document),
	);
	const book = {
		url: 'https://www.goodreads.com/book/show/18423',
		title: 'The Left Hand of Darkness',
	};
	assert.deepEqual(site.click('page-wtr'), {kind: 'save', link: book});
	assert.equal(site.click('page-choose'), undefined);
	// The row's own book, not the page's.
	assert.deepEqual(site.click('row-wtr'), {
		kind: 'save',
		link: {
			url: 'https://www.goodreads.com/book/show/13642',
			title: 'A Wizard of Earthsea',
		},
	});
	assert.equal(site.click('row-reading'), undefined);
});

test('Medium: the story bookmark saves the story, not a story it links to; a card saves its story', () => {
	const site = page(
		'medium-story.html',
		'https://karpathy.medium.com/software-2-0-a64152b37c35',
		(document) => createMediumReader(document),
	);
	assert.deepEqual(site.click('page-save-icon'), {
		kind: 'save',
		link: {url: 'https://medium.com/p/a64152b37c35', title: 'Software 2.0'},
	});
	assert.deepEqual(site.click('card-save-icon'), {
		kind: 'save',
		link: {
			url: 'https://medium.com/p/c6aaa0d0d6b1',
			title: 'A Recipe for Training Neural Networks',
		},
	});
	// A click on the button around the icon, not on the icon.
	assert.deepEqual(site.click('card-save'), {
		kind: 'save',
		link: {
			url: 'https://medium.com/p/c6aaa0d0d6b1',
			title: 'A Recipe for Training Neural Networks',
		},
	});
});

test('Substack: Save on a card or a post page; Unsave saves nothing', () => {
	const site = page(
		'substack-feed.html',
		'https://example.substack.com/p/the-gentle-art-of-saving',
		(document) => createSubstackReader(document),
	);
	assert.deepEqual(site.click('card-save'), {
		kind: 'save',
		link: {
			url: 'https://example.substack.com/p/local-first-notes',
			title: 'Local first notes',
		},
	});
	assert.equal(site.click('card-unsave'), undefined);
	// A relative link keeps the publication's host.
	assert.deepEqual(site.click('card-relative'), {
		kind: 'save',
		link: {
			url: 'https://example.substack.com/p/relative-post',
			title: 'A relative link',
		},
	});
	assert.deepEqual(site.click('page-save'), {
		kind: 'save',
		link: {
			url: 'https://example.substack.com/p/the-gentle-art-of-saving',
			title: 'The Gentle Art of Saving',
		},
	});
});

test('deleting a column asks to stop the site that saves into it here, and only that one', () => {
	const columns = [{id: 'source-reddit'}, {id: 'mine'}];
	const on = {id: 'reddit', enabled: true, wanted: true};
	assert.equal(sourceSavingInto('source-reddit', columns, [on])?.id, 'reddit');
	// The site is off here, or Settings sends its saves to another column that still exists.
	assert.equal(
		sourceSavingInto('source-reddit', columns, [{...on, enabled: false}]),
		undefined,
	);
	assert.equal(
		sourceSavingInto('source-reddit', columns, [{...on, columnId: 'mine'}]),
		undefined,
	);
	// A picked column that was deleted sends saves back to the source column.
	assert.equal(
		sourceSavingInto('source-reddit', columns, [{...on, columnId: 'gone'}])?.id,
		'reddit',
	);
	// Plain columns, and source ids this version does not know, never ask.
	assert.equal(sourceSavingInto('mine', columns, [on]), undefined);
	assert.equal(sourceSavingInto('source-mastodon', columns, [on]), undefined);
});

test('each site saves to its own source column id', () => {
	for (const source of SITE_SOURCES) {
		assert.equal(source.column.id, `source-${source.id}`);
	}
});

test('the Reddit saved page reader lists the saved posts in the page order, on new and old Reddit', () => {
	const urls = (name: string, url: string) =>
		readRedditSavedPage(load(name, url).document)?.map((link) => [
			link.url,
			link.title,
		]);
	// The feed only: a post in the sidebar is not a save, and a card without a permalink is skipped.
	assert.deepEqual(
		urls('reddit-saved-new.html', 'https://www.reddit.com/user/someone/saved/'),
		[
			[
				'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
				'Strict mode tips',
			],
			[
				'https://www.reddit.com/r/aptalSoruYok/comments/2kacti/ka%C3%A7_tane_vpn/',
				'Kaç tane VPN',
			],
			[
				'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
				'Strict mode tips',
			],
		],
	);
	// Saved comments are read on old Reddit; a promoted row is not a save.
	assert.deepEqual(
		urls('reddit-saved-old.html', 'https://old.reddit.com/user/someone/saved/'),
		[
			[
				'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
				'Strict mode tips',
			],
			[
				'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/xyz789/',
				'Comment by u/carol',
			],
			['https://www.reddit.com/r/pics/comments/4nsfw0/a_picture/', 'A picture'],
		],
	);
	// The same markup anywhere else on Reddit is not the saved list.
	assert.equal(
		urls('reddit-saved-new.html', 'https://www.reddit.com/user/someone/'),
		undefined,
	);
	assert.equal(
		urls('reddit-saved-old.html', 'https://old.reddit.com/r/typescript/'),
		undefined,
	);
});

test('a click-save and the saved page catch-up store the same address for one post', () => {
	const site = reddit(
		'reddit-old.html',
		'https://old.reddit.com/r/typescript/',
	);
	const saved = readRedditSavedPage(
		load('reddit-saved-old.html', 'https://old.reddit.com/user/someone/saved/')
			.document,
	);
	const click = site.click('post-save');
	assert.equal(click?.kind, 'save');
	assert.equal(saved?.[0]?.url, click?.kind === 'save' ? click.link.url : '');
});

test('Not now answers ask again only for an item not answered yet, and the stored answers are checked', () => {
	const link = (url: string) => ({url, title: ''});
	const dismissed = dismissMissing(
		['https://a.example/'],
		[link('https://b.example/'), link('https://a.example/')],
	);
	assert.deepEqual(dismissed, ['https://b.example/', 'https://a.example/']);
	assert.equal(catchUpAsks([link('https://a.example/')], dismissed), false);
	assert.equal(
		catchUpAsks(
			[link('https://a.example/'), link('https://c.example/')],
			dismissed,
		),
		true,
	);
	assert.equal(catchUpAsks([], undefined), false);
	assert.deepEqual(
		parseCatchUpState({
			dismissed: {reddit: ['https://a.example/', 4], unknown: ['x'], x: 'y'},
		}),
		{reddit: ['https://a.example/']},
	);
	assert.deepEqual(parseCatchUpState('junk'), {});
	assert.equal(
		catchUpCountText(1, 'TabLodge'),
		"1 saved item on this page isn't in TabLodge.",
	);
	assert.equal(
		catchUpCountText(3, 'TabLodge'),
		"3 saved items on this page aren't in TabLodge.",
	);
});

/**
A fixture page with the content script's listener and a site that saves on a click, as a site's own handlers do. `click(id)` sends a trusted click (Shift held when asked) and says who acted on it.
*/
function keepOffPage(
	name: string,
	url: string,
	reader: (document: Document) => SourceReader,
	keepOff = true,
) {
	const {window, document} = load(name, url);
	const handled: string[] = [];
	const reads: Array<{found: SourceRead; kept?: KeptSave}> = [];
	let choice = keepOff;
	listenForSaves(window, {
		read: reader(document),
		keepOff: () => choice,
		onRead(found, kept) {
			reads.push({found, kept});
		},
	});
	// Linkedom calls window listeners last and in the order added, whatever the phase, so the site's handler goes on
	// the window after the content script's; in a browser the capture listener runs before any site handler.
	window.addEventListener('click', (event) => {
		handled.push((event.target as Element).closest('[id]')?.id ?? '');
	});
	const click = (id: string, {shiftKey = false, trusted = true} = {}) => {
		const element = document.querySelector(`#${id}`);
		assert.ok(element, `fixture has #${id}`);
		const event = new window.Event('click', {bubbles: true, cancelable: true});
		// Linkedom marks no event trusted; the browser marks the user's own clicks.
		Object.defineProperties(event, {
			isTrusted: {value: trusted},
			shiftKey: {value: shiftKey},
		});
		element.dispatchEvent(event);
		return {stopped: event.defaultPrevented, last: reads.at(-1)};
	};

	return {
		document,
		handled,
		reads,
		click,
		setKeepOff(value: boolean) {
			choice = value;
		},
	};
}

const keepOffX = (keepOff?: boolean) =>
	keepOffPage(
		'x-home.html',
		'https://x.com/home',
		(document) => createTwitterReader(document),
		keepOff,
	);
const keepOffReddit = (name: string, url: string, keepOff?: boolean) =>
	keepOffPage(name, url, () => createRedditReader(), keepOff);

test('Save to TabLodge only: X Bookmark, button or Share menu, never reaches the site', () => {
	const site = keepOffX();
	const button = site.click('bookmark-icon');
	assert.equal(button.stopped, true);
	assert.equal(
		button.last?.kept?.link.url,
		'https://x.com/alice/status/1850000000000000001',
	);
	site.click('share');
	const menu = site.click('menu-bookmark');
	assert.equal(menu.stopped, true);
	assert.equal(
		menu.last?.kept?.link.url,
		'https://x.com/alice/status/1850000000000000001',
	);
	// Share opened the menu on the site; neither save reached it.
	assert.deepEqual(site.handled, ['share']);
});

test('Save to TabLodge only: new and old Reddit Save never reach the site', () => {
	for (const [name, url] of [
		['reddit-new.html', 'https://www.reddit.com/'],
		['reddit-old.html', 'https://old.reddit.com/r/typescript/'],
	] as const) {
		const site = keepOffReddit(name, url);
		const {stopped, last} = site.click('post-save');
		assert.equal(stopped, true, name);
		assert.equal(
			last?.kept?.link.url,
			'https://www.reddit.com/r/typescript/comments/1abcde/strict_mode_tips/',
			name,
		);
		assert.deepEqual(site.handled, [], name);
	}
});

test('saving on the site and in TabLodge, the default, lets every save reach the site', () => {
	const site = keepOffX(false);
	const {stopped, last} = site.click('bookmark-icon');
	assert.equal(stopped, false);
	assert.equal(last?.found?.kind, 'save');
	assert.equal(last?.kept, undefined);
	assert.deepEqual(site.handled, ['bookmark-icon']);
});

test('Save to TabLodge only fails open: an unreadable save, a choice not loaded, and untrusted clicks reach the site', () => {
	const site = keepOffX();
	assert.equal(site.click('changed-bookmark').stopped, false);
	assert.deepEqual(site.reads.at(-1), {
		found: {kind: 'unreadable'},
		kept: undefined,
	});
	const oldReddit = keepOffReddit('reddit-new.html', 'https://www.reddit.com/');
	assert.equal(oldReddit.click('broken-save').stopped, false);
	assert.deepEqual(oldReddit.handled, ['broken-save']);

	site.setKeepOff(false);
	assert.equal(site.click('bookmark-icon').stopped, false);
	site.setKeepOff(true);
	assert.equal(site.click('bookmark-icon', {trusted: false}).stopped, false);
	assert.deepEqual(site.handled, [
		'changed-bookmark',
		'bookmark-icon',
		'bookmark-icon',
	]);
});

test('Save to TabLodge only: Shift passes one click through to the site, and TabLodge still saves it', () => {
	const site = keepOffX();
	const shifted = site.click('bookmark-icon', {shiftKey: true});
	assert.equal(shifted.stopped, false);
	assert.equal(shifted.last?.found?.kind, 'save');
	assert.equal(shifted.last?.kept, undefined);
	assert.equal(site.click('bookmark-icon').stopped, true);
	assert.deepEqual(site.handled, ['bookmark-icon']);
});

test('Also save on the site replays the click to the site only, unless the control is gone', () => {
	const site = keepOffX();
	const kept = site.click('bookmark-icon').last?.kept;
	assert.ok(kept);
	const reads = site.reads.length;
	assert.equal(kept.replay(), true);
	// The icon has no click method, so the element around it is clicked, inside the same button.
	assert.deepEqual(site.handled, ['bookmark']);
	assert.equal(site.reads.length, reads, 'the replay is not read again');

	site.click('share');
	const menu = site.click('menu-bookmark').last?.kept;
	assert.ok(menu);
	site.document.querySelector('#menu-bookmark')?.remove();
	assert.equal(menu.replay(), false);
});

test('Save to TabLodge only is stored only as true, and only for X and Reddit', () => {
	assert.deepEqual(
		SITE_SOURCES.filter((source) => source.keepOffSite).map(({id}) => id),
		['reddit', 'x'],
	);
	const state = parseSiteSourcesState({
		version: 1,
		choices: {
			x: {keepOffSite: true},
			reddit: {keepOffSite: 'yes'},
			youtube: {keepOffSite: true},
		},
	});
	const choice = (id: string) => sourceChoice(state, siteSourceById(id)!);
	assert.deepEqual(choice('x'), {wanted: true, keepOffSite: true});
	assert.deepEqual(choice('reddit'), {wanted: true});
	assert.deepEqual(choice('youtube'), {wanted: true});
});

test('a stopped save that fails, or finds the source off, goes on to the site; a saved one offers Undo and Also save', () => {
	const names = {app: 'TabLodge', site: 'X'};
	const kept = (attached: boolean) => {
		const replays: number[] = [];
		const save: KeptSave = {
			link: {url: 'https://x.com/alice/status/1', title: 'Post'},
			replay() {
				replays.push(1);
				return attached;
			},
		};
		return {save, replays};
	};

	for (const result of [
		undefined,
		{ok: false, error: 'Locked.'},
		{ok: true, outcome: 'off'},
	] as const) {
		const {save, replays} = kept(true);
		assert.deepEqual(settleKeptSave(result, save, names), {
			text: 'TabLodge could not save this, so X saved it.',
			error: true,
			alsoSave: false,
		});
		assert.equal(replays.length, 1, 'the click went on to the site');
	}

	const gone = kept(false);
	assert.equal(
		settleKeptSave(undefined, gone.save, names).text,
		'TabLodge could not save this, and X did not either. Save it again.',
	);

	const saved = kept(true);
	assert.deepEqual(
		settleKeptSave(
			{ok: true, outcome: 'saved', column: 'X', undoId: 'u1'},
			saved.save,
			names,
		),
		{
			text: "Saved to TabLodge only, in X. X won't show it as saved.",
			error: false,
			alsoSave: true,
			undoId: 'u1',
		},
	);
	assert.deepEqual(
		settleKeptSave({ok: true, outcome: 'exists'}, saved.save, names),
		{
			text: 'Already in TabLodge, so X did not save it.',
			error: false,
			alsoSave: true,
		},
	);
	assert.equal(saved.replays.length, 0, 'a saved item stays off the site');
});
