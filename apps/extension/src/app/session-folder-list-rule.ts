/*
When the session folders no longer fit as a row of chips: past this many, the Sessions page lists them
vertically beside the sessions, like the bookmark board's Focus view. Kept here so tests run without a browser.
*/
export const SESSION_FOLDER_LIST_MIN = 9;

// `folderCount` is the folders shown in the selector, not counting All.
export function isFolderListShown(folderCount: number) {
	return folderCount > SESSION_FOLDER_LIST_MIN;
}
