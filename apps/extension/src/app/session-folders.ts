import type {Folder, Session} from '../shared/types';
import {ARCHIVED_FOLDER_NAME} from '../shared/library-normalize';

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

export {ARCHIVED_FOLDER_NAME} from '../shared/library-normalize';
