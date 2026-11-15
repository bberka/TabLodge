import type {Session, Store} from '../../../../extension/src/shared/types';
import {setSessionColor} from '../../library/board-edits';
import {
	archiveSession,
	describeSession,
	isArchivedSession,
	moveSession,
	removeSession,
	renameSession,
	restoreSession,
	unarchiveSession,
} from '../../library/session-edits';

type Clock = () => number;

// Runs one library change per item, in order, on the store it was given.
function applyAll<T>(
	store: Store,
	items: readonly T[],
	step: (current: Store, item: T) => Store,
): Store {
	let next = store;
	for (const item of items) {
		next = step(next, item);
	}

	return next;
}

/**
The sessions of the list that are ticked, and what that selection means for the buttons: whether it is all of the list,
and whether every ticked session is archived already, which turns Archive into Unarchive.
*/
export function selectionOf(
	shown: readonly Session[],
	ids: ReadonlySet<string>,
	folders: Store['folders'],
) {
	const chosen = shown.filter((session) => ids.has(session.id));
	return {
		chosen,
		isAllSelected: shown.length > 0 && chosen.length === shown.length,
		allArchived: chosen.every((session) => isArchivedSession(folders, session)),
	};
}

export const sessionCount = (count: number) =>
	`${count} ${count === 1 ? 'session' : 'sessions'}`;

export function deleteSessions(
	store: Store,
	sessions: readonly Session[],
	now: Clock,
): Store {
	return applyAll(store, sessions, (next, session) =>
		removeSession(next, session.id, now()),
	);
}

export function restoreSessions(
	store: Store,
	sessions: readonly Session[],
	now: Clock,
): Store {
	return applyAll(store, sessions, (next, session) =>
		restoreSession(next, session, now()),
	);
}

/**
Moves the sessions into the Archived folder, or out of it with `archive` off.
*/
export function archiveSessions(
	store: Store,
	sessions: readonly Session[],
	archive: boolean,
	now: Clock,
): Store {
	return applyAll(store, sessions, (next, session) =>
		archive
			? archiveSession(next, session.id, now())
			: unarchiveSession(next, session.id, now()),
	);
}

/**
Puts each session back in the folder it has now, the undo of archiving it from the state it was captured in.
*/
export function returnSessions(
	store: Store,
	sessions: readonly Session[],
	now: Clock,
): Store {
	return applyAll(store, sessions, (next, session) =>
		moveSession(next, session.id, session.folderId, now()),
	);
}

export function moveSessions(
	store: Store,
	ids: readonly string[],
	target: string,
	now: Clock,
): Store {
	return applyAll(store, ids, (next, id) =>
		moveSession(next, id, target, now()),
	);
}

/**
The undo of `moveSessions`: each session returns to the folder in `was`, or to `target` when it has none.
*/
export function moveSessionsBack(
	store: Store,
	ids: readonly string[],
	was: ReadonlyMap<string, string>,
	target: string,
	now: Clock,
): Store {
	return applyAll(store, ids, (next, id) =>
		moveSession(next, id, was.get(id) ?? target, now()),
	);
}

/**
Saves the Edit details sheet: the name, description, folder and color of one session in one change.
*/
export function saveSessionDetails(
	store: Store,
	session: Session,
	details: {
		name: string;
		description?: string;
		color?: string;
		folderId?: string;
	},
	now: Clock,
): Store {
	const renamed = describeSession(
		renameSession(store, session.id, details.name, now()),
		session.id,
		details.description ?? '',
		now(),
	);
	// Moved first, so a color chosen in the same save wins over the folder's.
	const moved =
		details.folderId && details.folderId !== session.folderId
			? moveSession(renamed, session.id, details.folderId, now())
			: renamed;
	return setSessionColor(moved, session.id, details.color ?? '', now());
}
