/*
When the session folders no longer fit as a row of chips: the Sessions page lists them vertically beside the
sessions, like the bookmark board's Focus view. Kept here so tests run without a browser.
*/
import type {SessionFolderView} from '../shared/types';

export const SESSION_FOLDER_LIST_MIN = 9;

// `folderCount` is the folders shown in the selector, not counting All. Auto turns the list on past the minimum.
export function isFolderListShown(
	folderCount: number,
	view: SessionFolderView = 'auto',
) {
	return view === 'auto'
		? folderCount > SESSION_FOLDER_LIST_MIN
		: view === 'list';
}

export const SESSION_FOLDER_HINT_KEY = 'tablodge.sessionFolderHintDismissed';

// The chips are showing and there are nearly as many folders as the list would take over for.
export function suggestsFolderList(folderCount: number, isListShown: boolean) {
	return !isListShown && folderCount >= SESSION_FOLDER_LIST_MIN;
}
