import {
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
	queueSentLinks,
	releaseSent,
	takeInSent,
	withdrawSent,
} from './private-library';

export {SEND_TO_PRIVATE_LABEL} from '../../../extension/src/shared/send-to-private';

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
	const tabIds = new Set(
		targets.flatMap((target) => (target.kind === 'tab' ? [target.tabId] : [])),
	);
	for (const session of before.groups) {
		if (!sessionIds.has(session.id)) {
			continue;
		}

		const live = next.groups.find((group) => group.id === session.id);
		if (!live) {
			next = restoreSession(next, session, now);
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
					await queueSentLinks(taken.links, {held: false});
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
		},
	);
	return true;
}
