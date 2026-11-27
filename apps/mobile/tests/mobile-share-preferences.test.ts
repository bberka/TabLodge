import assert from 'node:assert/strict';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {decideCloseAfterShare} from '../src/library/shared-content';

const storage = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	reads: [] as string[],
	hold: undefined as Promise<void> | undefined,
}));

vi.mock('react-native', () => ({
	Appearance: {
		setColorScheme() {},
	},
	Platform: {
		OS: 'android',
	},
}));

vi.mock('../src/platform/storage', () => ({
	async readJson(key: string) {
		storage.reads.push(key);
		await storage.hold;
		return structuredClone(storage.values.get(key));
	},
	async writeJson(key: string, value: unknown) {
		storage.values.set(key, structuredClone(value));
	},
}));

beforeEach(() => {
	storage.values.clear();
	storage.reads.length = 0;
	storage.hold = undefined;
	vi.resetModules();
});

describe('cold-start share preference loading', () => {
	test('waits for in-flight loadPreferences so Stay is respected on cold start without duplicating storage reads', async () => {
		storage.values.set('tablodge.prefs', {afterShare: 'stay'});
		const gate = Promise.withResolvers<void>();
		storage.hold = gate.promise;

		const {getPreferences, loadPreferences} =
			await import('../src/settings/preferences');

		const startup = loadPreferences();
		assert.equal(getPreferences().afterShare, 'close');

		const decision = decideCloseAfterShare(
			true,
			loadPreferences,
			() => getPreferences().afterShare,
		);

		gate.resolve();
		await startup;

		assert.equal(await decision, false);
		assert.equal(getPreferences().afterShare, 'stay');
		assert.deepEqual(storage.reads, [
			'tablodge.prefs.changed-at',
			'tablodge.prefs',
		]);
	});

	test('returns true on cold start when stored preference is close', async () => {
		storage.values.set('tablodge.prefs', {afterShare: 'close'});
		const {getPreferences, loadPreferences} =
			await import('../src/settings/preferences');

		assert.equal(
			await decideCloseAfterShare(
				true,
				loadPreferences,
				() => getPreferences().afterShare,
			),
			true,
		);
	});
});
