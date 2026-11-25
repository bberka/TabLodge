import type {SavedPageReader} from './source-catch-up';
import {xPostUrl} from './site-sources';
import {
	eventElements,
	excerpt,
	controlLabel,
	rememberLast,
	type SourceLink,
	type SourceReader,
} from './source-reader';

const POST = 'article';
const BOOKMARK = '[data-testid="bookmark"]';
const REMOVE_BOOKMARK = '[data-testid="removeBookmark"]';
const MEDIA_VIEW = /\/status\/\d+\/(?:photo|video)\//;

const byAuthor = (url: string) =>
	`Post by @${new URL(url).pathname.split('/', 2)[1]}`;

function postText(post: Element) {
	for (const text of post.querySelectorAll(
		':scope [data-testid="tweetText"]',
	)) {
		if (text.parentElement?.closest(`[role="link"], ${POST}`) === post) {
			return excerpt(text.textContent);
		}
	}

	return '';
}

function postLink(post: Element): SourceLink | undefined {
	for (const time of post.querySelectorAll(':scope a[href] time')) {
		const url = xPostUrl(time.closest('a')?.getAttribute('href') ?? '');
		if (url) {
			return {url, title: postText(post) || byAuthor(url)};
		}
	}

	return undefined;
}

const BOOKMARKS_PAGE = /^\/i\/(?:bookmarks|history)\/?$/;

export const readTwitterSavedPage: SavedPageReader = (document) => {
	if (!BOOKMARKS_PAGE.test(document.location.pathname)) {
		return undefined;
	}

	return [...document.querySelectorAll(`main ${POST}`)]
		.filter((post) => !post.parentElement?.closest(POST))
		.map((post) => postLink(post))
		.filter((link) => link !== undefined);
};

function mediaViewLink(document: Document): SourceLink | undefined {
	const url = MEDIA_VIEW.test(document.location.pathname)
		? xPostUrl(document.location.href)
		: null;
	return url ? {url, title: byAuthor(url)} : undefined;
}

export function createTwitterReader(
	document: Document,
	now = () => Date.now(),
): SourceReader {
	const lastPost = rememberLast<SourceLink | undefined>(now);
	return (event) => {
		const path = eventElements(event);
		const post = path.find((element) => element.matches(POST));
		if (path.some((element) => element.matches(REMOVE_BOOKMARK))) {
			return undefined;
		}

		if (path.some((element) => element.matches(BOOKMARK))) {
			const link = post ? postLink(post) : mediaViewLink(document);
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		const menuItem = path.find((element) =>
			element.matches('[role="menuitem"]'),
		);
		if (menuItem && /^bookmark$/i.test(controlLabel(menuItem))) {
			const link = lastPost.get();
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		if (post) {
			lastPost.set(postLink(post));
		}

		return undefined;
	};
}
