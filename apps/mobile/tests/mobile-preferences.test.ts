import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	MOBILE_APP_KEYS_MAX,
	normalizeMobileApp,
} from '../../extension/src/shared/library-normalize';
import {
	AT_PREFIX,
	settlePreferences,
	type ChangedAt,
	type MobileApp,
} from '../src/settings/preference-merge';
import {
	defaults,
	parsePreferences,
	readSyncedPreferences,
	SYNCED_KEYS,
	syncedPreferences,
	type Preferences,
} from '../src/settings/preference-schema';

const changed: Preferences = {
	...defaults,
	look: 'ios',
	floatingBar: false,
	barSize: 'compact',
	barLabels: 'always',
	tapAction: 'edit',
	swipeRight: 'move',
	swipeLeft: 'none',
	sessionSwipeRight: 'share',
	sessionSwipeLeft: 'rename',
	linkSwipeRight: 'open',
	linkSwipeLeft: 'edit',
	sessionTap: 'open',
	sessionMain: 'archive',
	cleanOnSave: false,
	siteIcons: 'direct',
	savePreview: false,
	accent: '#336699',
	theme: 'dark',
	compactSessions: true,
	showSavedOn: false,
};

describe('preference schema', () => {
	test("a synced key is never lost to the extension's limit", () => {
		// Each synced key is sent with the time it changed.
		assert.ok(SYNCED_KEYS.length * 2 <= MOBILE_APP_KEYS_MAX);
		const both = Object.fromEntries(
			SYNCED_KEYS.flatMap((key) => [
				[key, changed[key]],
				[AT_PREFIX + key, 1],
			]),
		);
		assert.equal(
			Object.keys(normalizeMobileApp(both)).length,
			SYNCED_KEYS.length * 2,
		);
	});

	test('every synced preference survives a trip through the library', () => {
		const sent = normalizeMobileApp(syncedPreferences(changed));
		assert.deepEqual(
			readSyncedPreferences(sent),
			Object.fromEntries(SYNCED_KEYS.map((key) => [key, changed[key]])),
		);
	});

	test('a value that is not valid is left out of a sync and falls back when loaded', () => {
		const bad = {
			look: 'retro',
			theme: 'dark',
			swipeLeft: 7,
			sessionMain: 'none',
		};
		assert.deepEqual(readSyncedPreferences(bad), {theme: 'dark'});
		const loaded = parsePreferences(bad);
		assert.equal(loaded.look, defaults.look);
		assert.equal(loaded.swipeLeft, defaults.swipeLeft);
		assert.equal(loaded.sessionMain, defaults.sessionMain);
		assert.equal(loaded.theme, 'dark');
	});

	test('sync carries only what is synced, and loading takes the rest from storage', () => {
		const raw = {theme: 'light', glassEffect: false, openApp: 'org.example'};
		assert.deepEqual(readSyncedPreferences(raw), {theme: 'light'});
		const loaded = parsePreferences(raw);
		assert.equal(loaded.glassEffect, false);
		assert.equal(loaded.openApp, 'org.example');
		assert.equal('glassEffect' in syncedPreferences(loaded), false);
	});

	test('the Icons only bar and the old site icon switch still read', () => {
		assert.deepEqual(readSyncedPreferences({barSize: 'icons'}), {
			barSize: 'full',
			barLabels: 'never',
		});
		assert.equal(parsePreferences({siteIcons: true}).siteIcons, 'direct');
		assert.equal(parsePreferences({siteIcons: false}).siteIcons, 'server');
	});

	test('anything that is not an object loads as the defaults', () => {
		assert.deepEqual(parsePreferences(null), defaults);
		assert.deepEqual(parsePreferences('x'), defaults);
	});
});

describe('settling with the other phones', () => {
	const phone = (values: Partial<Preferences>, at: ChangedAt) => ({
		prefs: {...defaults, ...values},
		at,
	});
	// What the library does with two writes of the record: one of them wins whole.
	const settleAll = (
		phones: Array<ReturnType<typeof phone>>,
		library: MobileApp,
	): MobileApp => {
		let current = library;
		for (let round = 0; round < 4; round++) {
			for (const one of phones) {
				const result = settlePreferences(current, one.prefs, one.at);
				one.prefs = {...one.prefs, ...result.adopt};
				one.at = {...one.at, ...result.adoptAt};
				current = result.next;
			}
		}

		return current;
	};

	test('two phones that change different settings offline keep both', () => {
		const a = phone({theme: 'dark'}, {theme: 100});
		const b = phone({swipeLeft: 'move'}, {swipeLeft: 200});
		const library = settleAll([a, b], {});
		assert.equal(a.prefs.theme, 'dark');
		assert.equal(a.prefs.swipeLeft, 'move');
		assert.equal(b.prefs.theme, 'dark');
		assert.equal(b.prefs.swipeLeft, 'move');
		assert.equal(library.theme, 'dark');
		assert.equal(library.swipeLeft, 'move');
	});

	test('when both change one setting, the later change wins on both phones', () => {
		const a = phone({theme: 'dark'}, {theme: 100});
		const b = phone({theme: 'light'}, {theme: 200});
		settleAll([a, b], {});
		assert.equal(a.prefs.theme, 'light');
		assert.equal(b.prefs.theme, 'light');
		// Whichever phone reaches the library first gives the same answer.
		const c = phone({theme: 'dark'}, {theme: 100});
		const d = phone({theme: 'light'}, {theme: 200});
		settleAll([d, c], {});
		assert.equal(c.prefs.theme, 'light');
	});

	test("a phone that never changed a setting takes the library's", () => {
		const fresh = phone({}, {});
		settleAll([fresh], {theme: 'dark', [`${AT_PREFIX}theme`]: 50});
		assert.equal(fresh.prefs.theme, 'dark');
		assert.equal(fresh.at.theme, 50);
	});

	test('a library from before the times were kept still reaches a phone', () => {
		const fresh = phone({}, {});
		settleAll([fresh], {look: 'ios', swipeLeft: 'delete'});
		assert.equal(fresh.prefs.look, 'ios');
		assert.equal(fresh.prefs.swipeLeft, 'delete');
	});

	test('defaults that were never changed are not sent, and unknown keys stay', () => {
		const result = settlePreferences({fromNewerApp: 'x'}, defaults, {});
		assert.deepEqual(result.next, {fromNewerApp: 'x'});
		const kept = settleAll([phone({theme: 'dark'}, {theme: 5})], {
			fromNewerApp: 'x',
		});
		assert.equal(kept.fromNewerApp, 'x');
		assert.equal(kept.theme, 'dark');
	});

	test('settled phones leave the library alone', () => {
		const a = phone({theme: 'dark'}, {theme: 100});
		const library = settleAll([a], {});
		const again = settlePreferences(library, a.prefs, a.at);
		assert.equal(again.next, library);
		assert.deepEqual(again.adopt, {});
	});
});
