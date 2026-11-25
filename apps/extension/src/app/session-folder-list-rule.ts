import type {SessionFolderView} from '../shared/types';

export const SESSION_FOLDER_LIST_MIN = 9;

export function isFolderListShown(
	folderCount: number,
	view: SessionFolderView = 'auto',
) {
	return view === 'auto'
		? folderCount > SESSION_FOLDER_LIST_MIN
		: view === 'list';
}

export const SESSION_FOLDER_HINT_KEY = 'tablodge.sessionFolderHintDismissed';

export function suggestsFolderList(folderCount: number, isListShown: boolean) {
	return !isListShown && folderCount >= SESSION_FOLDER_LIST_MIN;
}
