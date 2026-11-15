/*
The trash on the phone, as the screens use it: deleting puts what was removed here, restoring takes it out and puts
it back in its library, and `useTrash` keeps a list up to date. The storage is in `trash-storage.ts`. Changes go to
the server with the next sync, like any edit.
*/
import {useEffect, useState} from 'react';
import {getPrivateStore, nudgePrivate} from '../private/private-library';
import {isPrivateView} from './view';
import {
	editIn,
	getLibrary,
	newId,
	nudgeRegular,
	type LibraryName,
} from './library-store';
import {
	changeTrash,
	onTrashChange,
	readTrash,
	type TrashName,
} from './trash-storage';
import {
	addToTrash,
	DEFAULT_RETENTION_DAYS,
	type NewTrash,
	removeFromTrash,
	restoreEntry,
	type TrashEntry,
} from './trash';

const retentionDays = (name: TrashName): number =>
	(name === 'private' ? getPrivateStore() : getLibrary()).settings
		.trashRetentionDays || DEFAULT_RETENTION_DAYS;

const change = async (
	name: LibraryName,
	work: (items: TrashEntry[]) => TrashEntry[],
	{quiet = false} = {},
): Promise<void> => {
	await changeTrash(name, retentionDays(name), work);
	if (!quiet) {
		(name === 'private' ? nudgePrivate : nudgeRegular)();
	}
};

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
Drops what has expired from both lists. Call it once the library has loaded, and again whenever the trash opens. What
expired is gone on every device at the same moment, so nothing is sent for it.
*/
export async function purgeTrash(): Promise<void> {
	await change('regular', (items) => items, {quiet: true});
	await change('private', (items) => items, {quiet: true});
}

export type Restoration = {
	/**
	Set when the item went somewhere other than its old place.
	*/
	note?: string;
	/**
	Set when it could not be put back; it is still in the trash.
	*/
	error?: string;
};

/**
Puts an entry back in its library and takes it out of the trash.
*/
export async function restoreFromTrash(
	name: LibraryName,
	entry: TrashEntry,
): Promise<Restoration> {
	let outcome: Restoration = {};
	await editIn(name, (current) => {
		const restored = restoreEntry(current, entry, newId, Date.now());
		outcome = {note: restored.note, error: restored.error};
		return restored.store;
	});
	if (!outcome.error) {
		await change(name, (items) => removeFromTrash(items, entry.id));
	}

	return outcome;
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
			void readTrash(name, retentionDays(name)).then((next) => {
				if (live) {
					setItems(next);
				}
			});
		};

		load();
		const stop = onTrashChange(load);
		return () => {
			live = false;
			stop();
		};
	}, [name, active]);
	return items;
}
