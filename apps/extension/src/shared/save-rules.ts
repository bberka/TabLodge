// The rules every save path follows, in the extension and the Android app: what counts as a duplicate, and which
// session a link goes to when none is chosen. Pure, so both apps and their tests share it.
import {isArchivedFolderName} from './library-normalize';
import type {Bookmark, Folder, Session, Settings} from './types';

export type DuplicateHandling = Settings['saveDuplicateHandling'];

/**
The handling in a library's settings; a library that has not set it (an empty phone library) allows duplicates, as the
extension's default does.
*/
export const duplicateHandlingOf = (
	settings: Partial<Pick<Settings, 'saveDuplicateHandling'>>,
): DuplicateHandling =>
	settings.saveDuplicateHandling === 'reject' ? 'reject' : 'allow';

/**
The duplicate rule, for sessions and for bookmarks alike. A link is a duplicate when its canonical web address (the
one `normalizeUrl` gives) is exactly equal to a saved one. Where it is looked for depends on where it goes:

- Into a session or bookmark column that already exists, the link is a duplicate when that session or column holds it.
  Neither ever holds the same address twice, whatever the setting says.
- In a new session, and for everything else, the setting "When a saved URL is saved again" decides: `reject` makes a
  link a duplicate when any session (for a session save) or any bookmark column (for a bookmark save) holds it, and
  `allow` stores another copy.

Sessions and bookmarks are separate: a saved tab never makes a bookmark a duplicate, or the reverse. Bookmarks have no
setting of their own and follow this one.
*/
export type DuplicateScope = {
	/**
	Addresses held by the session or column the link goes into; empty for a new session.
	*/
	inside?: Iterable<string>;
	/**
	Addresses held anywhere else of the same kind (every other session, every other column).
	*/
	elsewhere: Iterable<string>;
};

export type DuplicateFilter = {
	/**
	Whether this address is a duplicate and must not be saved.
	*/
	isDuplicate(url: string): boolean;
	/**
	Records an address that is being saved, so a repeat later in the same batch is judged against it.
	*/
	saved(url: string): void;
};

/**
The rule itself: a link is a duplicate when the container it goes into holds it, or when it is held elsewhere and the
setting rejects duplicates. Everything below (and every save path) decides through this one function.
*/
export const isDuplicateAt = (
	handling: DuplicateHandling,
	held: {inside: boolean; elsewhere: boolean},
): boolean => held.inside || (handling === 'reject' && held.elsewhere);

export function duplicateFilter(
	handling: DuplicateHandling,
	scope: DuplicateScope,
): DuplicateFilter {
	const inside = new Set(scope.inside);
	const elsewhere = new Set(scope.elsewhere);
	const intoExisting = scope.inside !== undefined;
	return {
		isDuplicate: (url) =>
			isDuplicateAt(handling, {
				inside: inside.has(url),
				elsewhere: elsewhere.has(url),
			}),
		saved(url) {
			(intoExisting ? inside : elsewhere).add(url);
		},
	};
}

/**
The session a link goes to when none is chosen: the most recently updated one that is not in the Archived folder.
*/
export function defaultTargetSession<
	T extends Pick<Session, 'folderId' | 'updatedAt'>,
>(
	sessions: readonly T[],
	folders: ReadonlyArray<Pick<Folder, 'id' | 'name'>>,
): T | undefined {
	const archived = new Set(
		folders
			.filter((folder) => isArchivedFolderName(folder.name))
			.map((folder) => folder.id),
	);
	let best: T | undefined;
	for (const session of sessions) {
		if (
			!archived.has(session.folderId) &&
			(!best || session.updatedAt > best.updatedAt)
		) {
			best = session;
		}
	}

	return best;
}

/**
The filter for links saved into one bookmark column (or, with no `columnId`, a column that does not exist yet).
*/
export function bookmarkDuplicates(
	bookmarks: ReadonlyArray<Pick<Bookmark, 'url' | 'columnId'>>,
	columnId: string | undefined,
	handling: DuplicateHandling,
): DuplicateFilter {
	const inside: string[] = [];
	const elsewhere: string[] = [];
	for (const bookmark of bookmarks) {
		(bookmark.columnId === columnId ? inside : elsewhere).push(bookmark.url);
	}

	return duplicateFilter(handling, {inside, elsewhere});
}

/**
The filter for links saved into one existing session (`intoId`), or into a new session when `intoId` is undefined.
*/
export function sessionDuplicates(
	sessions: ReadonlyArray<Pick<Session, 'id' | 'tabs'>>,
	intoId: string | undefined,
	handling: DuplicateHandling,
): DuplicateFilter {
	if (intoId === undefined && handling === 'allow') {
		// A new session that allows duplicates never skips anything; do not index every saved tab for it.
		return {isDuplicate: () => false, saved() {}};
	}

	const inside: string[] = [];
	const elsewhere: string[] = [];
	for (const session of sessions) {
		for (const tab of session.tabs) {
			(session.id === intoId ? inside : elsewhere).push(tab.url);
		}
	}

	return duplicateFilter(handling, {
		inside: intoId === undefined ? undefined : inside,
		elsewhere,
	});
}

/**
The message for a link or bookmark skipped as a duplicate.
*/
export const duplicateError = (noun: 'bookmark' | 'session') =>
	noun === 'bookmark' ? 'Already bookmarked.' : 'Already saved.';

/**
One address against a whole list of bookmarks, for a single save that should not build a filter first.
*/
export function bookmarkIsDuplicate(
	bookmarks: ReadonlyArray<Pick<Bookmark, 'url' | 'columnId'>>,
	columnId: string | undefined,
	url: string,
	handling: DuplicateHandling,
): boolean {
	let elsewhere = false;
	for (const bookmark of bookmarks) {
		if (bookmark.url !== url) {
			continue;
		}

		if (bookmark.columnId === columnId) {
			return isDuplicateAt(handling, {inside: true, elsewhere});
		}

		elsewhere = true;
	}

	return isDuplicateAt(handling, {inside: false, elsewhere});
}
