import {isRecord} from '../library-values';
import {TOMBSTONE_KINDS, type TombstoneKind} from '../library-sync';
import {compareStamps, parseStamp, type Stamp} from './clock';
import {isOrderKey} from './order-key';

export type SyncChange = {
	kind: TombstoneKind;
	id: string;
	parentId?: string;
	h: string;
	d: string;
	o?: string;
	deleted?: true;
	value?: unknown;
};

const ID_MAX = 100;
const DEVICE_MAX = 64;

const isId = (value: unknown, max: number): value is string =>
	typeof value === 'string' && value !== '' && value.length <= max;

export const recordKey = (
	change: Pick<SyncChange, 'kind' | 'id' | 'parentId'>,
) =>
	change.kind === 'tab'
		? `tab:${change.parentId ?? ''}:${change.id}`
		: `${change.kind}:${change.id}`;

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

export const supersedes = (incoming: Stamp, current: Stamp | undefined) =>
	!current || compareStamps(incoming, current) > 0;

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
