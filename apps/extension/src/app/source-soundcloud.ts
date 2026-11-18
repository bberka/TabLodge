// Likes on SoundCloud: notices the user clicking Like (`.sc-button-like`) on a track or playlist. A liked one carries
// `.sc-button-selected`, and a click on it unlikes, which saves nothing; both are classes, so this works in every
// interface language. The item is the title link of the list row or player bar the button is in, or else the page
// itself on a track's or playlist's own page.
import {soundcloudItemUrl} from './site-sources';
import {
	eventElements,
	squash,
	savedOrUnreadable,
	type SourceReader,
} from './source-reader';

const LIKE = '.sc-button-like';
const LIKED = 'sc-button-selected';
const ITEMS = [
	['.playbackSoundBadge', 'a.playbackSoundBadge__titleLink'],
	[
		'.soundList__item, .searchList__item, .soundBadgeList__item, .sound__body',
		'a.soundTitle__title, a.soundBadge__title',
	],
] as const;
const PAGE_TITLE = '.soundTitle__title, h1';

export function createSoundcloudReader(document: Document): SourceReader {
	return (event) => {
		const button = eventElements(event).find((element) =>
			element.matches(LIKE),
		);
		if (!button || button.classList.contains(LIKED)) {
			return undefined;
		}

		for (const [container, title] of ITEMS) {
			const item = button.closest(container);
			if (item) {
				const link = item.querySelector(title);
				const url = soundcloudItemUrl(link?.getAttribute('href') ?? '');
				return savedOrUnreadable(link && url, squash(link?.textContent));
			}
		}

		const url = soundcloudItemUrl(document.location.href);
		const title = squash(document.querySelector(PAGE_TITLE)?.textContent);
		return savedOrUnreadable(url, title);
	};
}
