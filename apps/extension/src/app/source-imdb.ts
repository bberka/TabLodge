import {imdbTitleUrl} from './site-sources';
import {
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const SAVE =
	'[data-testid^="poster-watchlist-ribbon"], [data-testid="tm-box-wl-button"]';
const CARD = '.ipc-poster-card, .ipc-metadata-list-summary-item';
const CARD_LINK = 'a[href*="/title/tt"]';
const CARD_TITLE = '[data-testid="title"], .ipc-poster-card__title, h3';
const PAGE_TITLE = '[data-testid="hero__primary-text"], h1';

export function createImdbReader(document: Document): SourceReader {
	return (event) => {
		const button = eventElements(event).find((element) =>
			element.matches(SAVE),
		);
		if (!button || button.getAttribute('aria-pressed') === 'true') {
			return undefined;
		}

		const card = button.closest(CARD);
		const link = card?.querySelector(CARD_LINK);
		if (card && link) {
			const url = imdbTitleUrl(link.getAttribute('href') ?? '');
			const title = squash(
				card.querySelector(CARD_TITLE)?.textContent ?? link.textContent,
			);
			return savedOrUnreadable(url, title);
		}

		const url = imdbTitleUrl(document.location.href);
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
