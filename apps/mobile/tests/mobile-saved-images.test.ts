import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vite-plus/test';
import {
	IMAGE_DELETED,
	type SavedThumb,
} from '../../extension/src/shared/image-store';
import {DEFAULT_SETTINGS} from '../../extension/src/shared/library-normalize';
import {emptyStore} from '../src/library/store-shape';

const events: string[] = [];
type SnackEntry = {
	message: string;
	run?: () => void | Promise<void>;
	closed?: () => void;
};
let activeSnack: SnackEntry | undefined;
const snacks: SnackEntry[] = [];
let storedThumbs: SavedThumb[] = [];
const hidden = new Set<string>();
let libraryLoadedOk = true;
let privateView = false;
let askBeforeDeleting = false;

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

const secondThumb: SavedThumb = {
	...sampleThumb,
	url: 'https://cdn.example/dog.png',
};

function closeActiveSnack(): void {
	const closing = activeSnack;
	activeSnack = undefined;
	closing?.closed?.();
}

vi.mock('../src/ui/snackbar', () => ({
	showSnack(
		message: string,
		action?: {run: () => void | Promise<void>; closed?: () => void},
	) {
		closeActiveSnack();
		const entry: SnackEntry = {
			message,
			run: action?.run,
			closed: action?.closed,
		};
		activeSnack = entry;
		snacks.push(entry);
	},
}));

vi.mock('../src/library/image-thumbs', () => ({
	hideImageThumb(url: string) {
		if (hidden.has(url) || storedThumbs.every((item) => item.url !== url)) {
			return false;
		}

		hidden.add(url);
		events.push(`hide:${url}`);
		return true;
	},
	showImageThumb(url: string) {
		if (hidden.delete(url)) {
			events.push(`show:${url}`);
		}
	},
	async refreshImageThumbs() {
		events.push('refresh');
	},
	async removeImageThumb(url: string) {
		events.push(`remove:${url}`);
		hidden.delete(url);
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
	getLibrary: () => ({
		...emptyStore(0),
		settings: {...DEFAULT_SETTINGS, askBeforeDeleting},
	}),
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
	whenLibraryLoaded: async () => libraryLoadedOk,
}));

vi.mock('../src/library/trash-storage', () => ({
	onTrashChange: () => () => undefined,
	readTrash: async () => [],
}));

vi.mock('../src/library/view', () => ({
	isPrivateView: () => privateView,
}));

const {deleteImageWithUndo, startSavedImages} =
	await import('../src/library/saved-images');

const flushMicrotasks = async () => {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
};

beforeEach(() => {
	events.length = 0;
	snacks.length = 0;
	activeSnack = undefined;
	hidden.clear();
	storedThumbs = [sampleThumb];
	libraryLoadedOk = true;
	privateView = false;
	askBeforeDeleting = false;
});

test('startSavedImages skips sweeping when loading the library failed', async () => {
	libraryLoadedOk = false;
	await startSavedImages();
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.deepEqual(events, ['refresh']);
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

test('deleteImageWithUndo hides in memory until Undo or snackbar close', async () => {
	const reopened: string[] = [];
	await deleteImageWithUndo(sampleThumb.url, (url) => {
		reopened.push(url);
	});
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.ok(hidden.has(sampleThumb.url));
	assert.equal(snacks[0]?.message, IMAGE_DELETED);
	assert.deepEqual(events, [`hide:${sampleThumb.url}`]);

	events.length = 0;
	await snacks[0]?.run?.();
	closeActiveSnack();
	await flushMicrotasks();
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.ok(!hidden.has(sampleThumb.url));
	assert.deepEqual(reopened, [sampleThumb.url]);
	assert.deepEqual(events, [`show:${sampleThumb.url}`]);
});

test('closing the snackbar without Undo commits removal inside mutateRegular and nudges', async () => {
	await deleteImageWithUndo(sampleThumb.url, () => undefined);
	events.length = 0;

	closeActiveSnack();
	await flushMicrotasks();

	assert.deepEqual(storedThumbs, []);
	assert.deepEqual(events, [
		'mutate:start',
		`remove:${sampleThumb.url}`,
		'mutate:end',
		'nudge',
	]);
});

test('a second delete while the first message is up commits the first and keeps the second pending', async () => {
	storedThumbs = [sampleThumb, secondThumb];
	const reopened: string[] = [];
	await deleteImageWithUndo(sampleThumb.url, (url) => {
		reopened.push(url);
	});
	await deleteImageWithUndo(secondThumb.url, (url) => {
		reopened.push(url);
	});
	await flushMicrotasks();

	assert.deepEqual(storedThumbs, [secondThumb]);
	assert.ok(!hidden.has(sampleThumb.url));
	assert.ok(hidden.has(secondThumb.url));

	await snacks[1]?.run?.();
	closeActiveSnack();
	await flushMicrotasks();
	assert.deepEqual(storedThumbs, [secondThumb]);
	assert.deepEqual(reopened, [secondThumb.url]);
});

test('startup sweep does not remove a pending picture', async () => {
	await deleteImageWithUndo(sampleThumb.url, () => undefined);
	events.length = 0;

	await startSavedImages();
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.ok(hidden.has(sampleThumb.url));
	assert.deepEqual(events, [
		'refresh',
		'mutate:start',
		'sweep:1',
		'mutate:end',
	]);

	closeActiveSnack();
	await flushMicrotasks();
	assert.deepEqual(storedThumbs, []);
});

test('switching to private view does not reopen regular viewer on Undo and still commits on close', async () => {
	storedThumbs = [sampleThumb, secondThumb];
	const reopened: string[] = [];
	await deleteImageWithUndo(sampleThumb.url, (url) => {
		reopened.push(url);
	});
	privateView = true;
	await snacks[0]?.run?.();
	closeActiveSnack();
	await flushMicrotasks();
	assert.equal(reopened.length, 0);
	assert.ok(!hidden.has(sampleThumb.url));
	assert.deepEqual(storedThumbs, [sampleThumb, secondThumb]);

	await deleteImageWithUndo(secondThumb.url, (url) => {
		reopened.push(url);
	});
	closeActiveSnack();
	await flushMicrotasks();
	assert.deepEqual(storedThumbs, [sampleThumb]);
});

test('Ask before deleting does not block or break deferred image deletion', async () => {
	askBeforeDeleting = true;
	await deleteImageWithUndo(sampleThumb.url, () => undefined);
	assert.deepEqual(storedThumbs, [sampleThumb]);
	assert.ok(hidden.has(sampleThumb.url));
	closeActiveSnack();
	await flushMicrotasks();
	assert.deepEqual(storedThumbs, []);
});
