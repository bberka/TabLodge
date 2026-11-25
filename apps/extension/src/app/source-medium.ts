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
