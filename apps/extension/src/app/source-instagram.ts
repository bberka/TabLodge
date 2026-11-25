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

function iconLabel(path: Element[]) {
	const control = path.find((element) => element.matches(CONTROL));
	const icon =
		path.find((element) => element.matches(ICON)) ??
		control?.querySelector(`:scope ${ICON}`);
	return icon ? squash(icon.getAttribute('aria-label')) : undefined;
}

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
