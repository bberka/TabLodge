import {isArchivedFolderName} from './library-normalize';
import type {Bookmark, Folder, Session, Settings} from './types';

export type DuplicateHandling = Settings['saveDuplicateHandling'];

export const duplicateHandlingOf = (
	settings: Partial<Pick<Settings, 'saveDuplicateHandling'>>,
): DuplicateHandling =>
	settings.saveDuplicateHandling === 'reject' ? 'reject' : 'allow';

export type DuplicateScope = {
	inside?: Iterable<string>;
	elsewhere: Iterable<string>;
};

export type DuplicateFilter = {
	isDuplicate(url: string): boolean;
	saved(url: string): void;
};

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

export function sessionDuplicates(
	sessions: ReadonlyArray<Pick<Session, 'id' | 'tabs'>>,
	intoId: string | undefined,
	handling: DuplicateHandling,
): DuplicateFilter {
	if (intoId === undefined && handling === 'allow') {
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

export const duplicateError = (noun: 'bookmark' | 'session') =>
	noun === 'bookmark' ? 'Already bookmarked.' : 'Already saved.';

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
