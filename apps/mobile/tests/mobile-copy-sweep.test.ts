import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import {emptyStore} from '../src/library/store-shape';

const stored = new Map<string, unknown>();
let libraryChanged = () => {};

vi.mock('../src/platform/storage', () => ({
	readJson: async (key: string) => stored.get(key),
	async writeJson(key: string, value: unknown) {
		stored.set(key, structuredClone(value));
	},
	async removeKeys(keys: string[]) {
		for (const key of keys) {
			stored.delete(key);
		}
	},
}));
vi.mock('../src/library/library-store', () => ({
	getLibrary: () => ({
		...emptyStore(0),
		bookmarks: [{id: 'a', title: 'Kept', url: 'https://kept.example/'}],
	}),
	subscribeLibrary(listener: () => void) {
		libraryChanged = listener;
	},
	async whenLibraryLoaded() {},
}));
vi.mock('../src/library/trash-storage', () => ({
	onTrashChange() {},
	readTrash: async () => [],
}));
vi.mock('../src/library/link-preview', () => ({USER_AGENT: 'test'}));
vi.mock('../src/library/server-features', () => ({
	serverFeatures: async () => [],
}));

const {allCopies, holdCopySweep, restoreCopies, startPageCopies} =
	await import('../src/library/page-copies');

const gone = {
	v: 1,
	url: 'https://gone.example/',
	title: 'Gone',
	savedAt: 1_700_000_000_000,
	blocks: [{type: 'paragraph', text: 'Body text.'}],
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test('an Undo still on screen keeps the copies it may bring back', async () => {
	await startPageCopies();
	await restoreCopies([gone]);
	const release = holdCopySweep();
	libraryChanged();
	await vi.advanceTimersByTimeAsync(10 * 60_000);
	assert.equal((await allCopies()).length, 1);

	release();
	await vi.advanceTimersByTimeAsync(2 * 60_000);
	assert.equal((await allCopies()).length, 0);
});
