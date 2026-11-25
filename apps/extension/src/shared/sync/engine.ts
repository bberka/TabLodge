import {canonicalJson, hashText, isRecord} from '../library-values';
import type {PushResult} from './change-log';
import {recordKey, supersedes, type SyncChange} from './changes';
import {type Clock, observe, stampAt, startClock, tick} from './clock';
import {type LibraryRecord, orderGroup} from './library-records';
import {keyBetween} from './order-key';

export type ShadowEntry = {
	kind: LibraryRecord['kind'];
	id: string;
	parentId?: string;
	h: string;
	d: string;
	hash: string;
	o?: string;
	deleted?: true;
};

export type SyncState = {
	device: string;
	clock: Clock;
	cursor: number;
	purged: number;
	known?: number;
	joined: boolean;
	shadow: Record<string, ShadowEntry>;
	outbox: string[];
	unseen?: string[];
	held?: SyncChange[];
	pulled?: Array<'trash' | 'note' | 'tag' | 'source' | 'setting'>;
};

export type Records = Map<string, LibraryRecord>;

const TOMBSTONE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export const newSyncState = (device: string): SyncState => ({
	device,
	clock: startClock(),
	cursor: 0,
	purged: 0,
	joined: false,
	shadow: {},
	outbox: [],
});

const hashes = new WeakMap<object, string>();
const hashOf = (value: unknown) => {
	if (typeof value !== 'object' || value === null) {
		return hashText(canonicalJson(value));
	}

	let hash = hashes.get(value);
	if (hash === undefined) {
		hash = hashText(canonicalJson(value));
		hashes.set(value, hash);
	}

	return hash;
};

const without = (shadow: SyncState['shadow'], keys: ReadonlySet<string>) =>
	keys.size === 0
		? shadow
		: Object.fromEntries(
				Object.entries(shadow).filter(([key]) => !keys.has(key)),
			);

export function orderList(
	keys: readonly string[],
	current: (key: string) => string | undefined,
): string[] {
	const known = keys.map((key) => current(key));
	const tails: number[] = [];
	const previous = Array.from({length: keys.length}, () => -1);
	for (const [index, key] of known.entries()) {
		if (key === undefined) {
			continue;
		}

		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if (known[tails[middle]]! < key) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}

		previous[index] = low > 0 ? tails[low - 1] : -1;
		tails[low] = index;
	}

	const keep = new Set<number>();
	for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) {
		keep.add(index);
	}

	const result: string[] = [];
	let before: string | undefined;
	for (let index = 0; index < keys.length; index += 1) {
		if (keep.has(index)) {
			result[index] = known[index]!;
		} else {
			let next = index + 1;
			while (next < keys.length && !keep.has(next)) {
				next += 1;
			}

			result[index] = keyBetween(
				before,
				next < keys.length ? known[next] : undefined,
			);
		}

		before = result[index];
	}

	return result;
}

function orderKeys(
	records: Records,
	shadow: SyncState['shadow'],
): Map<string, string> {
	const groups = new Map<string, string[]>();
	for (const [key, record] of records) {
		const group = orderGroup(record.kind, record.parentId);
		if (group === undefined) {
			continue;
		}

		const list = groups.get(group);
		if (list) {
			list.push(key);
		} else {
			groups.set(group, [key]);
		}
	}

	const keys = new Map<string, string>();
	for (const list of groups.values()) {
		for (const [index, key] of orderList(
			list,
			(key) => shadow[key]?.o,
		).entries()) {
			keys.set(list[index], key);
		}
	}

	return keys;
}

export function capture(
	state: SyncState,
	records: Records,
	now: number,
): SyncState {
	const shadow = {...state.shadow};
	const outbox = new Set(state.outbox);
	let {clock} = state;
	const stamp = () => {
		const next = tick(clock, now);
		clock = next.clock;
		return next.h;
	};

	let changed = false;
	const order = orderKeys(records, shadow);
	for (const [key, record] of records) {
		const hash = hashOf(record.value);
		const o = order.get(key);
		const entry = shadow[key];
		if (entry && !entry.deleted && entry.hash === hash && entry.o === o) {
			continue;
		}

		changed = true;
		shadow[key] = {
			kind: record.kind,
			id: record.id,
			...(record.parentId !== undefined && {parentId: record.parentId}),
			h: stamp(),
			d: state.device,
			hash,
			...(o !== undefined && {o}),
		};
		outbox.add(key);
	}

	const forgetBefore = stampAt(now - TOMBSTONE_KEEP_MS);
	const forgotten = new Set<string>();
	for (const [key, entry] of Object.entries(shadow)) {
		if (records.has(key)) {
			continue;
		}

		if (!entry.deleted) {
			changed = true;
			shadow[key] = {
				kind: entry.kind,
				id: entry.id,
				...(entry.parentId !== undefined && {parentId: entry.parentId}),
				h: stamp(),
				d: state.device,
				hash: '',
				deleted: true,
			};
			outbox.add(key);
		} else if (entry.h < forgetBefore && !outbox.has(key)) {
			forgotten.add(key);
		}
	}

	if (!changed && forgotten.size === 0) {
		return state;
	}

	return {
		...state,
		clock,
		shadow: without(shadow, forgotten),
		outbox: [...outbox],
	};
}

export function outgoing(
	state: SyncState,
	records: Records,
	limit: number,
): SyncChange[] {
	return state.outbox.slice(0, limit).flatMap((key): SyncChange[] => {
		const entry = state.shadow[key];
		if (!entry) {
			return [];
		}

		const base = {
			kind: entry.kind,
			id: entry.id,
			...(entry.parentId !== undefined && {parentId: entry.parentId}),
			h: entry.h,
			d: entry.d,
			...(entry.o !== undefined && {o: entry.o}),
		};
		const record = records.get(key);
		return [
			entry.deleted || !record
				? {...base, deleted: true}
				: {...base, value: record.value},
		];
	});
}

export function settle(
	state: SyncState,
	sent: readonly SyncChange[],
	results: readonly PushResult[],
): {state: SyncState; refused: number} {
	const done = new Set<string>();
	let refused = 0;
	for (const [index, change] of sent.entries()) {
		const key = recordKey(change);
		if (state.shadow[key]?.h === change.h) {
			done.add(key);
		}

		if (results[index] === 'stale' || results[index] === 'clock') {
			refused += 1;
		}
	}

	return {
		state: {...state, outbox: state.outbox.filter((key) => !done.has(key))},
		refused,
	};
}

export function receive(
	state: SyncState,
	records: Records,
	page: {changes: readonly SyncChange[]; cursor: number; purged: number},
	now: number,
): {state: SyncState; records: Records; changed: boolean} {
	if (
		page.changes.length === 0 &&
		page.cursor === state.cursor &&
		page.purged === state.purged &&
		!state.unseen &&
		!state.held?.length
	) {
		return {state, records, changed: false};
	}

	const shadow = {...state.shadow};
	const next = new Map(records);
	const outbox = new Set(state.outbox);
	const unseen = state.unseen ? new Set(state.unseen) : undefined;
	let {clock} = state;
	let changed = false;

	const apply = (change: SyncChange) => {
		const key = recordKey(change);
		const entry = shadow[key];
		if (entry && !supersedes(change, entry)) {
			return;
		}

		changed = true;
		outbox.delete(key);
		const base = {
			kind: change.kind,
			id: change.id,
			...(change.parentId !== undefined && {parentId: change.parentId}),
		};
		if (change.deleted) {
			next.delete(key);
			shadow[key] = {
				...base,
				h: change.h,
				d: change.d,
				hash: '',
				deleted: true,
			};
		} else {
			next.set(key, {...base, value: change.value});
			shadow[key] = {
				...base,
				h: change.h,
				d: change.d,
				hash: hashOf(change.value),
				...(change.o !== undefined && {o: change.o}),
			};
		}
	};

	const waits = (change: SyncChange) => {
		const parent = parentOf(change);
		return (
			parent !== undefined && !next.has(parent) && !shadow[parent]?.deleted
		);
	};

	let waiting: SyncChange[] = [...(state.held ?? [])];
	for (const change of page.changes) {
		try {
			clock = observe(clock, change.h, now);
		} catch {
			continue;
		}

		unseen?.delete(recordKey(change));
		waiting.push(change);
	}

	for (let progress = true; progress;) {
		const still: SyncChange[] = [];
		for (const change of waiting) {
			if (waits(change)) {
				still.push(change);
			} else {
				apply(change);
			}
		}

		progress = still.length < waiting.length;
		waiting = still;
	}

	const held = newestPerRecord(waiting);
	const {held: _previous, ...rest} = state;
	return {
		state: {
			...rest,
			clock,
			shadow,
			outbox: [...outbox],
			cursor: page.cursor,
			purged: page.purged,
			...(unseen && {unseen: [...unseen]}),
			...(held.length > 0 && {held}),
		},
		records: next,
		changed,
	};
}

function parentOf(change: SyncChange): string | undefined {
	if (change.deleted) {
		return undefined;
	}

	if (change.kind === 'tab') {
		return `session:${change.parentId ?? ''}`;
	}

	if (change.kind === 'note' || change.kind === 'tag') {
		return `bookmark:${change.id}`;
	}

	const value = isRecord(change.value) ? change.value : {};
	if (change.kind === 'bookmark' && typeof value.columnId === 'string') {
		return `column:${value.columnId}`;
	}

	return change.kind === 'session' && typeof value.folderId === 'string'
		? `folder:${value.folderId}`
		: undefined;
}

function newestPerRecord(changes: readonly SyncChange[]): SyncChange[] {
	const newest = new Map<string, SyncChange>();
	for (const change of changes) {
		const key = recordKey(change);
		if (supersedes(change, newest.get(key))) {
			newest.set(key, change);
		}
	}

	return [...newest.values()];
}

export function restartAfterServerReset(state: SyncState): SyncState {
	return {
		...state,
		cursor: 0,
		purged: 0,
		known: 0,
		outbox: Object.keys(state.shadow),
	};
}

export function startResync(state: SyncState): SyncState {
	return {
		...state,
		cursor: 0,
		unseen: Object.entries(state.shadow)
			.filter(([key, entry]) => !entry.deleted && !state.outbox.includes(key))
			.map(([key]) => key),
	};
}

export function finishResync(
	state: SyncState,
	records: Records,
): {state: SyncState; records: Records; changed: boolean} {
	if (!state.unseen) {
		return {state, records, changed: false};
	}

	const next = new Map(records);
	for (const key of state.unseen) {
		next.delete(key);
	}

	const {unseen, ...rest} = state;
	return {
		state: {...rest, shadow: without(state.shadow, new Set(unseen))},
		records: next,
		changed: unseen.length > 0,
	};
}

export function inOrder(state: SyncState, records: Records): LibraryRecord[] {
	const position = (key: string) => state.shadow[key]?.o ?? '';
	return [...records]
		.toSorted(([a], [b]) => {
			const first = position(a);
			const second = position(b);
			return first === second ? a.localeCompare(b) : first < second ? -1 : 1;
		})
		.map(([, record]) => record);
}
