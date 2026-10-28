import type {Bookmark, Session} from './types';

/**
Every URL stored in a bookmark or session, for constant-time "already saved" checks. Matching is exact, the same rule saving uses to detect duplicates.
*/
export function savedUrlSet(
	bookmarks: readonly Bookmark[],
	sessions: readonly Session[],
) {
	const urls = new Set<string>();
	for (const bookmark of bookmarks) {
		urls.add(bookmark.url);
	}

	for (const session of sessions) {
		for (const tab of session.tabs) {
			urls.add(tab.url);
		}
	}

	return urls;
}
