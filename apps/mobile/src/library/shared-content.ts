/*
What another app shared with TabLodge, decided without Android: a link to save, or files to refuse. The app keeps
links only, so a shared photo or document is never stored. The share library copies a shared file into the app's
cache before handing it over, and `cacheCopies` lists those copies so they can be deleted.
*/
import {extractUrls, splitShared} from './store-shape';

export type IncomingShare = {
	text?: string | null;
	webUrl?: string | null;
	meta?: {title?: string} | null;
	files?: ReadonlyArray<{path?: string | null}> | null;
};

export type ShareOutcome =
	{kind: 'link'; text: string; title: string; urls: string[]} | {kind: 'files'};

export const FILES_REFUSED =
	'TabLodge saves links, not files, so nothing was saved. Share a link to it instead.';

export function readShare(share: IncomingShare): ShareOutcome {
	// Browsers share "Page title https://example.com"; the words around the link become the title.
	const full = share.text ?? share.webUrl ?? '';
	const parts = splitShared(full);
	const urls = extractUrls(full);
	if ((share.files?.length ?? 0) > 0 && !share.webUrl && urls.length === 0) {
		return {kind: 'files'};
	}

	return {
		kind: 'link',
		text: share.webUrl ?? parts.url ?? full,
		title: share.meta?.title || parts.title,
		urls,
	};
}

/**
The shared files that are copies in this app's cache folder (`cacheUri`, ending in a slash). Files the share
library left where they were are not the app's to delete.
*/
export function cacheCopies(share: IncomingShare, cacheUri: string): string[] {
	return (share.files ?? []).flatMap((file) =>
		file.path?.startsWith(cacheUri) &&
		!file.path.slice(cacheUri.length).includes('..')
			? [file.path]
			: [],
	);
}
