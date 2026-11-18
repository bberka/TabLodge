// Your Library on Spotify: notices the user clicking the save button (`data-testid="add-button"`) on a song, album,
// playlist, show, or episode. It reads `aria-checked="true"` once the item is saved, and a click then removes it or
// opens a playlist picker, which saves nothing; the attribute is the same in every interface language. The item is
// the song link of the track list row the button is in, the song in the now playing bar, or else the page itself on
// an album's, playlist's, show's, or episode's own page.
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
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
