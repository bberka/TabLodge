/*
The right-click Save image action, without the browser: the bookmark an image becomes, or why it is skipped.
The image address is the link and the duplicate key. Until bookmarks have notes (#276), the title names the
page's site.
*/
import {normalizeUrl} from './library-normalize';
import {isRecord} from './library-values';
import {siteName} from './web-url';

export type ImageSave =
	| {ok: true; url: string; title: string}
	| {ok: false; reason: 'unsupported' | 'saved' | 'trash'};

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

export function imageSave(
	image: {srcUrl?: unknown; pageUrl?: unknown},
	bookmarkUrls: ReadonlySet<string>,
	trash: readonly unknown[],
): ImageSave {
	const url = normalizeUrl(image.srcUrl);
	if (!url) {
		return {ok: false, reason: 'unsupported'};
	}

	if (bookmarkUrls.has(url)) {
		return {ok: false, reason: 'saved'};
	}

	if (trashedBookmarkUrls(trash).has(url)) {
		return {ok: false, reason: 'trash'};
	}

	const page = normalizeUrl(image.pageUrl);
	return {ok: true, url, title: `Image from ${siteName(page ?? url)}`};
}
