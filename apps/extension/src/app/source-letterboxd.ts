import {letterboxdFilmUrl} from './site-sources';
import {
	controlLabel,
	eventElements,
	rememberLast,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const POSTER = '[data-item-link]';
const PAGE_ADD = /^add this film to your watchlist$/i;
const MENU_ADD = /^add to watchlist$/i;
const PAGE_TITLE = 'h1';

export function createLetterboxdReader(
	document: Document,
	now = () => Date.now(),
): SourceReader {
	const lastPoster = rememberLast<Element>(now);
	return (event) => {
		const path = eventElements(event);
		const poster = path.find((element) => element.matches(POSTER));
		if (poster) {
			lastPoster.set(poster);
		}

		const control = path.find((element) =>
			element.matches('a, button, [role="button"], [role="menuitem"]'),
		);
		const label = control ? controlLabel(control) : '';
		if (PAGE_ADD.test(label)) {
			const url = letterboxdFilmUrl(document.location.href);
			const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
			return savedOrUnreadable(url, title);
		}

		if (!MENU_ADD.test(label)) {
			return undefined;
		}

		const film = poster ?? lastPoster.get();
		const url = letterboxdFilmUrl(
			(film as HTMLElement | undefined)?.dataset.itemLink ?? '',
		);
		const title = squash((film as HTMLElement | undefined)?.dataset.itemName);
		return savedOrUnreadable(url, title);
	};
}
