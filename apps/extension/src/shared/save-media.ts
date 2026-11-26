import {normalizeUrl} from './library-normalize';
import {IMAGE_ERRORS, type ImageFailure} from './image-store';
import {isRecord} from './library-values';
import {siteName} from './web-url';

export type MediaSave =
	| {ok: true; url: string; title: string}
	| {ok: false; reason: 'unsupported' | 'saved' | 'trash'};

export type MediaClick = {
	mediaType?: string;
	srcUrl?: unknown;
	pageUrl?: unknown;
	pageTitle?: string;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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

	return !page || click.mediaType === 'image'
		? undefined
		: {url: page, title: click.pageTitle?.trim() || siteName(page)};
}

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

export type ImageSaveOutcome = {
	bookmark: 'unsupported' | 'trash' | 'added' | 'saved';
	failure?: ImageFailure | 'blocked';
};

const IMAGE_BLOCKED =
	'This site does not let extensions read the image, so only its address is saved.';

export function imageSaveNote(outcome: ImageSaveOutcome): string {
	if (outcome.bookmark === 'unsupported') {
		return 'Only images on http and https pages in a regular window can be saved.';
	}

	if (outcome.bookmark === 'trash') {
		return 'This address is in the trash bin. Restore it from there to keep it.';
	}

	const added = outcome.bookmark === 'added';
	if (!outcome.failure) {
		return added
			? 'Image saved and bookmarked.'
			: 'Image saved. Its bookmark was already there.';
	}

	const reason =
		outcome.failure === 'blocked'
			? IMAGE_BLOCKED
			: IMAGE_ERRORS[outcome.failure];
	return added
		? `Bookmarked, but the image was not kept. ${reason}`
		: `The image was not kept. ${reason}`;
}
