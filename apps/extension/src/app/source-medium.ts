// Reading list on Medium: notices the user clicking the bookmark on a story, on its page (`data-testid` ending in
// `BookmarkButton`) or on a story card. The button opens Medium's "Save to list" panel and adds the story to the
// reading list when it is in no list yet; it never removes one, so every click counts as a save. A click on a story
// that was saved already reads as a save of the same story, which the worker skips. Its label, "Add to list
// bookmark button", is fixed English text in every interface language. On a card the story is the card's link; on a
// story's page it is the page.
import {mediumPostUrl} from './site-sources';
import {
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const PAGE_SAVE =
	'[data-testid="headerBookmarkButton"], [data-testid="footerBookmarkButton"]';
const SAVE_LABEL = /^add to list bookmark button$/i;
// The label is on the icon, so a click on the button around it is found by the icon inside.
const SAVE_ICON = '[aria-label="Add to list bookmark button" i]';
const CARD = 'article[data-testid="post-preview"], article';
const PAGE_TITLE = '[data-testid="storyTitle"], h1';

export function createMediumReader(document: Document): SourceReader {
	return (event) => {
		const path = eventElements(event);
		const button = path.find(
			(element) =>
				element.matches(PAGE_SAVE) ||
				SAVE_LABEL.test(element.getAttribute('aria-label') ?? '') ||
				(element.matches('button') &&
					element.querySelector(SAVE_ICON) !== null),
		);
		if (!button) {
			return undefined;
		}

		// The story's page holds the story in an article too, so its own bookmark is told apart by its test id.
		const onPage = path.some((element) => element.matches(PAGE_SAVE));
		const card = onPage ? null : button.closest(CARD);
		if (card) {
			const url = [...card.querySelectorAll('a[href]')]
				.map((link) => mediumPostUrl(link.getAttribute('href') ?? ''))
				.find(Boolean);
			const title = squash(
				card.getAttribute('aria-label') ??
					card.querySelector('h2, h3')?.textContent,
			);
			return savedOrUnreadable(url, title);
		}

		// The canonical link can name a publication's own domain, which the address rule does not take.
		const url =
			mediumPostUrl(document.location.href) ??
			mediumPostUrl(
				document.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
					'',
			);
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
