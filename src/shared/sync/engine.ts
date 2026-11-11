/*
The device side of sync, as pure functions over a stored `SyncState` and the library's records. The worker runs
them around its network calls:

	capture   stamps every record that changed since the last capture and queues it (the outbox)
	outgoing  the queued changes to push
	settle    takes the push results; a change leaves the queue once the server has an answer for it
	receive   applies pulled changes that win, and reports whether the library must be rewritten

The state remembers, per record, the stamp, order key, and content hash it last agreed on with the server (the
"shadow"). Comparing the library with it is how local edits are found, so the rest of the worker needs no sync
code. Network calls happen between these steps, outside the worker's mutation queue.
*/
import {canonicalJson, hashText} from '../library-values';
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
	/**
	The server's purge marker from the last pull, sent back with the next one.
	*/
	purged: number;
	/**
	False until the first full pull, so a new device takes the server's copy of records both sides have.
	*/
	joined: boolean;
	shadow: Record<string, ShadowEntry>;
	/**
	Records with a local change the server has not answered yet.
	*/
	outbox: string[];
	/**
	During a resync: synced records not seen again yet. Whatever is left at the end was deleted remotely.
	*/
	unseen?: string[];
};

export type Records = Map<string, LibraryRecord>;

/**
Tombstones are forgotten after this long, matching the server's default retention.
*/
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

const hashOf = (value: unknown) => hashText(canonicalJson(value));

const without = (shadow: SyncState['shadow'], keys: ReadonlySet<string>) =>
	keys.size === 0
		? shadow
		: Object.fromEntries(
				Object.entries(shadow).filter(([key]) => !keys.has(key)),
			);

/**
Order keys for a list of siblings. Keys that are already in order (the longest increasing run) stay, so a move
or an insert changes only the records that moved or were added.
*/
export function orderList(
	keys: readonly string[],
	current: (key: string) => string | undefined,
): string[] {
	const known = keys.map((key) => current(key));
	// Longest strictly increasing subsequence of the known keys, in O(n log n).
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
		if (group !== undefined) {
			groups.set(group, [...(groups.get(group) ?? []), key]);
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

/**
Stamps every record that differs from what was last agreed with the server, and queues it.
*/
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

	const order = orderKeys(records, shadow);
	for (const [key, record] of records) {
		const hash = hashOf(record.value);
		const o = order.get(key);
		const entry = shadow[key];
		if (entry && !entry.deleted && entry.hash === hash && entry.o === o) {
			continue;
		}

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

	return {
		...state,
		clock,
		shadow: without(shadow, forgotten),
		outbox: [...outbox],
	};
}

/**
The queued changes, at most `limit`, with their current values.
*/
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

/**
Takes the server's answers to a push. A change leaves the queue unless the record was edited again since it was
sent. Returns how many changes the server refused (`stale` or `clock`), which the app reports.
*/
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

	// The cursor stays: the push's own changes come back in the next pull and are recognised by their stamps.
	return {
		state: {...state, outbox: state.outbox.filter((key) => !done.has(key))},
		refused,
	};
}

/**
Applies pulled changes that win over this device's version. Returns the new state and records, and whether any
record changed (the library must then be rewritten).
*/
export function receive(
	state: SyncState,
	records: Records,
	page: {changes: readonly SyncChange[]; cursor: number; purged: number},
	now: number,
): {state: SyncState; records: Records; changed: boolean} {
	const shadow = {...state.shadow};
	const next = new Map(records);
	const outbox = new Set(state.outbox);
	const unseen = state.unseen ? new Set(state.unseen) : undefined;
	let {clock} = state;
	let changed = false;
	for (const change of page.changes) {
		try {
			clock = observe(clock, change.h, now);
		} catch {
			// A stamp from a clock far ahead; the server should have refused it.
			continue;
		}

		const key = recordKey(change);
		unseen?.delete(key);
		const entry = shadow[key];
		if (entry && !supersedes(change, entry)) {
			continue;
		}

		changed = true;
		outbox.delete(key);
		if (change.deleted) {
			next.delete(key);
			shadow[key] = {
				kind: change.kind,
				id: change.id,
				...(change.parentId !== undefined && {parentId: change.parentId}),
				h: change.h,
				d: change.d,
				hash: '',
				deleted: true,
			};
		} else {
			next.set(key, {
				kind: change.kind,
				id: change.id,
				...(change.parentId !== undefined && {parentId: change.parentId}),
				value: change.value,
			});
			shadow[key] = {
				kind: change.kind,
				id: change.id,
				...(change.parentId !== undefined && {parentId: change.parentId}),
				h: change.h,
				d: change.d,
				hash: hashOf(change.value),
				...(change.o !== undefined && {o: change.o}),
			};
		}
	}

	return {
		state: {
			...state,
			clock,
			shadow,
			outbox: [...outbox],
			cursor: page.cursor,
			purged: page.purged,
			...(unseen && {unseen: [...unseen]}),
		},
		records: next,
		changed,
	};
}

/**
Starts over from cursor 0 after the server said `resync`. Records synced before and not seen again by the end of
the pull were deleted while this device was away; `finishResync` removes them.
*/
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

/**
Records in display order: each order group sorted by order key.
*/
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
