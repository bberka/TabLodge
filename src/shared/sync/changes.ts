/*
The unit of sync: one change to one record (a session, saved tab, bookmark, column, folder, or preference).
A change carries the whole record, its stamp, and its order key, or marks the record deleted. Two changes to the
same record are resolved by stamp alone (last writer wins), so every replica that sees the same changes ends
with the same library whatever order they arrive in.
*/
import {isRecord} from '../library-values';
import {TOMBSTONE_KINDS, type TombstoneKind} from '../library-sync';
import {compareStamps, parseStamp} from './clock';
import {isOrderKey} from './order-key';

export type SyncChange = {
	kind: TombstoneKind;
	id: string;
	/**
	The session of a saved tab. Tab ids are only unique inside their session.
	*/
	parentId?: string;
	h: string;
	d: string;
	o?: string;
	deleted?: true;
	/**
	The record itself, absent when deleted. The protocol does not look inside it.
	*/
	value?: unknown;
};

const ID_MAX = 100;
const DEVICE_MAX = 64;

const isId = (value: unknown, max: number): value is string =>
	typeof value === 'string' && value !== '' && value.length <= max;

/**
Which record a change is about. Tabs are keyed under their session, so moving a tab to another session is a
delete in one and a create in the other.
*/
export const recordKey = (
	change: Pick<SyncChange, 'kind' | 'id' | 'parentId'>,
) =>
	change.kind === 'tab'
		? `tab:${change.parentId ?? ''}:${change.id}`
		: `${change.kind}:${change.id}`;

/**
A change from the network, checked field by field. Returns undefined for anything malformed; the record value is
validated later by the code that applies it to the library.
*/
export function parseChange(value: unknown): SyncChange | undefined {
	if (
		!isRecord(value) ||
		typeof value.kind !== 'string' ||
		!TOMBSTONE_KINDS.has(value.kind) ||
		!isId(value.id, ID_MAX) ||
		typeof value.h !== 'string' ||
		!parseStamp(value.h) ||
		!isId(value.d, DEVICE_MAX)
	) {
		return undefined;
	}

	const kind = value.kind as TombstoneKind;
	if (
		kind === 'tab'
			? !isId(value.parentId, ID_MAX)
			: value.parentId !== undefined
	) {
		return undefined;
	}

	if (value.o !== undefined && !isOrderKey(value.o)) {
		return undefined;
	}

	const deleted = value.deleted === true;
	if (deleted ? value.value !== undefined : value.value === undefined) {
		return undefined;
	}

	return {
		kind,
		id: value.id,
		...(kind === 'tab' && {parentId: value.parentId as string}),
		h: value.h,
		d: value.d,
		...(value.o !== undefined && {o: value.o}),
		...(deleted ? {deleted: true} : {value: value.value}),
	};
}

/**
True when `incoming` should replace `current`. Equal stamps are the same write, so it is not applied twice.
*/
export const supersedes = (
	incoming: SyncChange,
	current: SyncChange | undefined,
) => !current || compareStamps(incoming, current) > 0;

/**
Applies the changes that win to `records` (keyed by `recordKey`) and returns them. Deletes stay in the map as
tombstones so a later, older edit cannot bring the record back.
*/
export function mergeInto(
	records: Map<string, SyncChange>,
	changes: Iterable<SyncChange>,
): SyncChange[] {
	const applied: SyncChange[] = [];
	for (const change of changes) {
		const key = recordKey(change);
		if (!supersedes(change, records.get(key))) {
			continue;
		}

		records.set(key, change);
		applied.push(change);
	}

	return applied;
}
