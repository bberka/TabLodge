import type {Store} from '../../../extension/src/shared/types';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {isStore} from '../library/store-shape';

export type LibraryName = 'regular' | 'private';

const keyOf = (library: LibraryName) => `tablodge.safety.${library}`;

export type SafetyCopy = {at: number; store: Store; preferences?: unknown};

export function replaceLibrary(
	current: Store,
	backup: Store,
	now: number,
): Store {
	return {
		...current,
		groups: backup.groups,
		folders: backup.folders,
		bookmarkColumns: backup.bookmarkColumns,
		bookmarks: backup.bookmarks,
		updatedAt: now,
	};
}

export async function keepSafetyCopy(
	library: LibraryName,
	store: Store,
	now: number,
	preferences?: unknown,
): Promise<void> {
	await writeJson(keyOf(library), {at: now, store, preferences});
}

export async function readSafetyCopy(
	library: LibraryName,
): Promise<SafetyCopy | undefined> {
	const saved = await readJson(keyOf(library));
	return typeof saved === 'object' &&
		saved !== null &&
		typeof (saved as SafetyCopy).at === 'number' &&
		isStore((saved as SafetyCopy).store)
		? (saved as SafetyCopy)
		: undefined;
}

export async function dropSafetyCopy(library: LibraryName): Promise<void> {
	await removeKeys([keyOf(library)]);
}
