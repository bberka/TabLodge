import {bookmarksKey, sessionKey, STATE_KEY} from '../src/shared/library-state';
import {canonicalJson, hashText} from '../src/shared/library-values';

type Entry = {
	id?: string;
	tabs?: unknown[];
	name?: string;
	folderId?: string;
	createdAt?: number;
	updatedAt?: number;
};

/**
A library the way tests seed and read it: the shape the single `tablodge.state` entry had.
*/
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
	sessions: Array<{id: string; rev: number}>;
	folders: unknown[];
	bookmarkColumns: unknown[];
	bookmarks: {rev: number};
	settings: unknown;
	updatedAt: number;
};

/**
The stored library in the old single entry's shape, whichever layout it is in: the index plus its records, or the
old entry as it is.
*/
export function logicalState(
	storage: Record<string, unknown>,
): Library | undefined {
	const entry = storage[STATE_KEY] as StoredIndex | undefined;
	if (!entry || entry.layout !== 'records') {
		return structuredClone(entry) as Library | undefined;
	}

	return structuredClone({
		schemaVersion: entry.schemaVersion,
		groups: entry.sessions.map(
			(item) => storage[sessionKey(item.id, item.rev)] as Entry,
		),
		folders: entry.folders,
		bookmarkColumns: entry.bookmarkColumns,
		bookmarks: (
			storage[bookmarksKey(entry.bookmarks.rev)] as {items: unknown[]}
		).items,
		settings: entry.settings,
		updatedAt: entry.updatedAt,
	});
}

/**
The fixture stored the way the worker stores a library: an index and one key per session. A fixture that the
layout cannot hold (a session without an id, two with the same id) is left to stay in the old single entry.
*/
export function recordsLayout(seed: Library): Record<string, unknown> {
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

/**
Replaces the stored library with `seed`, the way a test edits it after the worker started: per-record when the layout can hold it.
*/
export function storeLibrary(storage: Record<string, unknown>, seed: Library) {
	for (const key of Object.keys(storage)) {
		if (
			key === STATE_KEY ||
			key.startsWith('tablodge.session.') ||
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

/**
Copies a value with every object's keys in sorted order, which is how `chrome.storage` hands values back.
Mocks use it so a checksum that depends on key order fails here and not in a real browser.
*/
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
