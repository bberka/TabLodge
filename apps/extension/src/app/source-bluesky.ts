// Saved posts on Bluesky: notices the user saving a post with the bookmark button in its action row
// (`data-testid="postBookmarkBtn"`) or with the item in its "..." menu (`postDropdownBookmarkBtn`). Both keep their
// test id when the post is saved; only the label changes to "Remove from saved posts", which is English. In
// another language a click that removes a saved post is read as a save; the link is usually in TabLodge already.
// The menu opens away from the post, so it is matched to the post clicked last.
import {blueskyPostUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	excerpt,
	rememberLast,
	type SourceRead,
	type SourceReader,
} from './source-reader';

const ROW_SAVE = '[data-testid="postBookmarkBtn"]';
const MENU_SAVE = '[data-testid="postDropdownBookmarkBtn"]';
const FEED_ITEM = '[data-testid^="feedItem-by-"]';
const THREAD_ITEM = '[data-testid^="postThreadItem-by-"]';
const POST_TEXT = '[data-testid="postText"]';
const UNSAVE = /^remove\b/i;

/**
The item's own post. A feed item is a link to it. In a thread only a reply links to itself, and a link to
another post inside an item is a quote; the test id names the item's author, so its own link is the one to that
author's post. A thread item without one is the page's main post.
*/
function postUrl(item: Element, document: Document) {
	const own = blueskyPostUrl(item.getAttribute('href') ?? '');
	if (own) {
		return own;
	}

	const author = ((item as HTMLElement).dataset.testid ?? '').replace(
		/^(?:feedItem|postThreadItem)-by-/,
		'',
	);
	for (const link of item.querySelectorAll('a[href*="/post/"]')) {
		const url = blueskyPostUrl(link.getAttribute('href') ?? '');
		if (url?.startsWith(`https://bsky.app/profile/${author}/post/`)) {
			return url;
		}
	}

	return item.matches(THREAD_ITEM)
		? blueskyPostUrl(document.location.href)
		: null;
}

function postIn(item: Element, document: Document): SourceRead {
	const url = postUrl(item, document);
	const text = excerpt(item.querySelector(POST_TEXT)?.textContent);
	return url
		? {kind: 'save', link: {url, title: text || url}}
		: {kind: 'unreadable'};
}

export function createBlueskyReader(
	document: Document,
	now = () => Date.now(),
): SourceReader {
	const lastPost = rememberLast<Element>(now);
	return (event) => {
		const path = eventElements(event);
		const item = path.find((element) =>
			element.matches(`${FEED_ITEM}, ${THREAD_ITEM}`),
		);
		if (item) {
			lastPost.set(item);
		}

		const button = path.find((element) =>
			element.matches(`${ROW_SAVE}, ${MENU_SAVE}`),
		);
		if (!button || UNSAVE.test(controlLabel(button))) {
			return undefined;
		}

		const post = button.matches(ROW_SAVE) ? item : lastPost.get();
		return post?.isConnected ? postIn(post, document) : {kind: 'unreadable'};
	};
}
