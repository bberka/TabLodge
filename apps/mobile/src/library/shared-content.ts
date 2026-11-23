import {pageAddress} from '../../../extension/src/shared/quotes';
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
	| {
			kind: 'link';
			text: string;
			title: string;
			urls: string[];
			quote?: string;
	  }
	| {kind: 'quote'; quote: string; url?: string}
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

const WEB_LINK = /https?:\/\/[^\s"'<>]+/i;
const QUOTED = /^["'«»“”„]([\s\S]+)["'«»“”„]$/;

function unquote(text: string) {
	const trimmed = text.trim();
	return (QUOTED.exec(trimmed)?.[1] ?? trimmed).trim();
}

export function readShare(share: IncomingShare): ShareOutcome {
	const full = share.text ?? share.webUrl ?? '';
	const parts = splitShared(full);
	const urls = extractUrls(full);
	const file = share.files?.[0];
	const kind = file ? fileKind(file) : undefined;
	if (file && kind) {
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

	if (!file && !share.webUrl) {
		const trimmed = full.trim();
		if (urls.length === 0 && QUOTED.test(trimmed)) {
			return {kind: 'quote', quote: unquote(trimmed)};
		}

		if (urls.length === 1 && urls[0].includes(':~:text=')) {
			const words = unquote(full.replace(WEB_LINK, ''));
			if (words) {
				return {kind: 'quote', quote: words, url: pageAddress(urls[0])};
			}
		}
	}

	const words = urls.length <= 1 ? unquote(full.replace(WEB_LINK, '')) : '';
	return {
		kind: 'link',
		text: share.webUrl ?? parts.url ?? full,
		title: share.meta?.title || parts.title,
		urls,
		...(words && {quote: words}),
	};
}

export function cacheCopies(share: IncomingShare, cacheUri: string): string[] {
	return (share.files ?? []).flatMap((file) =>
		file.path?.startsWith(cacheUri) &&
		!file.path.slice(cacheUri.length).includes('..')
			? [file.path]
			: [],
	);
}
