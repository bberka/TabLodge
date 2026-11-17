/*
The trash entry every app stores and syncs: what was deleted, where it came from, and the data needed to put it back.
The extension, the Android app, and the sync server all read this shape, so a deletion made on one device can be
restored on another. `data` depends on `kind` (see the restore code of each app); an app ignores fields it does not know.
*/
import type {ImportKind} from './import-formats';
import {isRecord, type Raw} from './library-values';
import type {TrashKind} from './types';

export type TrashEntry = {
	id: string;
	kind: TrashKind;
	deletedAt: number;
	label: string;
	origin: string;
	count: number;
	data: Raw;
	/**
	Serialized length of `data`, cached on this device so the size cap never re-serializes stored items. Never synced.
	*/
	size?: number;
};

export const TRASH_KINDS: ReadonlySet<string> = new Set([
	'session',
	'tabs',
	'bookmark',
	'column',
	'folder',
]);

/**
The sync server refuses a change larger than 256 KiB, and one refused change stops the whole push. An entry over this
size stays on the device that deleted it.
*/
export const TRASH_SYNC_MAX_CHARS = 200_000;

export const isTrashEntry = (value: unknown): value is TrashEntry =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.kind === 'string' &&
	isRecord(value.data);

/**
An entry from the network or a file, checked field by field. Anything malformed comes back as undefined.
*/
export function parseTrashEntry(value: unknown): TrashEntry | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		value.id === '' ||
		typeof value.kind !== 'string' ||
		!TRASH_KINDS.has(value.kind) ||
		typeof value.deletedAt !== 'number' ||
		!Number.isFinite(value.deletedAt) ||
		!isRecord(value.data)
	) {
		return undefined;
	}

	return {
		id: value.id,
		kind: value.kind as TrashKind,
		deletedAt: value.deletedAt,
		label: typeof value.label === 'string' ? value.label : '',
		origin: typeof value.origin === 'string' ? value.origin : '',
		count: Number.isSafeInteger(value.count) ? (value.count as number) : 0,
		data: value.data,
	};
}

/**
What goes to the server for an entry, or undefined when it is too large to send.
*/
export function syncedTrash(entry: TrashEntry): TrashEntry | undefined {
	const {size: _size, ...value} = entry;
	return JSON.stringify(value).length <= TRASH_SYNC_MAX_CHARS
		? value
		: undefined;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
The link addresses in the trash that an import of this kind skips, as if they were still saved: deleted sessions
and tabs for a session import, deleted bookmarks and columns for a bookmark import. Folders hold no links of their
own. `data` comes from storage or sync, so each field in it is checked.
*/
export function trashedUrls(
	trash: readonly TrashEntry[],
	kind: ImportKind,
): string[] {
	const linkItems = ({kind: entryKind, data}: TrashEntry): unknown[] => {
		if (kind === 'sessions') {
			return entryKind === 'session' && isRecord(data.session)
				? list(data.session.tabs)
				: entryKind === 'tabs'
					? list(data.items).map((item) =>
							isRecord(item) ? item.tab : undefined,
						)
					: [];
		}

		return entryKind === 'bookmark'
			? [data.bookmark]
			: entryKind === 'column'
				? list(data.bookmarks)
				: [];
	};

	return trash
		.flatMap((entry) => linkItems(entry))
		.flatMap((item) =>
			isRecord(item) && typeof item.url === 'string' ? [item.url] : [],
		);
}
