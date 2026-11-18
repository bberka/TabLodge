// Watchlist on Letterboxd: notices the user adding a film to their watchlist, on the film's page ("Add this film to
// your watchlist") or from a poster's menu ("Add to watchlist"). Removing it reads "This film is in your watchlist",
// "Remove this film from your watchlist", or "Remove from watchlist", and saves nothing. Letterboxd is in English
// only. On the film's page the film is the page; a poster's menu opens away from the poster, so it is matched to the
// poster clicked last, which names its film in `data-item-link` and `data-item-name`.
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
