import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Window} from 'happy-dom';
import {test} from 'vite-plus/test';
import {manifestForTarget} from '../scripts/manifest-targets';
import {
	parseSiteSourcesState,
	redditPermalinkUrl,
	SITE_SOURCES,
	siteSourceForUrl,
	youtubeVideoUrl,
} from '../src/app/site-sources';
import type {SourceRead, SourceReader} from '../src/app/source-reader';
import {createRedditReader} from '../src/app/source-reddit';
import {createYoutubeReader} from '../src/app/source-youtube';

const fixture = (name: string) =>
	readFileSync(
		join(import.meta.dirname, 'fixtures', 'site-sources', name),
		'utf8',
	);

/**
A fixture page at `url` with a reader listening the way the content script does: on the window, in the capture
phase. `click(id)` clicks an element and returns what the reader made of it.
*/
function page(
	name: string,
	url: string,
	reader: (document: Document) => SourceReader,
) {
	const window = new Window({url});
	window.document.write(fixture(name));
	const document = window.document as unknown as Document;
	const read = reader(document);
	let last: SourceRead;
	window.addEventListener(
		'click',
		(event) => {
			last = read(event as unknown as Event);
		},
		{capture: true},
	);
	return {
		document,
		click(id: string): SourceRead {
			const element = document.querySelector(`#${id}`);
			assert.ok(element, `fixture has #${id}`);
			last = undefined;
			(element as HTMLElement).click();
			return last;
		},
	};
}

const youtube = (name: string, url = 'https://www.youtube.com/') =>
	page(name, url, (document) => createYoutubeReader(document));
const reddit = (name: string, url = 'https://www.reddit.com/') =>
	page(name, url, () => createRedditReader());

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

test('a source is found only on its own https hosts', () => {
	assert.equal(
		siteSourceForUrl('https://www.youtube.com/watch?v=x')?.id,
		'youtube',
	);
	assert.equal(siteSourceForUrl('https://old.reddit.com/r/a/')?.id, 'reddit');
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

test('stored source state is read defensively: off unless saved as on', () => {
	assert.deepEqual(parseSiteSourcesState(undefined), {
		youtube: {enabled: false},
		reddit: {enabled: false},
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
		{youtube: {enabled: true, notice: 'unreadable'}, reddit: {enabled: false}},
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
	const window = new Window({url: 'https://www.youtube.com/'});
	window.document.write(fixture('youtube-home.html'));
	const document = window.document as unknown as Document;
	const read = createYoutubeReader(document, () => now);
	const results: SourceRead[] = [];
	window.addEventListener(
		'click',
		(event) => {
			results.push(read(event as unknown as Event));
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
	site.document
		.querySelector(':scope #option-watch-later [role="checkbox"]')!
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
	const menu = site.document.querySelector(
		':scope #t3_1abcde shreddit-post-overflow-menu',
	)!;
	const root = menu.attachShadow({mode: 'open'});
	const item = site.document.createElement('li');
	item.setAttribute('role', 'menuitem');
	item.textContent = 'Save';
	root.append(item);
	let found: SourceRead;
	const read = createRedditReader();
	site.document.defaultView!.addEventListener(
		'click',
		(event) => {
			found = read(event);
		},
		{capture: true},
	);
	item.click();
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
