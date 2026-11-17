/*
Readable copies of saved pages, kept on one device and never synced. A copy is the page's text as blocks (headings,
paragraphs, list items, quotes, code), never HTML, so showing one cannot run anything the page carried.

Copies belong to an address, not to a link id: the phone's undo puts deleted links back under new ids, and a saved tab
and a bookmark of the same page share one copy. A copy lives while any link in the library or the trash has its
address, so it goes to the trash with its link and comes back with it; `sweep` drops the rest. Editing a link's
address therefore drops its copy.

The extension keeps copies in `chrome.storage.local`, the Android app in its key-value store. Both pass the same
three calls (`CopyStorage`), so the index, the caps, and the budget are one piece of code.
*/
import {cleanText, normalizeUrl} from './library-normalize';
import {hashText, isRecord} from './library-values';
import {trashedUrls, type TrashEntry} from './trash';
import type {Bookmark, Session} from './types';

export const COPY_BLOCK_TYPES = [
	'heading',
	'paragraph',
	'item',
	'quote',
	'code',
] as const;
export type CopyBlockType = (typeof COPY_BLOCK_TYPES)[number];
export type CopyBlock = {type: CopyBlockType; text: string};

export type PageCopy = {
	v: 1;
	url: string;
	title: string;
	byline?: string;
	savedAt: number;
	blocks: CopyBlock[];
};

/**
What the index says about one copy, enough to list copies and count the budget without reading them.
*/
export type CopyEntry = {
	url: string;
	key: string;
	title: string;
	savedAt: number;
	size: number;
};

export type CopyStorage = {
	get(keys: string[]): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(keys: string[]): Promise<void>;
};

export const COPY_INDEX_KEY = 'tablodge.copies';
/**
Where the extension's capture script leaves a copy in the tab for the worker to collect.
*/
export const CAPTURE_GLOBAL = '__tablodgePageCopy';
export const COPY_KEY_PREFIX = 'tablodge.copy.';
/**
Text in one copy, counted in characters.
*/
export const COPY_MAX_CHARS = 1_000_000;
/**
All copies on one device, counted as stored. A full backup carries every copy in one message and one ZIP entry, which
the extension caps near 60 MB, so the budget leaves room for the library beside it.
*/
export const COPY_BUDGET = 25_000_000;
const TITLE_MAX = 300;
const BYLINE_MAX = 200;
const BLOCK_TYPES: ReadonlySet<string> = new Set(COPY_BLOCK_TYPES);

export type KeepFailure = 'empty' | 'too-large' | 'full';
export type KeepResult =
	| {ok: true; entry: CopyEntry}
	| {ok: false; reason: KeepFailure; error: string};

const megabytes = (size: number) =>
	`${Math.max(1, Math.round(size / 1_000_000))} MB`;

export const COPY_ERRORS: Record<KeepFailure, string> = {
	empty: 'This page has no text to keep.',
	'too-large': `This page is too long to keep a copy of. A copy holds up to ${megabytes(COPY_MAX_CHARS)} of text.`,
	full: `Copies are full. This device keeps up to ${megabytes(COPY_BUDGET)} of copies; delete copies you no longer need, then try again.`,
};

export const copyTextLength = (blocks: readonly CopyBlock[]) =>
	blocks.reduce((sum, block) => sum + block.text.length, 0);

export const copySize = (copy: PageCopy) => JSON.stringify(copy).length;

/**
A copy from storage, a backup, a page, or the network, checked field by field. Blocks of an unknown type or without
text are dropped; undefined when it has no address. The caps are `keep`'s to enforce, so it can say which one failed.
*/
export function parsePageCopy(value: unknown): PageCopy | undefined {
	if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.blocks)) {
		return undefined;
	}

	const url = normalizeUrl(value.url);
	const savedAt = Number(value.savedAt);
	if (!url || !Number.isFinite(savedAt) || savedAt <= 0) {
		return undefined;
	}

	const blocks: CopyBlock[] = [];
	for (const block of value.blocks as unknown[]) {
		if (
			isRecord(block) &&
			typeof block.type === 'string' &&
			BLOCK_TYPES.has(block.type) &&
			typeof block.text === 'string' &&
			block.text.trim() !== ''
		) {
			blocks.push({type: block.type as CopyBlockType, text: block.text});
		}
	}

	const byline = cleanText(value.byline, '', BYLINE_MAX);
	return {
		v: 1,
		url,
		title: cleanText(value.title, url, TITLE_MAX),
		...(byline && {byline}),
		savedAt,
		blocks,
	};
}

function parseIndex(value: unknown): CopyEntry[] {
	const items =
		isRecord(value) && Array.isArray(value.items) ? value.items : [];
	const seen = new Set<string>();
	return (items as unknown[]).flatMap((item) => {
		const bytes = isRecord(item) ? Number(item.size) : -1;
		if (
			!isRecord(item) ||
			typeof item.url !== 'string' ||
			typeof item.key !== 'string' ||
			!item.key.startsWith(COPY_KEY_PREFIX) ||
			seen.has(item.url) ||
			!Number.isSafeInteger(bytes) ||
			bytes < 0
		) {
			return [];
		}

		seen.add(item.url);
		return [
			{
				url: item.url,
				key: item.key,
				title: cleanText(item.title, item.url, TITLE_MAX),
				savedAt: Number(item.savedAt) || 0,
				size: bytes,
			},
		];
	});
}

/**
Every address a copy may belong to: the links in the library and the links in the trash.
*/
export function copyLinkUrls(
	library: {groups: readonly Session[]; bookmarks: readonly Bookmark[]},
	trash: readonly TrashEntry[],
): Set<string> {
	return new Set([
		...library.bookmarks.map((bookmark) => bookmark.url),
		...library.groups.flatMap((group) => group.tabs.map((tab) => tab.url)),
		...trashedUrls(trash, 'sessions'),
		...trashedUrls(trash, 'bookmarks'),
	]);
}

export type CopyStore = ReturnType<typeof createCopyStore>;

/**
The copies on one device. Calls run one at a time, so the index and the stored copies never disagree.
*/
export function createCopyStore(
	storage: CopyStorage,
	budget: number = COPY_BUDGET,
) {
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(run: () => Promise<T>): Promise<T> => {
		const next = queue.then(run);
		queue = next.catch(() => undefined);
		return next;
	};

	const readIndex = async () =>
		parseIndex((await storage.get([COPY_INDEX_KEY]))[COPY_INDEX_KEY]);
	const writeIndex = (items: CopyEntry[]) =>
		storage.set({[COPY_INDEX_KEY]: {v: 1, items}});

	const freeKey = (items: readonly CopyEntry[], url: string) => {
		const base = `${COPY_KEY_PREFIX}${hashText(url)}`;
		const taken = new Set(items.map((item) => item.key));
		let key = base;
		for (let n = 2; taken.has(key); n += 1) {
			key = `${base}-${n}`;
		}

		return key;
	};

	/**
	Stores one copy in an index that is already read, replacing the address's older copy.
	*/
	const place = async (
		items: CopyEntry[],
		copy: PageCopy,
	): Promise<KeepResult> => {
		if (copy.blocks.length === 0) {
			return {ok: false, reason: 'empty', error: COPY_ERRORS.empty};
		}

		if (copyTextLength(copy.blocks) > COPY_MAX_CHARS) {
			return {ok: false, reason: 'too-large', error: COPY_ERRORS['too-large']};
		}

		const size = copySize(copy);
		const old = items.find((item) => item.url === copy.url);
		const used = items.reduce((sum, item) => sum + item.size, 0);
		if (used - (old?.size ?? 0) + size > budget) {
			return {ok: false, reason: 'full', error: COPY_ERRORS.full};
		}

		const entry: CopyEntry = {
			url: copy.url,
			key: old?.key ?? freeKey(items, copy.url),
			title: copy.title,
			savedAt: copy.savedAt,
			size,
		};
		await storage.set({[entry.key]: copy});
		const rest = items.filter((item) => item.url !== copy.url);
		items.splice(0, items.length, ...rest, entry);
		await writeIndex(items);
		return {ok: true, entry};
	};

	return {
		list: () => serial(readIndex),

		async usage() {
			const items = await serial(readIndex);
			return {
				count: items.length,
				size: items.reduce((sum, item) => sum + item.size, 0),
				budget,
			};
		},

		keep: (copy: PageCopy) =>
			serial(async () => place(await readIndex(), copy)),

		read: (url: string) =>
			serial(async () => {
				const entry = (await readIndex()).find((item) => item.url === url);
				if (!entry) {
					return undefined;
				}

				const copy = parsePageCopy((await storage.get([entry.key]))[entry.key]);
				return copy?.url === url ? copy : undefined;
			}),

		remove: (url: string) =>
			serial(async () => {
				const items = await readIndex();
				const gone = items.filter((item) => item.url === url);
				if (gone.length === 0) {
					return false;
				}

				await writeIndex(items.filter((item) => item.url !== url));
				await storage.remove(gone.map((item) => item.key));
				return true;
			}),

		/**
		Drops every copy whose address is not in `liveUrls`. Only pass a set read completely from the library and the
		trash: a partial read would delete copies that still have a link. Returns how many went.
		*/
		sweep: (liveUrls: ReadonlySet<string>) =>
			serial(async () => {
				const items = await readIndex();
				const gone = items.filter((item) => !liveUrls.has(item.url));
				if (gone.length === 0) {
					return 0;
				}

				await writeIndex(items.filter((item) => liveUrls.has(item.url)));
				await storage.remove(gone.map((item) => item.key));
				return gone.length;
			}),

		/**
		Every copy, for a full backup.
		*/
		all: () =>
			serial(async () => {
				const items = await readIndex();
				if (items.length === 0) {
					return [];
				}

				const stored = await storage.get(items.map((item) => item.key));
				return items.flatMap((item) => {
					const copy = parsePageCopy(stored[item.key]);
					return copy?.url === item.url ? [copy] : [];
				});
			}),

		/**
		Copies from a backup, checked again and added under the same caps. Returns how many were kept.
		*/
		restore: (values: readonly unknown[]) =>
			serial(async () => {
				const items = await readIndex();
				let kept = 0;
				for (const value of values) {
					const copy = parsePageCopy(value);
					if (copy && (await place(items, copy)).ok) {
						kept += 1;
					}
				}

				return kept;
			}),
	};
}
