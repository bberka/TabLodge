import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import {IMAGE_DELETED, IMAGE_INDEX_KEY} from '../src/shared/image-store';
import {isRecoveryStorageKey} from '../src/app/recovery-keys';
import type {ShowStatus} from '../src/app/common';
import {WEBP, picture} from './image-fixtures';

type MessageRequest = {
	type: string;
	url?: string;
	urls?: string[];
	images?: unknown[];
};

type StorageListener = (changes: Record<string, unknown>, area: string) => void;

const manifest = {short_name: 'TabLodge', name: 'TabLodge', version: '0.0.0'};

function stubChrome(
	sendMessage: (message: MessageRequest) => Promise<unknown>,
) {
	const storageListeners: StorageListener[] = [];
	vi.stubGlobal('chrome', {
		extension: {inIncognitoContext: false},
		runtime: {getManifest: () => manifest, sendMessage},
		storage: {
			onChanged: {
				addListener(listener: StorageListener) {
					storageListeners.push(listener);
				},
			},
		},
	});
	return {
		emitStorageChange(changes: Record<string, unknown>, area = 'local') {
			for (const listener of storageListeners) {
				listener(changes, area);
			}
		},
	};
}

async function flushMicrotasks() {
	for (let index = 0; index < 5; index += 1) {
		await Promise.resolve();
	}
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

test('deleteSavedImage reports read errors and does not delete the picture', async () => {
	const calls: MessageRequest[] = [];
	stubChrome(async (message) => {
		calls.push(message);
		return message.type === 'GET_SAVED_IMAGE'
			? {ok: false, error: 'Could not read that image.'}
			: {ok: true};
	});

	const {deleteSavedImage} = await import('../src/app/saved-images');
	const statuses: Array<{message: string | null | undefined; error?: unknown}> =
		[];
	const showStatus: ShowStatus = (message, error) => {
		statuses.push({message, error});
	};

	let ranAfter = false;
	await deleteSavedImage('https://cdn.example/cat.png', showStatus, () => {
		ranAfter = true;
	});

	assert.deepEqual(
		calls.map((call) => call.type),
		['GET_SAVED_IMAGE'],
	);
	assert.equal(ranAfter, false);
	assert.deepEqual(statuses, [
		{message: 'Could not read that image.', error: true},
	]);
});

test('deleteSavedImage deletes and offers Undo when the image read succeeds', async () => {
	const saved = picture();
	const calls: MessageRequest[] = [];
	stubChrome(async (message) => {
		calls.push(message);
		if (message.type === 'GET_SAVED_IMAGE') {
			return {ok: true, image: saved, thumb: null};
		}

		if (message.type === 'DELETE_SAVED_IMAGE') {
			return {ok: true};
		}

		return message.type === 'ADD_SAVED_IMAGES'
			? {ok: true, images: 1}
			: {ok: true};
	});

	const {deleteSavedImage} = await import('../src/app/saved-images');
	let undoAction: (() => Promise<void> | void) | undefined;
	const statuses: Array<{message: string | null | undefined; error?: unknown}> =
		[];
	const showStatus: ShowStatus = (message, error, options) => {
		statuses.push({message, error});
		if (options?.action) {
			undoAction = options.action.onClick;
		}
	};

	let afterCount = 0;
	await deleteSavedImage(saved.url, showStatus, () => {
		afterCount += 1;
	});

	assert.deepEqual(
		calls.map((call) => call.type),
		['GET_SAVED_IMAGE', 'DELETE_SAVED_IMAGE'],
	);
	assert.equal(afterCount, 1);
	assert.deepEqual(statuses, [{message: IMAGE_DELETED, error: false}]);
	assert.ok(undoAction);

	await undoAction();
	assert.equal(calls.at(-1)?.type, 'ADD_SAVED_IMAGES');
	assert.equal(afterCount, 2);
});

test('a stale loadImages refresh does not put a deleted image back on the board', async () => {
	const firstUrl = 'https://cdn.example/one.png';
	const secondUrl = 'https://cdn.example/two.png';
	const slowThumbs = Promise.withResolvers<{
		ok: true;
		thumbs: Array<{url: string; thumb: string; savedAt: number}>;
	}>();
	let listCall = 0;

	const {emitStorageChange} = stubChrome(async (message) => {
		if (message.type === 'GET_SAVED_IMAGES') {
			listCall += 1;
			if (listCall === 1) {
				return {
					ok: true,
					items: [{url: firstUrl, savedAt: 1000, held: 10}],
				};
			}

			if (listCall === 2) {
				return {
					ok: true,
					items: [
						{url: firstUrl, savedAt: 1000, held: 10},
						{url: secondUrl, savedAt: 2000, held: 10},
					],
				};
			}

			return {ok: true, items: []};
		}

		if (message.type === 'GET_IMAGE_THUMBS') {
			if (message.urls?.includes(secondUrl)) {
				return slowThumbs.promise;
			}

			return {
				ok: true,
				thumbs: [{url: firstUrl, thumb: WEBP, savedAt: 1000}],
			};
		}

		return {ok: true};
	});

	const {getSavedImages, watchSavedImages} =
		await import('../src/app/saved-images');
	const stop = watchSavedImages(() => undefined);
	await flushMicrotasks();
	assert.equal(getSavedImages().has(firstUrl), true);

	emitStorageChange({[IMAGE_INDEX_KEY]: {newValue: []}});
	await flushMicrotasks();

	emitStorageChange({[IMAGE_INDEX_KEY]: {newValue: []}});
	await flushMicrotasks();
	assert.equal(getSavedImages().size, 0);

	slowThumbs.resolve({
		ok: true,
		thumbs: [{url: secondUrl, thumb: WEBP, savedAt: 2000}],
	});
	await flushMicrotasks();

	assert.equal(getSavedImages().size, 0);
	assert.equal(getSavedImages().has(firstUrl), false);
	stop();
});

test('loadSavedImage announces load errors through showStatus and stays quiet on success', async () => {
	const saved = picture();
	let nextResult: unknown = {ok: false, error: 'Image store failed.'};
	stubChrome(async () => nextResult);

	const {loadSavedImage} = await import('../src/app/saved-images');
	const statuses: Array<{message: string | null | undefined; error?: unknown}> =
		[];
	const showStatus: ShowStatus = (message, error) => {
		statuses.push({message, error});
	};

	const failed = await loadSavedImage(saved.url, showStatus);
	assert.deepEqual(failed, {
		image: null,
		thumb: null,
		error: 'Image store failed.',
	});
	assert.deepEqual(statuses, [{message: 'Image store failed.', error: true}]);

	nextResult = {ok: true, image: saved, thumb: null};
	const succeeded = await loadSavedImage(saved.url, showStatus);
	assert.deepEqual(succeeded, {image: saved, thumb: null, error: ''});
	assert.equal(statuses.length, 1);

	nextResult = {ok: false, error: 'Ignored after unmount.'};
	const stale = await loadSavedImage(saved.url, showStatus, () => false);
	assert.equal(stale, undefined);
	assert.equal(statuses.length, 1);
});

test('isRecoveryStorageKey matches the image index alongside recovery keys', () => {
	assert.equal(isRecoveryStorageKey(IMAGE_INDEX_KEY), true);
	assert.equal(isRecoveryStorageKey('tablodge.trash'), true);
	assert.equal(isRecoveryStorageKey('tablodge.backups'), true);
	assert.equal(isRecoveryStorageKey('tablodge.snapshots'), true);
	assert.equal(isRecoveryStorageKey('tablodge.state'), false);
	assert.equal(isRecoveryStorageKey('tablodge.image.abc'), false);
});

test('backupImageParts throws when reading a held original fails and keeps non-held thumbs', async () => {
	const saved = picture();
	const {data: _data, ...rawThumb} = saved;
	const thumb = {...rawThumb, type: 'image/png' as const};
	let readResult: unknown = {ok: false, error: 'Original read failed.'};
	stubChrome(async (message) =>
		message.type === 'GET_SAVED_IMAGE' ? readResult : {ok: true},
	);

	const {backupImageParts} = await import('../src/app/saved-images');
	const remoteOnly = await backupImageParts([{...thumb, held: false}]);
	assert.deepEqual(remoteOnly, {images: [thumb], imageFiles: {}});

	await assert.rejects(
		async () => backupImageParts([{...thumb, held: true}]),
		/Original read failed\./,
	);

	readResult = {ok: true, image: null, thumb};
	await assert.rejects(
		async () => backupImageParts([{...thumb, held: true}]),
		/Could not read a saved image\./,
	);
});

test('restoreBackupImages counts failed image restores and keeps earlier ones', async () => {
	const first = picture();
	const second = {...picture(), url: 'https://cdn.example/dog.png'};
	const {data: _firstData, ...firstThumb} = first;
	const {data: _secondData, ...secondThumb} = second;
	let call = 0;
	stubChrome(async (message) => {
		if (message.type === 'ADD_SAVED_IMAGES') {
			call += 1;
			return call === 1
				? {ok: true, images: 1}
				: {ok: false, error: 'Image storage is full.'};
		}

		return {ok: true};
	});

	const {restoreBackupImages} = await import('../src/app/saved-images');
	const outcome = await restoreBackupImages({
		images: [firstThumb, secondThumb],
		imageFiles: {},
	});
	assert.deepEqual(outcome, {
		restored: 1,
		failed: 1,
		error: 'Image storage is full.',
	});
});
