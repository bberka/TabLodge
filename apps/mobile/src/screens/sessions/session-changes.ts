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
	const moved =
		details.folderId && details.folderId !== session.folderId
			? moveSession(renamed, session.id, details.folderId, now())
			: renamed;
	return setSessionColor(moved, session.id, details.color ?? '', now());
}
