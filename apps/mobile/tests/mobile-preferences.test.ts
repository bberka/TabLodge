import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	MOBILE_APP_KEYS_MAX,
	normalizeMobileApp,
} from '../../extension/src/shared/library-normalize';
import {ANDROID_LOCAL_PREFERENCES} from '../../extension/src/shared/local-settings';
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
	bookmarkView: 'list',
	sessionView: 'list',
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
	// The guard that keeps every preference syncing (#397): one stays on the phone only when the shared
	// local-settings.ts lists it with a reason, which docs/PRIVACY.md repeats (extension/tests/local-settings.test.ts).
	test('every preference syncs between phones, unless it is listed as local with a reason', () => {
		// Through the library as the extension keeps it, which drops a value it cannot hold.
		const arrived = readSyncedPreferences(
			normalizeMobileApp(syncedPreferences(defaults)),
		);
		for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
			assert.ok(
				Object.hasOwn(arrived, key) ||
					Object.hasOwn(ANDROID_LOCAL_PREFERENCES, key),
				`The preference "${key}" does not reach the other phones and is not listed in ANDROID_LOCAL_PREFERENCES in local-settings.ts. Every preference syncs unless that list gives the reason it stays on the phone.`,
			);
		}

		for (const key of Object.keys(ANDROID_LOCAL_PREFERENCES)) {
			assert.ok(
				Object.hasOwn(defaults, key),
				`"${key}" is listed as a local preference but the app has no such preference.`,
			);
		}
	});

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
			tapAction: 'retro',
			swipeRight: 'move',
			swipeLeft: 7,
			sessionMain: 'none',
		};
		assert.deepEqual(readSyncedPreferences(bad), {swipeRight: 'move'});
		const loaded = parsePreferences(bad);
		assert.equal(loaded.tapAction, defaults.tapAction);
		assert.equal(loaded.swipeLeft, defaults.swipeLeft);
		assert.equal(loaded.sessionMain, defaults.sessionMain);
		assert.equal(loaded.swipeRight, 'move');
	});

	test('sync carries only what is synced, and loading takes the rest from storage', () => {
		const raw = {
			swipeRight: 'open',
			theme: 'light',
			glassEffect: false,
			openApp: 'org.example',
		};
		assert.deepEqual(readSyncedPreferences(raw), {swipeRight: 'open'});
		const loaded = parsePreferences(raw);
		assert.equal(loaded.theme, 'light');
		assert.equal(loaded.glassEffect, false);
		assert.equal(loaded.openApp, 'org.example');
		assert.equal('glassEffect' in syncedPreferences(loaded), false);
	});

	test('the Icons only bar and the old site icon switch still read', () => {
		const bar = parsePreferences({barSize: 'icons'});
		assert.equal(bar.barSize, 'full');
		assert.equal(bar.barLabels, 'never');
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
		const a = phone({swipeRight: 'move'}, {swipeRight: 100});
		const b = phone({swipeLeft: 'move'}, {swipeLeft: 200});
		const library = settleAll([a, b], {});
		assert.equal(a.prefs.swipeRight, 'move');
		assert.equal(a.prefs.swipeLeft, 'move');
		assert.equal(b.prefs.swipeRight, 'move');
		assert.equal(b.prefs.swipeLeft, 'move');
		assert.equal(library.swipeRight, 'move');
		assert.equal(library.swipeLeft, 'move');
	});

	test('when both change one setting, the later change wins on both phones', () => {
		const a = phone({swipeRight: 'move'}, {swipeRight: 100});
		const b = phone({swipeRight: 'open'}, {swipeRight: 200});
		settleAll([a, b], {});
		assert.equal(a.prefs.swipeRight, 'open');
		assert.equal(b.prefs.swipeRight, 'open');
		// Whichever phone reaches the library first gives the same answer.
		const c = phone({swipeRight: 'move'}, {swipeRight: 100});
		const d = phone({swipeRight: 'open'}, {swipeRight: 200});
		settleAll([d, c], {});
		assert.equal(c.prefs.swipeRight, 'open');
	});

	test("a phone that never changed a setting takes the library's", () => {
		const fresh = phone({}, {});
		settleAll([fresh], {swipeRight: 'move', [`${AT_PREFIX}swipeRight`]: 50});
		assert.equal(fresh.prefs.swipeRight, 'move');
		assert.equal(fresh.at.swipeRight, 50);
	});

	test('a library from before the times were kept still reaches a phone', () => {
		const fresh = phone({}, {});
		settleAll([fresh], {tapAction: 'edit', swipeLeft: 'delete'});
		assert.equal(fresh.prefs.tapAction, 'edit');
		assert.equal(fresh.prefs.swipeLeft, 'delete');
	});

	test('defaults that were never changed are not sent, and unknown keys stay', () => {
		const result = settlePreferences({fromNewerApp: 'x'}, defaults, {});
		assert.deepEqual(result.next, {fromNewerApp: 'x'});
		const kept = settleAll([phone({swipeRight: 'move'}, {swipeRight: 5})], {
			fromNewerApp: 'x',
		});
		assert.equal(kept.fromNewerApp, 'x');
		assert.equal(kept.swipeRight, 'move');
	});

	test('a library that has no mobileApp setting yet takes a change', () => {
		// A fresh install's empty library has `settings: {}` until the first sync brings the record.
		const result = settlePreferences(
			undefined,
			{...defaults, swipeRight: 'move'},
			{swipeRight: 7},
		);
		assert.equal(result.next.swipeRight, 'move');
		assert.equal(result.next[AT_PREFIX + 'swipeRight'], 7);
	});

	test('settled phones leave the library alone', () => {
		const a = phone({swipeRight: 'move'}, {swipeRight: 100});
		const library = settleAll([a], {});
		const again = settlePreferences(library, a.prefs, a.at);
		assert.equal(again.next, library);
		assert.deepEqual(again.adopt, {});
	});
});
