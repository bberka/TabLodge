import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	checkForUpdate,
	COOLDOWN_MS,
	downloadLabel,
	isNewer,
	parseCache,
	parseRelease,
	type UpdateCache,
} from '../src/update/update-check';

const URL =
	'https://github.com/bberka/TabLodge/releases/download/v0.2.5/tablodge.apk';
const release = (
	tag: string,
	assets: unknown[] = [{name: 'tablodge.apk', browser_download_url: URL}],
) => ({
	tag_name: tag,
	assets,
});

describe('isNewer', () => {
	test('compares each part as a number', () => {
		assert.equal(isNewer('0.2.5', '0.2.4'), true);
		assert.equal(isNewer('0.10.0', '0.9.9'), true);
		assert.equal(isNewer('0.2.4', '0.2.4'), false);
		assert.equal(isNewer('0.2.3', '0.2.4'), false);
		assert.equal(isNewer('v0.3.0', '0.2.9'), true);
		assert.equal(isNewer('nightly', '0.2.4'), false);
	});
});

describe('parseRelease', () => {
	test('reads the version and the APK', () => {
		assert.deepEqual(parseRelease(release('v0.2.5')), {
			version: '0.2.5',
			apkUrl: URL,
		});
	});

	test('keeps a release whose APK is not attached yet', () => {
		assert.deepEqual(parseRelease(release('v0.2.5', [])), {version: '0.2.5'});
	});

	test('refuses an APK address outside this repository', () => {
		const asset = {
			name: 'tablodge.apk',
			browser_download_url: 'https://evil.example/tablodge.apk',
		};
		assert.deepEqual(parseRelease(release('v0.2.5', [asset])), {
			version: '0.2.5',
		});
	});

	test('refuses what is not a release', () => {
		assert.equal(parseRelease(null), undefined);
		assert.equal(parseRelease({message: 'rate limited'}), undefined);
		assert.equal(parseRelease(release('latest')), undefined);
	});
});

describe('checkForUpdate', () => {
	const NOW = 10 * COOLDOWN_MS;
	const ask = (value: unknown) => {
		let calls = 0;
		return {
			async fetchLatest() {
				calls++;
				if (value instanceof Error) {
					throw value;
				}

				return value;
			},
			calls: () => calls,
		};
	};

	test('offers a newer release and saves the answer', async () => {
		const fake = ask(release('v0.2.5'));
		const result = await checkForUpdate({
			installed: '0.2.4',
			now: NOW,
			cache: undefined,
			fetchLatest: fake.fetchLatest,
		});
		assert.deepEqual(result.outcome, {
			status: 'available',
			version: '0.2.5',
			apkUrl: URL,
		});
		assert.equal(result.cache?.at, NOW);
	});

	test('says current when nothing is newer or the APK is not attached', async () => {
		for (const [tag, assets] of [
			['v0.2.4', undefined],
			['v0.2.5', []],
		] as const) {
			const result = await checkForUpdate({
				installed: '0.2.4',
				now: NOW,
				cache: undefined,
				fetchLatest: ask(release(tag, assets as unknown[] | undefined))
					.fetchLatest,
			});
			assert.deepEqual(result.outcome, {status: 'current'});
		}
	});

	test('asks nothing inside the hour and again after it', async () => {
		const cache: UpdateCache = {
			at: NOW - COOLDOWN_MS + 1,
			latest: {version: '0.2.5', apkUrl: URL},
		};
		const fake = ask(release('v0.2.6'));
		const inside = await checkForUpdate({
			installed: '0.2.4',
			now: NOW,
			cache,
			fetchLatest: fake.fetchLatest,
		});
		assert.equal(fake.calls(), 0);
		assert.equal(inside.outcome.status, 'available');
		assert.equal(inside.cache, undefined);

		const after = await checkForUpdate({
			installed: '0.2.4',
			now: NOW + 1,
			cache,
			fetchLatest: fake.fetchLatest,
		});
		assert.equal(fake.calls(), 1);
		assert.deepEqual(after.outcome, {
			status: 'available',
			version: '0.2.6',
			apkUrl: URL,
		});
	});

	test('stops offering the saved release once it is installed', async () => {
		const result = await checkForUpdate({
			installed: '0.2.5',
			now: NOW,
			cache: {at: NOW - 1, latest: {version: '0.2.5', apkUrl: URL}},
			fetchLatest: ask(new Error('unused')).fetchLatest,
		});
		assert.deepEqual(result.outcome, {status: 'current'});
	});

	test('a failed request starts no cooldown', async () => {
		for (const value of [new Error('offline'), {message: 'rate limited'}]) {
			const result = await checkForUpdate({
				installed: '0.2.4',
				now: NOW,
				cache: undefined,
				fetchLatest: ask(value).fetchLatest,
			});
			assert.deepEqual(result, {outcome: {status: 'failed'}});
		}
	});

	test('a clock set back ignores the saved answer', async () => {
		const fake = ask(release('v0.2.5'));
		await checkForUpdate({
			installed: '0.2.4',
			now: NOW,
			cache: {at: NOW + COOLDOWN_MS, latest: {version: '0.2.5', apkUrl: URL}},
			fetchLatest: fake.fetchLatest,
		});
		assert.equal(fake.calls(), 1);
	});
});

describe('parseCache', () => {
	test('round trips an answer and drops a damaged one', () => {
		const cache: UpdateCache = {at: 5, latest: {version: '0.2.5', apkUrl: URL}};
		assert.deepEqual(parseCache(structuredClone(cache)), cache);
		assert.equal(parseCache({at: 'x', latest: {version: '0.2.5'}}), undefined);
		assert.equal(parseCache(undefined), undefined);
	});
});

describe('downloadLabel', () => {
	test('shows a percentage when the size is known and megabytes when it is not', () => {
		assert.equal(downloadLabel(0, 26_000_000), 'Downloading… 0%');
		assert.equal(downloadLabel(13_000_000, 26_000_000), 'Downloading… 50%');
		assert.equal(downloadLabel(26_000_001, 26_000_000), 'Downloading… 100%');
		assert.equal(downloadLabel(11_250_000, -1), 'Downloading… 11.3 MB');
		assert.equal(downloadLabel(0, -1), 'Downloading…');
	});
});
