import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createLibraryState} from '../src/shared/library-state';
import {normalizeStore} from '../src/shared/library-normalize';
import {assemble, splitLibrary} from '../src/shared/sync/library-records';
import type {Raw} from '../src/shared/library-values';

const SESSIONS = 10_000;
const LINKS = 10_000;

const link = (prefix: string, index: number) => ({
	id: `${prefix}-t${index}`,
	title: `Link ${index}`,
	url: `https://example.com/${prefix}/${index}`,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 1,
	originalIndex: index,
});

function bigLibrary(): Raw {
	return {
		schemaVersion: 10,
		folders: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
		bookmarkColumns: [],
		bookmarks: [],
		settings: {},
		updatedAt: 1,
		groups: [
			{
				id: 'long',
				name: 'One long session',
				folderId: 'unfiled',
				createdAt: 1,
				updatedAt: 1,
				tabs: Array.from({length: LINKS}, (_, index) => link('long', index)),
			},
			...Array.from({length: SESSIONS}, (_, session) => ({
				id: `s${session}`,
				name: `Session ${session}`,
				folderId: 'unfiled',
				createdAt: 2 + session,
				updatedAt: 2 + session,
				tabs: Array.from({length: 3}, (__, index) =>
					link(`s${session}`, index),
				),
			})),
		],
	};
}

const countsOf = (store: {groups: Array<{tabs: unknown[]}>}) => ({
	sessions: store.groups.length,
	longest: Math.max(...store.groups.map((group) => group.tabs.length)),
	links: store.groups.reduce((sum, group) => sum + group.tabs.length, 0),
});

const expected = {
	sessions: SESSIONS + 1,
	longest: LINKS,
	links: LINKS + SESSIONS * 3,
};

test('normalizing keeps 10,000 sessions and a 10,000-link session', () => {
	assert.deepEqual(countsOf(normalizeStore(bigLibrary())), expected);
});

test('saving and reading back keeps 10,000 sessions and a 10,000-link session', async () => {
	const data = new Map<string, unknown>();
	const backend = {
		async get(keys: string[]) {
			return Object.fromEntries(
				keys
					.filter((key) => data.has(key))
					.map((key) => [key, structuredClone(data.get(key))]),
			);
		},
		async set(values: Raw) {
			for (const [key, value] of Object.entries(values)) {
				data.set(key, structuredClone(value));
			}
		},
		async remove(keys: string[]) {
			for (const key of keys) {
				data.delete(key);
			}
		},
	};
	const state = createLibraryState(backend);
	await state.write(normalizeStore(bigLibrary()));
	const read = await state.read();
	assert.deepEqual(countsOf(read as never), expected);
});

test('a library of that size goes through sync records and back whole', () => {
	const store = normalizeStore(bigLibrary());
	const records = splitLibrary(store);
	const rebuilt = assemble(records.values(), {
		...store,
		groups: [],
	});
	assert.deepEqual(countsOf(normalizeStore(rebuilt as never)), expected);
});
