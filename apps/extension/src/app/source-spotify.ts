// Your Library on Spotify: notices the user clicking the save button (`data-testid="add-button"`) on a song, album,
// playlist, show, or episode. It reads `aria-checked="true"` once the item is saved, and a click then removes it or
// opens a playlist picker, which saves nothing; the attribute is the same in every interface language. The item is
// the song link of the track list row the button is in, the song in the now playing bar, the one item a small card
// around the button links to (an episode listed on a show's page), or else the page itself.
import {spotifyItemUrl} from './site-sources';
import {
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const SAVE = 'button[data-testid="add-button"]';
const ROW = '[data-testid="tracklist-row"]';
const ROW_LINK = 'a[data-testid="internal-track-link"], a[href*="/track/"]';
const NOW_PLAYING =
	'footer, [data-testid="now-playing-bar"], [data-testid="now-playing-widget"]';
const PAGE_TITLE = 'main h1, h1';
const CARD_DEPTH = 6;
const CARD_KIND = /\/(?:track|episode)\//;

/**
The song or episode a card around the button names: the closest ancestor linking to exactly one. An ancestor
linking to several is a list or the page itself, so the search stops there. Other links near a page's own button,
such as its artist, are not items a card is about.
*/
function cardItem(button: Element, page: string | null) {
	let container = button.parentElement;
	for (let depth = 0; container && depth < CARD_DEPTH; depth++) {
		const items = new Map<string, Element>();
		for (const link of container.querySelectorAll('a[href]')) {
			const url = spotifyItemUrl(link.getAttribute('href') ?? '');
			if (url && CARD_KIND.test(url) && url !== page && !items.has(url)) {
				items.set(url, link);
			}
		}

		if (items.size > 1) {
			return undefined;
		}

		const [found] = items;
		if (found) {
			return {url: found[0], title: squash(found[1].textContent)};
		}

		container = container.parentElement;
	}

	return undefined;
}

export function createSpotifyReader(document: Document): SourceReader {
	return (event) => {
		const button = eventElements(event).find((element) =>
			element.matches(SAVE),
		);
		if (!button || button.getAttribute('aria-checked') === 'true') {
			return undefined;
		}

		// In a row or the now playing bar, the song is named there; the page may be another album or playlist.
		const container = button.closest(`${ROW}, ${NOW_PLAYING}`);
		if (container) {
			const link = container.querySelector(ROW_LINK);
			const url = spotifyItemUrl(link?.getAttribute('href') ?? '');
			return savedOrUnreadable(link && url, squash(link?.textContent));
		}

		const url = spotifyItemUrl(document.location.href);
		const card = cardItem(button, url);
		if (card) {
			return savedOrUnreadable(card.url, card.title);
		}

		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
