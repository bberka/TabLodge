/*
The scale matrix of issue #415 as libraries, built on the extension's perf fixture so the browser and the phone are
measured on the same data. Deterministic. Not shipped: it lives under scripts/ and is used by the seeder and the tests.
*/
// eslint-disable-next-line no-restricted-imports -- a profiling script that is never bundled into the app
import {createLargeLibrary} from '../../../extension/scripts/browser/perf-fixture';
import type {Store} from '../../../extension/src/shared/types';
import {emptyStore} from '../../src/library/store-shape';

export const SCENARIOS = [
	'bookmarks-100',
	'bookmarks-1000',
	'bookmarks-10000',
	'columns-120x120',
	'sessions-100',
	'sessions-1000',
	'sessions-10000',
	'links-100',
	'links-1000',
	'links-10000',
	'folders-100',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const base = Date.UTC(2026, 9, 1);

// The folder the fixture's sessions point at. Without it a session waits for its folder in sync and never shows.
const unfiled = {
	id: 'unfiled',
	name: 'Unfiled',
	createdAt: base,
	isDefault: true,
};

function library(bookmarks: number, sessions: number): Store {
	const store = createLargeLibrary(
		emptyStore(base) as never,
		bookmarks,
		sessions,
	) as unknown as Store;
	return {...store, folders: [unfiled]};
}

export function buildScenario(name: Scenario): Store {
	const [kind, size] = name.split('-', 2);
	const count = Number.parseInt(size, 10);
	switch (kind) {
		case 'bookmarks': {
			// One column holds every bookmark.
			const store = library(count, 0);
			const [column] = store.bookmarkColumns;
			return {
				...store,
				bookmarkColumns: [column],
				bookmarks: store.bookmarks.map((b) => ({...b, columnId: column.id})),
			};
		}

		case 'columns': {
			// 120 columns of 120 bookmarks each.
			const [columns, per] = size.split('x').map(Number);
			const store = library(columns * per, 0);
			const made = Array.from({length: columns}, (_, index) => ({
				id: `perf-column-${index}`,
				name: `Column ${index + 1}`,
				icon: 'star',
				createdAt: base,
				isDefault: false,
			}));
			return {
				...store,
				bookmarkColumns: made,
				bookmarks: store.bookmarks.map((b, index) => ({
					...b,
					columnId: made[Math.floor(index / per)].id,
				})),
			};
		}

		case 'sessions': {
			return library(0, count);
		}

		case 'links': {
			// One session with `count` links.
			const store = library(0, 1);
			const [session] = store.groups;
			const template = session.tabs[0];
			return {
				...store,
				groups: [
					{
						...session,
						tabs: Array.from({length: count}, (_, index) => ({
							...template,
							id: `perf-tab-0-${index}`,
							title: `Link ${index + 1} of a very large session`,
							url: `https://example.com/l/${index}`,
							originalIndex: index,
						})),
					},
				],
			};
		}

		case 'folders': {
			// 100 folders, 300 sessions spread over them.
			const store = library(0, 300);
			const folders = Array.from({length: count}, (_, index) => ({
				id: `perf-folder-${index}`,
				name: `Folder ${index + 1}`,
				icon: 'folder',
				createdAt: base,
				isDefault: false,
			}));
			return {
				...store,
				folders,
				groups: store.groups.map((g, index) => ({
					...g,
					folderId: folders[index % count].id,
				})),
			};
		}

		default: {
			throw new Error(`Unknown scenario ${name}`);
		}
	}
}
