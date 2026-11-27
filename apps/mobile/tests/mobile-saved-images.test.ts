import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vite-plus/test';
import {
	IMAGE_DELETED,
	type SavedThumb,
} from '../../extension/src/shared/image-store';
import {emptyStore} from '../src/library/store-shape';

const events: string[] = [];
const snacks: Array<{message: string; run?: () => void | Promise<void>}> = [];
let storedThumbs: SavedThumb[] = [];

const sampleThumb: SavedThumb = {
	url: 'https://cdn.example/cat.png',
	type: 'image/png',
	width: 640,
	height: 480,
	size: 1200,
	savedAt: 1000,
	device: 'Desk',
	thumb: 'UklGRg==',
};

vi.mock('../src/ui/snackbar', () => ({
	showSnack(message: string, action?: {run: () => void | Promise<void>}) {
		snacks.push({message, run: action?.run});
	},
}));

vi.mock('../src/library/image-thumbs', () => ({
	async refreshImageThumbs() {
		events.push('refresh');
	},
	async removeImageThumb(url: string) {
		events.push('remove');
		const found = storedThumbs.find((item) => item.url === url);
		storedThumbs = storedThumbs.filter((item) => item.url !== url);
		return found;
	},
	async putImageThumbs(values: readonly unknown[]) {
		events.push('put');
		storedThumbs.push(...(values as SavedThumb[]));
	},
	async sweepImageThumbs(liveUrls: ReadonlySet<string>) {
		events.push(`sweep:${liveUrls.size}`);
		const before = storedThumbs.length;
		storedThumbs = storedThumbs.filter((item) => liveUrls.has(item.url));
		return before - storedThumbs.length;
	},
}));

vi.mock('../src/library/library-store', () => ({
	getLibrary: () => emptyStore(0),
	async mutateRegular<T>(work: () => Promise<T>): Promise<T> {
		events.push('mutate:start');
		try {
			return await work();
		} finally {
			events.push('mutate:end');
		}
	},
	nudgeRegular() {
		events.push('nudge');
	},
	subscribeLibrary: () => () => undefined,
	whenLibraryLoaded: async () => undefined,
}));

vi.mock('../src/library/trash-storage', () => ({
	onTrashChange: () => () => undefined,
	readTrash: async () => [],
}));

const {deleteImageWithUndo, startSavedImages} =
	await import('../src/library/saved-images');

beforeEach(() => {
	events.length = 0;
	snacks.length = 0;
	storedThumbs = [sampleThumb];
});

test('startSavedImages sweeps orphan thumbnails inside mutateRegular even when the library is empty', async () => {
	await startSavedImages();
	assert.deepEqual(storedThumbs, []);
	assert.deepEqual(events, [
		'refresh',
		'mutate:start',
		'sweep:0',
		'mutate:end',
		'nudge',
	]);
});

test('deleteImageWithUndo runs delete and undo inside mutateRegular and nudges after', async () => {
	const reopened: string[] = [];
	await deleteImageWithUndo(sampleThumb.url, (url) => {
		reopened.push(url);
	});
	assert.deepEqual(storedThumbs, []);
	assert.equal(snacks[0]?.message, IMAGE_DELETED);
	assert.deepEqual(events, ['mutate:start', 'remove', 'mutate:end', 'nudge']);

	events.length = 0;
	await snacks[0]?.run?.();
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.deepEqual(reopened, [sampleThumb.url]);
	assert.deepEqual(events, ['mutate:start', 'put', 'mutate:end', 'nudge']);
});
