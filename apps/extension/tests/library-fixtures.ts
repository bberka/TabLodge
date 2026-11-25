import {bookmarksKey, sessionKey, STATE_KEY} from '../src/shared/library-state';
import {PAGE_SIZE} from '../src/shared/library-index';
import {canonicalJson, hashText} from '../src/shared/library-values';

type Entry = {
	id?: string;
	tabs?: unknown[];
	name?: string;
	folderId?: string;
	createdAt?: number;
	updatedAt?: number;
};

export type Library = {
	schemaVersion?: number;
	groups?: Entry[];
	folders?: unknown[];
	bookmarkColumns?: unknown[];
	bookmarks?: unknown[];
	settings?: unknown;
	updatedAt?: number;
};

type StoredIndex = {
	layout?: string;
	schemaVersion: number;
	sessions?: Array<{id: string; rev: number}>;
	sessionPages?: Array<{key: string}>;
	bookmarkChunks?: Array<{key: string}>;
	folders: unknown[];
	bookmarkColumns: unknown[];
	bookmarks?: {rev: number};
	settings: unknown;
	updatedAt: number;
};

export function logicalState(
	storage: Record<string, unknown>,
): Library | undefined {
	const entry = storage[STATE_KEY] as StoredIndex | undefined;
	if (!entry || entry.layout !== 'records') {
		return structuredClone(entry) as Library | undefined;
	}

	const sessions = entry.sessionPages
		? entry.sessionPages.flatMap(
				(page) =>
					(storage[page.key] as {items: Array<{id: string; rev: number}>})
						.items,
			)
		: (entry.sessions ?? []);
	const bookmarks = entry.bookmarkChunks
		? entry.bookmarkChunks.flatMap(
				(chunk) => (storage[chunk.key] as {items: unknown[]}).items,
			)
		: (storage[bookmarksKey(entry.bookmarks!.rev)] as {items: unknown[]}).items;
	return structuredClone({
		schemaVersion: entry.schemaVersion === 11 ? 10 : entry.schemaVersion,
		groups: sessions.map(
			(item) => storage[sessionKey(item.id, item.rev)] as Entry,
		),
		folders: entry.folders,
		bookmarkColumns: entry.bookmarkColumns,
		bookmarks,
		settings: entry.settings,
		updatedAt: entry.updatedAt,
	});
}

export function recordsLayout(
	seed: Library,
	layout: 10 | 11 = 11,
): Record<string, unknown> {
	const groups = seed.groups ?? [];
	const ids = new Set<string>();
	const storable =
		Array.isArray(groups) &&
		groups.every((group) => {
			if (
				typeof group !== 'object' ||
				typeof group.id !== 'string' ||
				group.id === '' ||
				ids.has(group.id) ||
				!Array.isArray(group.tabs)
			) {
				return false;
			}

			ids.add(group.id);
			return true;
		}) &&
		(seed.bookmarks === undefined || Array.isArray(seed.bookmarks));
	if (!storable) {
		return {};
	}

	const bookmarks = seed.bookmarks ?? [];
	if (layout === 11) {
		return pagedLayout(seed, groups as Array<Entry & {id: string}>, bookmarks);
	}

	return {
		[STATE_KEY]: {
			schemaVersion: 10,
			layout: 'records',
			rev: 1,
			updatedAt: seed.updatedAt ?? 0,
			folders: seed.folders ?? [],
			bookmarkColumns: seed.bookmarkColumns ?? [],
			settings: seed.settings,
			sessions: groups.map((group) => ({
				id: group.id,
				rev: 1,
				hash: hashText(canonicalJson(group)),
				tabs: group.tabs?.length ?? 0,
				name: group.name ?? '',
				folderId: group.folderId ?? '',
				createdAt: group.createdAt ?? 0,
				updatedAt: group.updatedAt ?? 0,
			})),
			bookmarks: {
				rev: 1,
				hash: hashText(canonicalJson(bookmarks)),
				count: bookmarks.length,
			},
			garbage: [],
		},
		...Object.fromEntries(
			groups.map((group) => [sessionKey(group.id!, 1), group]),
		),
		[bookmarksKey(1)]: {items: bookmarks},
	};
}

export function storeLibrary(storage: Record<string, unknown>, seed: Library) {
	for (const key of Object.keys(storage)) {
		if (
			key === STATE_KEY ||
			key.startsWith('tablodge.session.') ||
			key.startsWith('tablodge.sidx.') ||
			key.startsWith('tablodge.bmchunk.') ||
			key.startsWith('tablodge.bookmarks.')
		) {
			Reflect.deleteProperty(storage, key);
		}
	}

	const records = recordsLayout(seed);
	Object.assign(
		storage,
		Object.keys(records).length > 0
			? records
			: {
					[STATE_KEY]: {
						...structuredClone(seed),
						schemaVersion: Math.min(Number(seed.schemaVersion) || 0, 9),
					},
				},
	);
}

export function sortKeysDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item: unknown) => sortKeysDeep(item)) as T;
	}

	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => [key, sortKeysDeep(item)]),
		) as T;
	}

	return value;
}

function pagedLayout(
	seed: Library,
	groups: Array<Entry & {id: string}>,
	bookmarks: unknown[],
): Record<string, unknown> {
	const entries = groups.map((group) => ({
		id: group.id,
		rev: 1,
		hash: hashText(canonicalJson(group)),
		tabs: group.tabs?.length ?? 0,
		name: group.name ?? '',
		folderId: group.folderId ?? '',
		createdAt: group.createdAt ?? 0,
		updatedAt: group.updatedAt ?? 0,
	}));
	const pieces = (prefix: string, items: unknown[]) =>
		Array.from({length: Math.ceil(items.length / PAGE_SIZE)}, (_, n) => {
			const slice = items.slice(n * PAGE_SIZE, (n + 1) * PAGE_SIZE);
			return {
				key: `${prefix}${n}.1`,
				hash: hashText(canonicalJson(slice)),
				count: slice.length,
				slice,
			};
		});
	const pages = pieces('tablodge.sidx.', entries);
	const chunks = pieces('tablodge.bmchunk.', bookmarks);
	const refs = (list: typeof pages) =>
		list.map(({key, hash, count}) => ({key, hash, count}));
	return {
		[STATE_KEY]: {
			schemaVersion: 11,
			layout: 'records',
			rev: 1,
			updatedAt: seed.updatedAt ?? 0,
			folders: seed.folders ?? [],
			bookmarkColumns: seed.bookmarkColumns ?? [],
			settings: seed.settings,
			sessionPages: refs(pages),
			bookmarkChunks: refs(chunks),
			garbage: [],
		},
		...Object.fromEntries(
			groups.map((group) => [sessionKey(group.id, 1), group]),
		),
		...Object.fromEntries(
			[...pages, ...chunks].map(({key, slice}) => [key, {items: slice}]),
		),
	};
}
