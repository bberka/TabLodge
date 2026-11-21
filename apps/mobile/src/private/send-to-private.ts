import {
	takeOutForPrivate,
	type SendTarget,
} from '../../../extension/src/shared/send-to-private';
import type {Store} from '../../../extension/src/shared/types';
import {removedBookmarks, restoreBookmarks} from '../library/board-edits';
import {editRegular, getLibrary, newId} from '../library/library-store';
import {removeSession, restoreSession} from '../library/session-edits';
import {showSnack} from '../ui/snackbar';
import {
	canReceiveSent,
	queueSentLinks,
	releaseSent,
	withdrawSent,
} from './private-library';

export const SEND_TO_PRIVATE_LABEL = 'Send to private storage';

export const canSendToPrivate = (
	view: 'regular' | 'private',
	state: {exists: boolean; hasLock: boolean},
): boolean => view === 'regular' && state.exists && state.hasLock;

function putBack(
	current: Store,
	before: Store,
	targets: SendTarget[],
	now: number,
): Store {
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
	for (const session of before.groups) {
		if (!sessionIds.has(session.id)) {
			continue;
		}

		next = restoreSession(
			next.groups.some((group) => group.id === session.id)
				? removeSession(next, session.id, now)
				: next,
			session,
			now,
		);
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

	const id = await queueSentLinks(taken.links);
	let removed = false;
	await editRegular((current) => {
		const again = takeOutForPrivate(current, targets);
		removed = again.ok;
		return again.ok ? again.store : current;
	});
	if (!removed) {
		await withdrawSent(id);
		showSnack('Those links changed. Nothing was sent');
		return false;
	}

	let undone = false;
	const count = taken.links.length;
	showSnack(
		`${count} ${count === 1 ? 'link' : 'links'} sent to private storage`,
		{
			label: 'Undo',
			run() {
				undone = true;
				void withdrawSent(id).then(async (withdrawn) => {
					if (!withdrawn) {
						showSnack('It is already in the private library');
						return;
					}

					await editRegular((current) =>
						putBack(current, before, targets, Date.now()),
					);
				});
			},
			closed() {
				if (!undone) {
					void releaseSent(id);
				}
			},
		},
	);
	return true;
}
