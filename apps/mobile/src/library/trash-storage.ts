/*
The trash on disk. The regular library and the private library each have their own list, and the private one is
only offered while the private library is open. Reads and writes go one after another, so two deletes made together
both land, and so does what sync brings in. This file imports nothing from the library, so the sync clients can use it.
*/
import type {SyncHost} from '../../../extension/src/shared/sync/client';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {
	DEFAULT_RETENTION_DAYS,
	parseTrash,
	PRIVATE_TRASH_KEY,
	purgeExpired,
	TRASH_KEY,
	type TrashEntry,
} from './trash';

export type TrashName = 'regular' | 'private';

const keyOf = (name: TrashName) =>
	name === 'private' ? PRIVATE_TRASH_KEY : TRASH_KEY;

let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export const onTrashChange = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export async function changeTrash(
	name: TrashName,
	retentionDays: number,
	work: (items: TrashEntry[]) => TrashEntry[],
): Promise<void> {
	const run = queue.then(async () => {
		const items = parseTrash(await readJson(keyOf(name)));
		const next = work(
			purgeExpired(items, retentionDays || DEFAULT_RETENTION_DAYS, Date.now()),
		);
		await (next.length === 0
			? removeKeys([keyOf(name)])
			: writeJson(keyOf(name), next));
	});
	queue = run.catch(() => undefined);
	await run;
	for (const listener of listeners) {
		listener();
	}
}

export async function readTrash(
	name: TrashName,
	retentionDays: number,
): Promise<TrashEntry[]> {
	await queue;
	return purgeExpired(
		parseTrash(await readJson(keyOf(name))),
		retentionDays || DEFAULT_RETENTION_DAYS,
		Date.now(),
	);
}

/**
The trash as a sync client sees it. What a round brings in is added and removed in one step of the queue, so a delete
made on the phone meanwhile stays. `retention` is read each time, because the setting itself syncs.
*/
export const syncedTrash = (
	name: TrashName,
	retention: () => number,
): NonNullable<SyncHost['trash']> => ({
	read: async () => readTrash(name, retention()),
	apply: async (put, remove) =>
		changeTrash(name, retention(), (items) => {
			const gone = new Set([...remove, ...put.map((entry) => entry.id)]);
			return [...put, ...items.filter((entry) => !gone.has(entry.id))].toSorted(
				(a, b) => b.deletedAt - a.deletedAt,
			);
		}),
});
