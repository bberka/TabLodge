import {applyPatch, type ListPatch} from './library-patch';
import type {Bookmark, RevisionedStore, Session, Store} from './types';

export type StateChange = {
	from: string;
	to: string;
	folders: Store['folders'];
	bookmarkColumns: Store['bookmarkColumns'];
	settings: Store['settings'];
	updatedAt: number;
	sessions: {changed: Session[]; removed: string[]};
	bookmarks: {changed: Bookmark[]} | {patch: ListPatch};
};

const CHANGE_LIMIT = 20;
const PATCH_ITEM_LIMIT = 2000;

export function createChangeLog() {
	let log: StateChange[] = [];
	return {
		add(change: StateChange) {
			if (
				'patch' in change.bookmarks &&
				change.bookmarks.patch.middle.length > PATCH_ITEM_LIMIT
			) {
				return;
			}

			log = [...log, change].slice(-CHANGE_LIMIT);
		},
		since(from: string, to: string): StateChange[] | undefined {
			const chain: StateChange[] = [];
			let cursor = to;
			for (let at = log.length - 1; cursor !== from && at >= 0; at -= 1) {
				if (log[at].to !== cursor) {
					continue;
				}

				chain.unshift(log[at]);
				cursor = log[at].from;
			}

			return cursor === from ? chain : undefined;
		},
		clear() {
			log = [];
		},
	};
}

function replaceById<T extends {id: string}>(
	items: readonly T[],
	changed: readonly T[],
	removed: readonly string[] = [],
): T[] | undefined {
	if (changed.length === 0 && removed.length === 0) {
		return items as T[];
	}

	const next = new Map(changed.map((item) => [item.id, item]));
	const gone = new Set(removed);
	let found = 0;
	const result = items.flatMap((item) => {
		if (gone.has(item.id)) {
			return [];
		}

		const replacement = next.get(item.id);
		if (replacement) {
			found += 1;
		}

		return [replacement ?? item];
	});
	return found === next.size ? result : undefined;
}

export function applyStateChanges<T extends RevisionedStore>(
	held: T,
	changes: readonly StateChange[],
): T | undefined {
	let next = held;
	for (const change of changes) {
		if (next.revision !== change.from) {
			return undefined;
		}

		const groups = replaceById(
			next.groups,
			change.sessions.changed,
			change.sessions.removed,
		);
		const bookmarks =
			'patch' in change.bookmarks
				? (applyPatch(next.bookmarks, change.bookmarks.patch) as
						Bookmark[] | undefined)
				: replaceById(next.bookmarks, change.bookmarks.changed);
		if (!groups || !bookmarks) {
			return undefined;
		}

		next = {
			...next,
			groups,
			bookmarks,
			folders: change.folders,
			bookmarkColumns: change.bookmarkColumns,
			settings: change.settings,
			updatedAt: change.updatedAt,
			revision: change.to,
		};
	}

	return next;
}
