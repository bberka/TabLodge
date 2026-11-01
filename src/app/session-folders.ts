import type {Folder} from './types';

export const ARCHIVED_FOLDER_NAME = 'Archived';

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
