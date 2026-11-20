// Instagram saved: notices the user tapping Save on a post or a reel. The control is an icon button whose svg is
// labeled "Save", and "Remove" once the post is saved. It is found by that English label. A post in the feed is an
// <article> whose timestamp links to the post; a post or reel opened on its own page, or in a dialog over a grid or
// a profile, is at the page's address.
// The saved page (/<user>/saved/all-posts/ or a collection under /<user>/saved/), which only its owner can open, is
// read for catch-up (#383): a grid of links to the saved posts and reels, each with its caption as the image's alt.
import type {SavedPageReader} from './source-catch-up';
import {instagramPostUrl} from './site-sources';
import {
	eventElements,
	excerpt,
	squash,
	type SourceLink,
	type SourceReader,
} from './source-reader';

const CONTROL = 'button, [role="button"]';
const ICON = 'svg[aria-label]';

/**
The label of the icon the click was on, or of the one icon inside the clicked button.
*/
function iconLabel(path: Element[]) {
	const control = path.find((element) => element.matches(CONTROL));
	const icon =
		path.find((element) => element.matches(ICON)) ??
		control?.querySelector(`:scope ${ICON}`);
	return icon ? squash(icon.getAttribute('aria-label')) : undefined;
}

/**
The caption: a post page's heading, or else the longest line of text in the post that is not a link (the author's
name is one), which in the feed is the caption.
*/
function caption(scope: ParentNode) {
	const heading = scope.querySelector('h1');
	if (heading && squash(heading.textContent)) {
		return excerpt(heading.textContent);
	}

	let longest = '';
	for (const span of scope.querySelectorAll('span[dir="auto"]')) {
		const text = squash(span.textContent);
		if (!span.closest('a') && text.length > longest.length) {
			longest = text;
		}
	}

	return excerpt(longest);
}

const REEL = /\/reels?\//;
const fallbackTitle = (reel: boolean) =>
	reel ? 'Instagram reel' : 'Instagram post';

/**
The post at `href`, titled by its caption in `scope`, or as a reel or a post when there is none.
*/
function titled(href: string, scope: ParentNode): SourceLink | undefined {
	const url = instagramPostUrl(href);
	return url
		? {url, title: caption(scope) || fallbackTitle(REEL.test(href))}
		: undefined;
}

function articleLink(article: Element): SourceLink | undefined {
	const anchors = [...article.querySelectorAll(':scope a[href] time')].map(
		(time) => time.closest('a'),
	);
	for (const anchor of [
		...anchors,
		...article.querySelectorAll(':scope a[href]'),
	]) {
		const link = titled(anchor?.getAttribute('href') ?? '', article);
		if (link) {
			return link;
		}
	}

	return undefined;
}

const SAVED_PAGE = /^\/[\w.]{1,30}\/saved\/[^/]+\//;

export const readInstagramSavedPage: SavedPageReader = (document) => {
	if (!SAVED_PAGE.test(document.location.pathname)) {
		return undefined;
	}

	const links: SourceLink[] = [];
	for (const anchor of document.querySelectorAll('main a[href]')) {
		const url = instagramPostUrl(anchor.getAttribute('href') ?? '');
		if (!url) {
			continue;
		}

		// The grid links a reel at /p/ and marks it with a Clip icon.
		const reel = Boolean(anchor.querySelector('svg[aria-label="Clip"]'));
		links.push({
			url,
			title:
				excerpt(anchor.querySelector('img')?.getAttribute('alt')) ||
				fallbackTitle(reel),
		});
	}

	return links;
};

export function createInstagramReader(document: Document): SourceReader {
	return (event) => {
		const path = eventElements(event);
		if (iconLabel(path)?.toLowerCase() !== 'save') {
			return undefined;
		}

		// A post page or a post dialog holds one post, the one at the page's address.
		const article = path.find((element) => element.matches('article'));
		const scope =
			article ??
			path.find((element) => element.matches('[role="dialog"]')) ??
			document.querySelector('main') ??
			document;
		const link =
			(article && articleLink(article)) ??
			titled(document.location.href, scope);
		return link ? {kind: 'save', link} : {kind: 'unreadable'};
	};
}
