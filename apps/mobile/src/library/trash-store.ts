/*
The trash on disk. The regular library and the private library each have their own list, and the private one is
only offered while the private library is open. Reads and writes go one after another, so two deletes made together
both land.
*/
import {useEffect, useState} from 'react';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {isPrivateView} from './view';
import {editIn, getLibrary, newId, type LibraryName} from './library-store';
import {
	addToTrash,
	DEFAULT_RETENTION_DAYS,
	type NewTrash,
	parseTrash,
	PRIVATE_TRASH_KEY,
	purgeExpired,
	removeFromTrash,
	restoreEntry,
	TRASH_KEY,
	type TrashEntry,
} from './trash';

const keyOf = (name: LibraryName) =>
	name === 'private' ? PRIVATE_TRASH_KEY : TRASH_KEY;

let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const retentionDays = (): number =>
	getLibrary().settings.trashRetentionDays || DEFAULT_RETENTION_DAYS;

async function change(
	name: LibraryName,
	work: (items: TrashEntry[]) => TrashEntry[],
): Promise<void> {
	const run = queue.then(async () => {
		const items = parseTrash(await readJson(keyOf(name)));
		const next = work(purgeExpired(items, retentionDays(), Date.now()));
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

async function read(name: LibraryName): Promise<TrashEntry[]> {
	await queue;
	return purgeExpired(
		parseTrash(await readJson(keyOf(name))),
		retentionDays(),
		Date.now(),
	);
}

/**
Keeps what was just deleted from the library on screen. Call it with the delete.
*/
export async function trashDeleted(added: readonly NewTrash[]): Promise<void> {
	if (added.length === 0) {
		return;
	}

	const ids = added.map(() => newId());
	await change(isPrivateView() ? 'private' : 'regular', (items) =>
		addToTrash(items, added, ids, Date.now()),
	);
}

/**
Drops what has expired from both lists. Call it once the library has loaded, and again whenever the trash opens.
*/
export async function purgeTrash(): Promise<void> {
	await change('regular', (items) => items);
	await change('private', (items) => items);
}

/**
Puts an entry back in its library and takes it out of the trash. Returns a note when it went somewhere other than its
old place, or undefined when it was already gone.
*/
export async function restoreFromTrash(
	name: LibraryName,
	entry: TrashEntry,
): Promise<string | undefined> {
	let note: string | undefined;
	await editIn(name, (current) => {
		const restored = restoreEntry(current, entry, newId, Date.now());
		note = restored.note;
		return restored.store;
	});
	await change(name, (items) => removeFromTrash(items, entry.id));
	return note;
}

export const deleteForever = async (
	name: LibraryName,
	id: string,
): Promise<void> => change(name, (items) => removeFromTrash(items, id));

export const emptyTrash = async (name: LibraryName): Promise<void> =>
	change(name, () => []);

/**
The trash of this library, newest first, kept up to date while the component is shown.
*/
export function useTrash(name: LibraryName, active = true): TrashEntry[] {
	const [items, setItems] = useState<TrashEntry[]>([]);
	useEffect(() => {
		if (!active) {
			return;
		}

		let live = true;
		const load = () => {
			void read(name).then((next) => {
				if (live) {
					setItems(next);
				}
			});
		};

		load();
		listeners.add(load);
		return () => {
			live = false;
			listeners.delete(load);
		};
	}, [name, active]);
	return items;
}
