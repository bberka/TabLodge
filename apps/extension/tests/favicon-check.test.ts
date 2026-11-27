import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createMissingIconCache, sameBytes} from '../src/app/favicon-check';

const DEFAULT_GLOBE = new Uint8Array([1, 2, 3, 4]);
const REAL_ICON = new Uint8Array([1, 2, 3, 9]);
const DEFAULT_URL = 'chrome-extension://test/_favicon/?pageUrl=invalid';

test('sameBytes compares byte arrays by length and content', () => {
	assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
	assert.equal(
		sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])),
		false,
	);
	assert.equal(
		sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
		false,
	);
	assert.equal(sameBytes(new Uint8Array(), new Uint8Array()), true);
});

test('caches missing and present icon checks per host', async () => {
	const fetched: string[] = [];
	const cache = createMissingIconCache({
		defaultUrl: DEFAULT_URL,
		async fetchBytes(url) {
			fetched.push(url);
			return url === DEFAULT_URL || url.includes('missing.example')
				? DEFAULT_GLOBE
				: REAL_ICON;
		},
	});

	assert.equal(cache.knownMissing('missing.example'), undefined);
	assert.equal(
		await cache.isMissing(
			'missing.example',
			'chrome-extension://test/missing.example/a',
		),
		true,
	);
	assert.equal(cache.knownMissing('missing.example'), true);
	assert.equal(
		await cache.isMissing(
			'missing.example',
			'chrome-extension://test/missing.example/b',
		),
		true,
	);

	assert.equal(
		await cache.isMissing(
			'visited.example',
			'chrome-extension://test/visited.example/a',
		),
		false,
	);
	assert.equal(cache.knownMissing('visited.example'), false);
	assert.equal(
		await cache.isMissing(
			'visited.example',
			'chrome-extension://test/visited.example/b',
		),
		false,
	);

	assert.deepEqual(fetched, [
		'chrome-extension://test/missing.example/a',
		DEFAULT_URL,
		'chrome-extension://test/visited.example/a',
	]);
});

test('deduplicates concurrent checks for the same host and notifies once', async () => {
	let fetchCount = 0;
	const gate = Promise.withResolvers<void>();
	const resolved: Array<[string, boolean]> = [];
	const cache = createMissingIconCache({
		defaultUrl: DEFAULT_URL,
		async fetchBytes(url) {
			if (url === DEFAULT_URL) {
				return DEFAULT_GLOBE;
			}

			fetchCount += 1;
			await gate.promise;
			return DEFAULT_GLOBE;
		},
		onResolved(host, missing) {
			resolved.push([host, missing]);
		},
	});

	const first = cache.isMissing(
		'dup.example',
		'chrome-extension://test/dup.example/1',
	);
	const second = cache.isMissing(
		'dup.example',
		'chrome-extension://test/dup.example/2',
	);
	const third = cache.isMissing(
		'dup.example',
		'chrome-extension://test/dup.example/3',
	);
	gate.resolve();

	assert.deepEqual(await Promise.all([first, second, third]), [
		true,
		true,
		true,
	]);
	assert.equal(fetchCount, 1);
	assert.deepEqual(resolved, [['dup.example', true]]);
});

test('does not cache transient fetch failures and retries on next call', async () => {
	let attempts = 0;
	const cache = createMissingIconCache({
		defaultUrl: DEFAULT_URL,
		async fetchBytes(url) {
			if (url === DEFAULT_URL) {
				return DEFAULT_GLOBE;
			}

			attempts += 1;
			if (attempts === 1) {
				throw new Error('offline');
			}

			return DEFAULT_GLOBE;
		},
	});

	assert.equal(
		await cache.isMissing(
			'flaky.example',
			'chrome-extension://test/flaky.example/1',
		),
		false,
	);
	assert.equal(cache.knownMissing('flaky.example'), undefined);
	assert.equal(
		await cache.isMissing(
			'flaky.example',
			'chrome-extension://test/flaky.example/2',
		),
		true,
	);
	assert.equal(cache.knownMissing('flaky.example'), true);
	assert.equal(attempts, 2);
});

test('evicts the oldest host when the cache exceeds maxHosts', async () => {
	const cache = createMissingIconCache({
		defaultUrl: DEFAULT_URL,
		maxHosts: 2,
		async fetchBytes() {
			return DEFAULT_GLOBE;
		},
	});

	await cache.isMissing('one.example', 'chrome-extension://test/one');
	await cache.isMissing('two.example', 'chrome-extension://test/two');
	await cache.isMissing('three.example', 'chrome-extension://test/three');

	assert.equal(cache.knownMissing('one.example'), undefined);
	assert.equal(cache.knownMissing('two.example'), true);
	assert.equal(cache.knownMissing('three.example'), true);
});
