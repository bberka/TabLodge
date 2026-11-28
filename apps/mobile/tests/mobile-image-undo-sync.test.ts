import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vite-plus/test';
import {PNG, WEBP} from '../../extension/tests/image-fixtures';
import {
	base64Size,
	createImageStore,
	IMAGE_INDEX_KEY,
	imageId,
	type ImageStorage,
	type SavedImage,
} from '../../extension/src/shared/image-store';
import {createSyncClient} from '../../extension/src/shared/sync/client';
import type {Store} from '../../extension/src/shared/types';
import {createApi} from '../../server/src/api';
import {SqlChangeLog} from '../../server/src/sql-change-log';
import {sqlite} from '../../server/src/node-sqlite';
import {emptyStore} from '../src/library/store-shape';

const TOKEN = 'image-undo-sync-token-0123456789-abcdef';
const URL_BASE = 'https://sync.example.test';
const IMAGE_URL = 'https://cdn.example/photo.png';
const PNG_BASE64 = PNG;
const WEBP_BASE64 = WEBP;

type SnackEntry = {
	run?: () => void | Promise<void>;
	closed?: () => void;
};

const phoneStorage = new Map<string, unknown>();
let activeSnack: SnackEntry | undefined;
let phoneQueue = Promise.resolve();
let phoneStore: Store = emptyStore(1000);
let phoneClient: ReturnType<typeof createSyncClient>;
let privateView = false;

function closeSnack(): void {
	const closing = activeSnack;
	activeSnack = undefined;
	closing?.closed?.();
}

function mapStorage(map: Map<string, unknown>): ImageStorage {
	return {
		async get(keys) {
			return Object.fromEntries(
				keys.flatMap((key) =>
					map.has(key) ? [[key, structuredClone(map.get(key))]] : [],
				),
			);
		},
		async set(items) {
			for (const [key, value] of Object.entries(items)) {
				map.set(key, structuredClone(value));
			}
		},
		async remove(keys) {
			for (const key of keys) {
				map.delete(key);
			}
		},
	};
}

vi.mock('../src/platform/storage', () => ({
	readJson: async (key: string) => structuredClone(phoneStorage.get(key)),
	async writeJson(key: string, value: unknown) {
		phoneStorage.set(key, structuredClone(value));
	},
	async removeKeys(keys: string[]) {
		for (const key of keys) {
			phoneStorage.delete(key);
		}
	},
}));

vi.mock('../src/ui/snackbar', () => ({
	showSnack(
		_message: string,
		action?: {run: () => void | Promise<void>; closed?: () => void},
	) {
		closeSnack();
		activeSnack = {run: action?.run, closed: action?.closed};
	},
}));

vi.mock('../src/library/library-store', () => ({
	getLibrary: () => phoneStore,
	mutateRegular<T>(work: () => Promise<T>): Promise<T> {
		const next = phoneQueue.then(work, work);
		phoneQueue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	},
	nudgeRegular() {
		phoneClient.localChanged();
	},
	subscribeLibrary: () => () => undefined,
	whenLibraryLoaded: async () => true,
}));

vi.mock('../src/library/trash-storage', () => ({
	onTrashChange: () => () => undefined,
	readTrash: async () => [],
}));

vi.mock('../src/library/view', () => ({
	isPrivateView: () => privateView,
}));

const {getImageThumbs, refreshImageThumbs, thumbSync} =
	await import('../src/library/image-thumbs');
const {deleteImageWithUndo, startSavedImages} =
	await import('../src/library/saved-images');

const sampleImage: SavedImage = {
	url: IMAGE_URL,
	type: 'image/png',
	width: 640,
	height: 480,
	size: base64Size(PNG_BASE64),
	savedAt: 1000,
	device: 'Desk',
	thumb: WEBP_BASE64,
	data: PNG_BASE64,
};

async function setupSync() {
	const log = new SqlChangeLog(sqlite(':memory:'));
	const app = createApi({token: TOKEN, log: () => log});
	const extensionStorage = new Map<string, unknown>();
	const extensionImages = createImageStore(mapStorage(extensionStorage));
	let extensionQueue = Promise.resolve();
	let extensionStore: Store = {
		...emptyStore(1000),
		bookmarkColumns: [{id: 'c1', name: 'Pics', createdAt: 1, isDefault: true}],
		bookmarks: [
			{
				id: 'b1',
				title: 'Photo',
				url: IMAGE_URL,
				columnId: 'c1',
				createdAt: 1,
				updatedAt: 1,
			},
		],
	};
	await extensionImages.keep(sampleImage);

	let extSeq = 0;
	const extensionClient = createSyncClient({
		get: async (key) => structuredClone(extensionStorage.get(key)),
		async set(key, value) {
			extensionStorage.set(key, structuredClone(value));
		},
		async remove(keys) {
			for (const key of keys) {
				extensionStorage.delete(key);
			}
		},
		fetch: async (url, init) => app.request(url, init),
		readOnly: false,
		mutate<T>(work: () => Promise<T>) {
			const next = extensionQueue.then(work, work);
			extensionQueue = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
		readLibrary: async () => structuredClone(extensionStore),
		async writeLibrary(next) {
			extensionStore = structuredClone(next);
		},
		thumbs: {
			read: async () => extensionImages.synced(),
			apply: async (put, remove) => extensionImages.applySynced(put, remove),
		},
		async backup() {},
		randomId: () => `ext-${++extSeq}`,
		now: () => 2000,
	});

	let phoneSeq = 0;
	phoneClient = createSyncClient({
		get: async (key) => structuredClone(phoneStorage.get(key)),
		async set(key, value) {
			phoneStorage.set(key, structuredClone(value));
		},
		async remove(keys) {
			for (const key of keys) {
				phoneStorage.delete(key);
			}
		},
		fetch: async (url, init) => app.request(url, init),
		readOnly: false,
		mutate<T>(work: () => Promise<T>) {
			const next = phoneQueue.then(work, work);
			phoneQueue = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
		readLibrary: async () => structuredClone(phoneStore),
		async writeLibrary(next) {
			phoneStore = structuredClone(next);
		},
		thumbs: thumbSync,
		async backup() {},
		randomId: () => `phone-${++phoneSeq}`,
		now: () => 2000,
	});

	await extensionClient.connect(URL_BASE, TOKEN);
	await phoneClient.connect(URL_BASE, TOKEN);
	await refreshImageThumbs();

	return {extensionImages, extensionClient, extensionStorage};
}

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await phoneQueue;
};

beforeEach(() => {
	phoneStorage.clear();
	activeSnack = undefined;
	phoneQueue = Promise.resolve();
	phoneStore = emptyStore(1000);
	privateView = false;
});

test('syncing while the Undo snackbar is open preserves the original on the holder, and Undo restores it on the phone', async () => {
	const {extensionImages, extensionClient} = await setupSync();
	assert.ok(getImageThumbs().has(IMAGE_URL));

	await deleteImageWithUndo(IMAGE_URL, () => undefined);
	assert.ok(!getImageThumbs().has(IMAGE_URL));

	await phoneClient.syncNow();
	await extensionClient.syncNow();

	const held = await extensionImages.read(IMAGE_URL);
	assert.equal(held?.data, PNG_BASE64);
	assert.equal((await extensionImages.list())[0]?.held, base64Size(PNG_BASE64));

	await activeSnack?.run?.();
	closeSnack();
	await flush();

	assert.ok(getImageThumbs().has(IMAGE_URL));
	await phoneClient.syncNow();
	await extensionClient.syncNow();
	assert.equal((await extensionImages.read(IMAGE_URL))?.data, PNG_BASE64);
});

test('closing the snackbar without Undo commits removal and syncs deletion to the holder', async () => {
	const {extensionImages, extensionClient} = await setupSync();

	await deleteImageWithUndo(IMAGE_URL, () => undefined);
	assert.ok(!getImageThumbs().has(IMAGE_URL));

	closeSnack();
	await flush();

	await phoneClient.syncNow();
	await extensionClient.syncNow();

	assert.equal(await extensionImages.read(IMAGE_URL), undefined);
	assert.deepEqual(await extensionImages.list(), []);
	assert.equal(phoneStorage.get(IMAGE_INDEX_KEY) !== undefined, true);
	assert.deepEqual(await thumbSync.read(), []);
	assert.equal(phoneStorage.has(`tablodge.thumb.${imageId(IMAGE_URL)}`), false);
});

test('startup sweep does not resurrect or delete a pending picture', async () => {
	await setupSync();
	phoneStore = emptyStore(1000);

	await deleteImageWithUndo(IMAGE_URL, () => undefined);
	assert.ok(!getImageThumbs().has(IMAGE_URL));

	await startSavedImages();
	assert.ok(!getImageThumbs().has(IMAGE_URL));
	assert.equal((await thumbSync.read()).length, 1);

	await activeSnack?.run?.();
	closeSnack();
	await flush();
	assert.ok(getImageThumbs().has(IMAGE_URL));
});
