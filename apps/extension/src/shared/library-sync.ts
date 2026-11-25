import {isCount, isRecord} from './library-values';

export type RecordSync = {h?: string; d?: string; o?: string};
export type TombstoneKind =
	| 'session'
	| 'tab'
	| 'bookmark'
	| 'column'
	| 'folder'
	| 'preference'
	| 'setting'
	| 'trash'
	| 'note'
	| 'tag'
	| 'source';
export type Tombstone = {
	kind: TombstoneKind;
	id: string;
	parentId?: string;
	deletedAt: number;
	purgeAfter: number;
	sync?: RecordSync;
};

export type SyncMap = Record<string, RecordSync>;

const SYNC_TEXT_MAX = 64;
export const TOMBSTONE_KINDS: ReadonlySet<string> = new Set([
	'session',
	'tab',
	'bookmark',
	'column',
	'folder',
	'preference',
	'setting',
	'trash',
	'note',
	'tag',
	'source',
]);
export const syncText = (value: unknown) =>
	typeof value === 'string' && value !== '' && value.length <= SYNC_TEXT_MAX
		? value
		: undefined;

export function parseSync(value: unknown): RecordSync | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const sync: RecordSync = {};
	for (const key of ['h', 'd', 'o'] as const) {
		const text = syncText(value[key]);
		if (text !== undefined) {
			sync[key] = text;
		}
	}

	return Object.keys(sync).length > 0 ? sync : undefined;
}

export function parseSyncMap(value: unknown): SyncMap {
	const map: SyncMap = {};
	if (isRecord(value)) {
		for (const [id, entry] of Object.entries(value)) {
			const sync = parseSync(entry);
			if (sync) {
				map[id] = sync;
			}
		}
	}

	return map;
}

export function parseTombstones(value: unknown): Tombstone[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((entry: unknown): Tombstone[] => {
		if (
			!isRecord(entry) ||
			typeof entry.kind !== 'string' ||
			!TOMBSTONE_KINDS.has(entry.kind) ||
			typeof entry.id !== 'string' ||
			entry.id === '' ||
			!isCount(entry.deletedAt) ||
			!isCount(entry.purgeAfter)
		) {
			return [];
		}

		const parentId = syncText(entry.parentId);
		const sync = parseSync(entry.sync);
		return [
			{
				kind: entry.kind as TombstoneKind,
				id: entry.id,
				...(parentId && {parentId}),
				deletedAt: entry.deletedAt,
				purgeAfter: entry.purgeAfter,
				...(sync && {sync}),
			},
		];
	});
}

export function carriedSync(
	sidecar: unknown,
	field: 'tabs' | 'items',
	ids: ReadonlySet<string>,
): SyncMap {
	const source = isRecord(sidecar) ? sidecar : {};
	const map = parseSyncMap(field === 'tabs' ? source.tabs : source.items);
	return Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
}

export const keepOnly = (
	map: SyncMap | undefined,
	ids: ReadonlySet<string>,
): SyncMap =>
	Object.fromEntries(Object.entries(map ?? {}).filter(([id]) => ids.has(id)));
