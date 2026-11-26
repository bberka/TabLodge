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
	size?: number;
};

export const TRASH_KINDS: ReadonlySet<string> = new Set([
	'session',
	'tabs',
	'bookmark',
	'column',
	'folder',
]);

const SERVER_MAX_CHANGE_SIZE = 256 * 1024;
const CHANGE_ENVELOPE_ROOM = 2048;
const AES_GCM_TAG_BYTES = 16;
export const TRASH_SYNC_MAX_BYTES =
	((SERVER_MAX_CHANGE_SIZE - CHANGE_ENVELOPE_ROOM) / 4) * 3 - AES_GCM_TAG_BYTES;

export const isTrashEntry = (value: unknown): value is TrashEntry =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.kind === 'string' &&
	isRecord(value.data);

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

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

export function syncedTrash(
	entry: TrashEntry,
	onServer = false,
): TrashEntry | undefined {
	const {size: _size, ...value} = entry;
	return onServer || utf8Bytes(JSON.stringify(value)) <= TRASH_SYNC_MAX_BYTES
		? value
		: undefined;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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
