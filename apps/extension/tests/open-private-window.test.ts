import assert from 'node:assert/strict';
import {afterEach, test, vi} from 'vite-plus/test';

const created: unknown[] = [];

async function load(refuse?: string) {
	vi.resetModules();
	created.length = 0;
	vi.stubGlobal('chrome', {
		runtime: {getURL: () => 'chrome-extension://abc/'},
		windows: {
			async create(options: unknown) {
				if (refuse) {
					throw new Error(refuse);
				}

				created.push(options);
			},
		},
	});
	return import('../src/app/link-target');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

test('opens the link in a focused incognito window', async () => {
	const {openInPrivateWindow} = await load();
	await openInPrivateWindow('https://example.com/a', {
		removeTrackingParameters: false,
	});
	assert.deepEqual(created, [
		{url: 'https://example.com/a', incognito: true, focused: true},
	]);
});

test('removes tracking parameters when the setting is on', async () => {
	const {openInPrivateWindow} = await load();
	await openInPrivateWindow('https://example.com/a?utm_source=x&id=1', {
		removeTrackingParameters: true,
	});
	assert.deepEqual(created, [
		{url: 'https://example.com/a?id=1', incognito: true, focused: true},
	]);
});

test('refuses an address that is not a web link', async () => {
	const {openInPrivateWindow} = await load();
	await assert.rejects(
		openInPrivateWindow('javascript:alert(1)', {
			removeTrackingParameters: false,
		}),
		/valid web address/,
	);
	assert.equal(created.length, 0);
});

test('passes the browser refusal on so the caller can show it', async () => {
	const {openInPrivateWindow} = await load('Incognito mode is disabled.');
	await assert.rejects(
		openInPrivateWindow('https://example.com/', {
			removeTrackingParameters: false,
		}),
		/Incognito mode is disabled/,
	);
});
