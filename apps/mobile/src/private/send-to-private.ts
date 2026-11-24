import {
	sentMessage,
	takeOutForPrivate,
	type SendTarget,
} from '../../../extension/src/shared/send-to-private';
import type {Store} from '../../../extension/src/shared/types';
import {removedBookmarks, restoreBookmarks} from '../library/board-edits';
import {editRegular, getLibrary, newId} from '../library/library-store';
import {restoreSession} from '../library/session-edits';
import {showSnack} from '../ui/snackbar';
import {
	canReceiveSent,
	queueSent,
	releaseSent,
	takeInSent,
	withdrawSent,
} from './private-library';

export {SEND_TO_PRIVATE_LABEL} from '../../../extension/src/shared/send-to-private';

export const canSendToPrivate = (
	view: 'regular' | 'private',
	state: {exists: boolean; hasLock: boolean},
): boolean => view === 'regular' && state.exists && state.hasLock;

function putBackColumn(
	current: Store,
	before: Store,
	columnId: string,
	now: number,
): Store {
	const column = before.bookmarkColumns.find((entry) => entry.id === columnId);
	if (!column) {
		return current;
	}

	const columns = [...current.bookmarkColumns];
	if (columns.every((entry) => entry.id !== columnId)) {
		columns.splice(
			Math.min(before.bookmarkColumns.indexOf(column), columns.length),
			0,
			column,
		);
	}

	const present = new Set(current.bookmarks.map((bookmark) => bookmark.id));
	const bookmarks = [...current.bookmarks];
	for (const [index, bookmark] of before.bookmarks.entries()) {
		if (bookmark.columnId === columnId && !present.has(bookmark.id)) {
			bookmarks.splice(Math.min(index, bookmarks.length), 0, {
				...bookmark,
				updatedAt: now,
			});
		}
	}

	return {...current, bookmarkColumns: columns, bookmarks, updatedAt: now};
}

function putBackSession(
	current: Store,
	before: Store,
	sessionId: string,
	now: number,
): Store {
	const session = before.groups.find((entry) => entry.id === sessionId);
	if (!session || current.groups.some((entry) => entry.id === sessionId)) {
		return current;
	}

	const known = current.folders.some(
		(folder) => folder.id === session.folderId,
	);
	const groups = [...current.groups];
	groups.splice(Math.min(before.groups.indexOf(session), groups.length), 0, {
		...session,
		folderId: known
			? session.folderId
			: (current.folders[0]?.id ?? session.folderId),
		updatedAt: now,
	});
	return {...current, groups, updatedAt: now};
}

function putBack(
	current: Store,
	before: Store,
	targets: SendTarget[],
	now: number,
): Store {
	const whole = targets[0];
	if (whole?.kind === 'column') {
		return putBackColumn(current, before, whole.columnId, now);
	}

	if (whole?.kind === 'session') {
		return putBackSession(current, before, whole.sessionId, now);
	}

	const bookmarkIds = new Set(
		targets.flatMap((target) =>
			target.kind === 'bookmark' ? [target.bookmarkId] : [],
		),
	);
	const gone = removedBookmarks(before, bookmarkIds);
	let next = restoreBookmarks(
		current,
		gone,
		gone.map(() => newId()),
		now,
	);
	const sessionIds = new Set(
		targets.flatMap((target) =>
			target.kind === 'tab' ? [target.sessionId] : [],
		),
	);
	const tabIds = new Set(
		targets.flatMap((target) => (target.kind === 'tab' ? [target.tabId] : [])),
	);
	for (const session of before.groups) {
		if (!sessionIds.has(session.id)) {
			continue;
		}

		const live = next.groups.find((group) => group.id === session.id);
		if (!live) {
			next = restoreSession(
				next,
				{...session, tabs: session.tabs.filter((tab) => tabIds.has(tab.id))},
				now,
			);
			continue;
		}

		const present = new Set(live.tabs.map((tab) => tab.id));
		const tabs = [...live.tabs];
		for (const [index, tab] of session.tabs.entries()) {
			if (tabIds.has(tab.id) && !present.has(tab.id)) {
				tabs.splice(Math.min(index, tabs.length), 0, tab);
			}
		}

		next = {
			...next,
			groups: next.groups.map((group) =>
				group.id === session.id ? {...group, tabs, updatedAt: now} : group,
			),
			updatedAt: now,
		};
	}

	return next;
}

export async function sendToPrivate(targets: SendTarget[]): Promise<boolean> {
	if (!canReceiveSent()) {
		showSnack('Set up the private library first');
		return false;
	}

	const before = getLibrary();
	const taken = takeOutForPrivate(before, targets);
	if (!taken.ok) {
		showSnack(taken.error);
		return false;
	}

	let id: string;
	try {
		id = await queueSent(taken.sent);
	} catch {
		showSnack('Could not send that. Try again');
		return false;
	}

	let removed = false;
	try {
		await editRegular((current) => {
			const again = takeOutForPrivate(current, targets);
			removed = again.ok;
			return again.ok ? again.store : current;
		});
	} catch {
		await withdrawSent(id);
		await editRegular((current) =>
			putBack(current, before, targets, Date.now()),
		).catch(() => undefined);
		showSnack('Could not save that. Nothing was sent');
		return false;
	}

	if (!removed) {
		await withdrawSent(id);
		showSnack('Those links changed. Nothing was sent');
		return false;
	}

	let undone = false;
	showSnack(sentMessage(taken.count, taken.keptColumn, ''), {
		label: 'Undo',
		async run() {
			undone = true;
			if (!(await withdrawSent(id))) {
				showSnack('It is already in the private library');
				return;
			}

			try {
				await editRegular((current) =>
					putBack(current, before, targets, Date.now()),
				);
			} catch {
				await queueSent(taken.sent, {held: false});
				await takeInSent();
				showSnack(
					'Could not bring it back. It stays on its way to the private library',
				);
			}
		},
		closed() {
			if (!undone) {
				void releaseSent(id);
			}
		},
	});
	return true;
}
