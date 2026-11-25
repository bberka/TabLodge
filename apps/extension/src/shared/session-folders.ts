import type {Folder, Session} from './types';
import {
	ARCHIVED_FOLDER_NAME,
	isArchivedFolderName,
	MAX_FOLDERS,
} from './library-normalize';

export function isArchivedFolder(folder: Pick<Folder, 'name'>) {
	return (
		folder.name.toLocaleLowerCase() === ARCHIVED_FOLDER_NAME.toLocaleLowerCase()
	);
}

export function archivedFolderId(
	folders: ReadonlyArray<Pick<Folder, 'id' | 'name'>>,
): string | undefined {
	return folders.find((folder) => isArchivedFolder(folder))?.id;
}

export function visibleSessionFolders<T extends Pick<Folder, 'id' | 'name'>>(
	folders: readonly T[],
	sessions: ReadonlyArray<Pick<Session, 'folderId'>>,
): readonly T[] {
	const archivedId = archivedFolderId(folders);
	return !archivedId ||
		sessions.some((session) => session.folderId === archivedId)
		? folders
		: folders.filter((folder) => folder.id !== archivedId);
}

export {ARCHIVED_FOLDER_NAME} from './library-normalize';

export function normalizeFolderName(value: unknown): string {
	return typeof value === 'string'
		? value
				.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
				.trim()
				.slice(0, 60)
		: '';
}

export function folderNameExists(
	folders: ReadonlyArray<Pick<Folder, 'id' | 'name'>>,
	name: string,
	exceptId: string | null = null,
): boolean {
	const normalizedName = name.toLocaleLowerCase();
	return folders.some(
		(folder) =>
			folder.id !== exceptId &&
			folder.name.toLocaleLowerCase() === normalizedName,
	);
}

export const FOLDER_LIMIT_MESSAGE = `TabLodge can store up to ${MAX_FOLDERS} folders.`;

export function folderLimitReached(
	folders: ReadonlyArray<Pick<Folder, 'name'>>,
): boolean {
	return (
		folders.filter((folder) => !isArchivedFolderName(folder.name)).length >=
		MAX_FOLDERS
	);
}

export function folderNameProblem(
	folders: ReadonlyArray<Pick<Folder, 'id' | 'name'>>,
	name: unknown,
	exceptId: string | null = null,
): string | undefined {
	const clean = normalizeFolderName(name);
	if (!clean || clean.toLocaleLowerCase() === 'all sessions') {
		return 'Choose a different folder name.';
	}

	if (exceptId === null && folderLimitReached(folders)) {
		return FOLDER_LIMIT_MESSAGE;
	}

	return folderNameExists(folders, clean, exceptId)
		? 'A folder with that name already exists.'
		: undefined;
}
