/*
What a save did, in the one shape and wording every surface shares (`save-feedback.ts`). The edit functions return only
the new store, so the screens count what the change added: a link left out as a duplicate is the difference.
*/
import type {Store} from '../../../extension/src/shared/types';
import {
	type SaveOutcome,
	saveOutcomeOf,
} from '../../../extension/src/shared/save-feedback';

export const bookmarkCount = (store: Store) => store.bookmarks.length;
export const tabCount = (store: Store) =>
	store.groups.reduce((sum, group) => sum + group.tabs.length, 0);

/**
Wraps a library change so that what it added can be read afterwards: pass `change` to `editIn`, then ask `outcome`.
`count` says what is being added (`bookmarkCount` or `tabCount`).
*/
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
		/**
		`attempted` is how many links were offered, `noun` what they are (`link`, `bookmark`), and `into` where they went.
		*/
		outcome(attempted: number, noun: string, into?: string): SaveOutcome {
			return saveOutcomeOf(
				{ok: true, count: added, skipped: Math.max(0, attempted - added)},
				noun,
				{into, empty: 'Nothing was saved.'},
			);
		},
	};
}
