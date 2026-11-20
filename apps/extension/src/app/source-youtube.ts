// YouTube Watch later: notices the user adding a video to Watch later, by any of the site's three controls:
//   - the Watch later button on a thumbnail (its label turns to "Added" once the video is in the list)
//   - "Save to Watch later" in a video's menu, which YouTube opens in a popup outside the video
//   - the Watch later checkbox in the "Save video to..." dialog, which also opens outside the video
// The controls are found by their English labels, so another interface language finds none and saves nothing.
// The Watch later playlist (/playlist?list=WL), which only its owner can open, is read for catch-up (#383).
import type {SavedPageReader} from './source-catch-up';
import {youtubeVideoUrl} from './site-sources';
import {
	controlLabel,
	rememberLast,
	eventElements,
	squash,
	type SourceLink,
	type SourceReader,
} from './source-reader';

const VIDEO_ITEMS = [
	'ytd-rich-item-renderer',
	'yt-lockup-view-model',
	'ytd-video-renderer',
	'ytd-compact-video-renderer',
	'ytd-grid-video-renderer',
	'ytd-playlist-video-renderer',
	'ytd-playlist-panel-video-renderer',
	'ytd-reel-item-renderer',
	'ytm-shorts-lockup-view-model',
].join(',');
// The area under the player: its menu and Save button act on the video being watched.
const WATCH_AREA = 'ytd-watch-metadata, #above-the-fold';
const CONTROL = 'button, [role="button"], [role="menuitem"], [role="checkbox"]';
const OPTION = [
	'ytd-playlist-add-to-option-renderer',
	'toggleable-list-item-view-model',
	'yt-list-item-view-model',
	'[role="checkbox"]',
].join(',');

const isWatchLater = (label: string) => /^watch later$/i.test(label);
const isSaveToWatchLater = (label: string) =>
	/^save to watch later$/i.test(label);

function itemLink(item: Element): SourceLink | undefined {
	for (const anchor of item.querySelectorAll(':scope a[href]')) {
		const url = youtubeVideoUrl(anchor.getAttribute('href') ?? '');
		if (!url) {
			continue;
		}

		const heading = item.querySelector(
			':scope #video-title, :scope [id="video-title-link"], :scope h3 a, :scope h3, :scope .yt-lockup-metadata-view-model__title',
		);
		const title = squash(
			heading?.getAttribute('title') ??
				heading?.textContent ??
				anchor.getAttribute('title'),
		);
		return {url, title};
	}

	return undefined;
}

// YouTube keeps the pages it navigated away from, hidden; only the shown playlist page is read.
const WATCH_LATER_ROW =
	'ytd-browse[page-subtype="playlist"]:not([hidden]) ytd-playlist-video-renderer';

export const readYoutubeSavedPage: SavedPageReader = (document) => {
	const {pathname, search} = document.location;
	if (
		pathname !== '/playlist' ||
		new URLSearchParams(search).get('list') !== 'WL'
	) {
		return undefined;
	}

	return [...document.querySelectorAll(WATCH_LATER_ROW)]
		.map((row) => itemLink(row))
		.filter((link) => link !== undefined);
};

function watchedVideo(document: Document): SourceLink | undefined {
	const url = youtubeVideoUrl(document.location.href);
	if (!url) {
		return undefined;
	}

	const heading = squash(
		document.querySelector('ytd-watch-metadata h1, #above-the-fold h1')
			?.textContent,
	);
	return {
		url,
		title: heading || squash(document.title.replace(/ - YouTube$/, '')),
	};
}

/**
Whether a Watch later option in the Save dialog is being ticked: undefined when its state cannot be read.
*/
function optionTicks(option: Element): boolean | undefined {
	const box = option.matches('[role="checkbox"]')
		? option
		: option.querySelector('[role="checkbox"], [aria-checked], [aria-pressed]');
	const state =
		box?.getAttribute('aria-checked') ?? box?.getAttribute('aria-pressed');
	if (state === 'true') {
		return false;
	}

	return state === 'false' ? true : undefined;
}

export function createYoutubeReader(
	document: Document,
	now = () => Date.now(),
): SourceReader {
	// The video a menu or dialog opened from, set by the click that opened it.
	const lastItem = rememberLast<SourceLink | undefined>(now);
	return (event) => {
		const path = eventElements(event);
		const item = path.find((element) => element.matches(VIDEO_ITEMS));
		const control = path.find((element) => element.matches(CONTROL));
		if (control && item && isWatchLater(controlLabel(control))) {
			const link = itemLink(item);
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		const menuItem = path.some(
			(element) =>
				element.matches(
					'ytd-menu-service-item-renderer, yt-list-item-view-model, [role="menuitem"]',
				) && isSaveToWatchLater(controlLabel(element)),
		);
		if (menuItem) {
			const link = item ? itemLink(item) : lastItem.get();
			return link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		const option = path.find(
			(element) =>
				element.matches(OPTION) &&
				isWatchLater(
					squash(
						element.querySelector('#label, [id="label"]')?.textContent ??
							element.getAttribute('aria-label') ??
							element.textContent,
					),
				),
		);
		if (option) {
			const ticks = optionTicks(option);
			if (ticks === false) {
				return undefined;
			}

			const link = lastItem.get();
			return ticks && link ? {kind: 'save', link} : {kind: 'unreadable'};
		}

		if (item) {
			lastItem.set(itemLink(item));
		} else if (path.some((element) => element.matches(WATCH_AREA))) {
			lastItem.set(watchedVideo(document));
		}

		return undefined;
	};
}
