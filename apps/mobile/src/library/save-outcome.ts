import type {Store} from '../../../extension/src/shared/types';
import {
	type SaveOutcome,
	saveOutcomeOf,
} from '../../../extension/src/shared/save-feedback';

export const bookmarkCount = (store: Store) => store.bookmarks.length;
export const tabCount = (store: Store) =>
	store.groups.reduce((sum, group) => sum + group.tabs.length, 0);

export function counted(
	count: (store: Store) => number,
	change: (current: Store) => Store,
) {
	let added = 0;
	return {
		change(current: Store): Store {
			const next = change(current);
			added = count(next) - count(current);
			return next;
		},
		outcome(attempted: number, noun: string, into?: string): SaveOutcome {
			return saveOutcomeOf(
				{ok: true, count: added, skipped: Math.max(0, attempted - added)},
				noun,
				{into, empty: 'Nothing was saved.'},
			);
		},
	};
}
