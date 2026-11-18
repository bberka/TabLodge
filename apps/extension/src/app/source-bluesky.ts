// Saved posts on Bluesky: notices the user saving a post with the bookmark button in its action row
// (`data-testid="postBookmarkBtn"`) or with the item in its "..." menu (`postDropdownBookmarkBtn`). Both keep their
// test id when the post is saved and have no state attribute; only the label tells adding ("Add to saved posts")
// from removing. The label is translated, so only the English one counts and another language saves nothing.
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
const SAVE_LABEL = /^add to saved posts$/i;

/**
The item's own post. A feed item is a link to it. A reply in a thread links to itself in its header, before its
text; a link to another post after the text is a quote, even one by the same author. A thread item with no link
before its text is the page's main post.
*/
function postUrl(item: Element, document: Document) {
	const own = blueskyPostUrl(item.getAttribute('href') ?? '');
	if (own) {
		return own;
	}

	// In document order, so the links before the post's text come first; the text ends the header.
	for (const element of item.querySelectorAll(
		`a[href*="/post/"], ${POST_TEXT}`,
	)) {
		if (element.matches(POST_TEXT)) {
			break;
		}

		const url = blueskyPostUrl(element.getAttribute('href') ?? '');
		if (url) {
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
		if (!button || !SAVE_LABEL.test(controlLabel(button))) {
			return undefined;
		}

		const post = button.matches(ROW_SAVE) ? item : lastPost.get();
		return post?.isConnected ? postIn(post, document) : {kind: 'unreadable'};
	};
}
