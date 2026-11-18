import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseHTML} from 'linkedom';
import {test} from 'vite-plus/test';
import {manifestForTarget} from '../scripts/manifest-targets';
import {isColumnColor} from '../src/shared/accent-colors';
import {ICON_IDS} from '../src/shared/icon-ids';
import {
	devtoArticleUrl,
	githubRepoUrl,
	hackerNewsItemUrl,
	instagramPostUrl,
	lobstersStoryUrl,
	parseSiteSourcesState,
	redditPermalinkUrl,
	SITE_SOURCES,
	siteSourceForUrl,
	stackOverflowQuestionUrl,
	xPostUrl,
	youtubeVideoUrl,
} from '../src/app/site-sources';
import {createDevtoReader} from '../src/app/source-devto';
import {createGithubReader} from '../src/app/source-github';
import {createHackerNewsReader} from '../src/app/source-hackernews';
import {createInstagramReader} from '../src/app/source-instagram';
import {createLobstersReader} from '../src/app/source-lobsters';
import {
	excerpt,
	type SourceRead,
	type SourceReader,
} from '../src/app/source-reader';
import {createRedditReader} from '../src/app/source-reddit';
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
		assert.ok(ICON_IDS.includes(source.columnIcon), source.id);
		assert.ok(isColumnColor(source.columnColor), source.id);
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
	assert.equal(
		TOAST_TOKENS.radius,
		`${Number.parseFloat(value(light, 'radius') ?? '') * 16}px`,
	);
});

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
	assert.deepEqual(parseSiteSourcesState(undefined), {
		youtube: {enabled: false},
		reddit: {enabled: false},
		x: {enabled: false},
		instagram: {enabled: false},
		github: {enabled: false},
		hackernews: {enabled: false},
		stackoverflow: {enabled: false},
		devto: {enabled: false},
		lobsters: {enabled: false},
	});
	assert.deepEqual(
		parseSiteSourcesState({
			version: 1,
			sources: {
				youtube: {enabled: true, notice: 'unreadable'},
				reddit: {enabled: 'yes', notice: 'other'},
				extra: {enabled: true},
			},
		}),
		{
			youtube: {enabled: true, notice: 'unreadable'},
			reddit: {enabled: false},
			x: {enabled: false},
			instagram: {enabled: false},
			github: {enabled: false},
			hackernews: {enabled: false},
			stackoverflow: {enabled: false},
			devto: {enabled: false},
			lobsters: {enabled: false},
		},
	);
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
