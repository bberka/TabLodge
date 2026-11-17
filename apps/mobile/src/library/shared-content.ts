/*
What another app shared with TabLodge, decided without Android: a link to save, an export file to import, a backup
to restore, or a file the app cannot use. The share library copies a shared file into the app's cache before handing
it over; the app reads that copy once and `cacheCopies` lists the copies so they can be deleted.
*/
import {extractUrls, splitShared} from './store-shape';

export type SharedFile = {
	path?: string | null;
	fileName?: string | null;
	mimeType?: string | null;
	size?: number | null;
};

export type IncomingShare = {
	text?: string | null;
	webUrl?: string | null;
	meta?: {title?: string} | null;
	files?: readonly SharedFile[] | null;
};

export type ShareOutcome =
	| {kind: 'link'; text: string; title: string; urls: string[]}
	| {kind: 'import' | 'backup'; path: string; name: string; size?: number}
	| {kind: 'unreadable'}
	| {kind: 'refused'};

export const FILE_REFUSED =
	'TabLodge cannot open this file. Share a link, an export (JSON, CSV, HTML, Markdown or a text list) or a backup ZIP.';

const IMPORT_EXTENSIONS = new Set([
	'json',
	'csv',
	'tsv',
	'html',
	'htm',
	'md',
	'markdown',
	'txt',
]);

const BACKUP_TYPES = new Set([
	'application/zip',
	'application/x-zip-compressed',
]);

/**
What a shared file is for. The name decides first, because apps often send a generic or wrong type.
*/
function fileKind(file: SharedFile): 'import' | 'backup' | undefined {
	const name = (file.fileName ?? '').toLowerCase();
	if (name.endsWith('.zip') || name.endsWith('.zip.enc')) {
		return 'backup';
	}

	if (IMPORT_EXTENSIONS.has(name.split('.').pop() ?? '')) {
		return 'import';
	}

	const mime = (file.mimeType ?? '').toLowerCase();
	if (BACKUP_TYPES.has(mime)) {
		return 'backup';
	}

	return mime.startsWith('text/') || mime === 'application/json'
		? 'import'
		: undefined;
}

export function readShare(share: IncomingShare): ShareOutcome {
	// Browsers share "Page title https://example.com"; the words around the link become the title.
	const full = share.text ?? share.webUrl ?? '';
	const parts = splitShared(full);
	const urls = extractUrls(full);
	const file = share.files?.[0];
	const kind = file ? fileKind(file) : undefined;
	if (file && kind) {
		// The library falls back to the content address when it could not copy the file, which the app cannot read.
		return file.path?.startsWith('file://')
			? {
					kind,
					path: file.path,
					name: file.fileName ?? '',
					...(typeof file.size === 'number' && {size: file.size}),
				}
			: {kind: 'unreadable'};
	}

	if (file && !share.webUrl && urls.length === 0) {
		return {kind: file.mimeType ? 'refused' : 'unreadable'};
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
