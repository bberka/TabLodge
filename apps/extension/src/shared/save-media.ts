/*
The right-click Bookmark image to and Bookmark video to actions, without the browser: the bookmark a picture, a video,
or a sound becomes, or why it is skipped. A media element with a web address of its own is saved by that address. A
stream (a blob: or data: source, as on YouTube) has none, so the page is saved instead, with the page's title. The
saved address is also the duplicate key. Until bookmarks have notes (#276), a media file's title names the page's site.
*/
import {normalizeUrl} from './library-normalize';
import {isRecord} from './library-values';
import {siteName} from './web-url';

export type MediaSave =
	| {ok: true; url: string; title: string}
	| {ok: false; reason: 'unsupported' | 'saved' | 'trash'};

export type MediaClick = {
	mediaType?: string;
	srcUrl?: unknown;
	pageUrl?: unknown;
	/**
	The title of the tab the media is in.
	*/
	pageTitle?: string;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
Bookmark addresses held in the trash: deleted bookmarks and the bookmarks of deleted columns. Entries come from
storage or sync, so every field is checked.
*/
function trashedBookmarkUrls(trash: readonly unknown[]): Set<string> {
	const urls = new Set<string>();
	for (const entry of trash) {
		if (!isRecord(entry) || !isRecord(entry.data)) {
			continue;
		}

		const items =
			entry.kind === 'bookmark'
				? [entry.data.bookmark]
				: entry.kind === 'column'
					? list(entry.data.bookmarks)
					: [];
		for (const item of items) {
			if (isRecord(item) && typeof item.url === 'string') {
				urls.add(item.url);
			}
		}
	}

	return urls;
}

const MEDIA_NOUNS: Readonly<Record<string, string>> = {
	image: 'Image',
	video: 'Video',
	audio: 'Audio',
};

function mediaBookmark(
	click: MediaClick,
): {url: string; title: string} | undefined {
	const page = normalizeUrl(click.pageUrl);
	const source = normalizeUrl(click.srcUrl);
	if (source) {
		const noun = MEDIA_NOUNS[click.mediaType ?? ''] ?? 'Image';
		return {url: source, title: `${noun} from ${siteName(page ?? source)}`};
	}

	// Images always have a source; only a video or sound can be a stream.
	return !page || click.mediaType === 'image'
		? undefined
		: {url: page, title: click.pageTitle?.trim() || siteName(page)};
}

/**
`isDuplicate` is the save duplicate rule (save-rules.ts) for the column the media goes to.
*/
export function mediaSave(
	click: MediaClick,
	isDuplicate: (url: string) => boolean,
	trash: readonly unknown[],
): MediaSave {
	const bookmark = mediaBookmark(click);
	if (!bookmark) {
		return {ok: false, reason: 'unsupported'};
	}

	if (isDuplicate(bookmark.url)) {
		return {ok: false, reason: 'saved'};
	}

	return trashedBookmarkUrls(trash).has(bookmark.url)
		? {ok: false, reason: 'trash'}
		: {ok: true, ...bookmark};
}
