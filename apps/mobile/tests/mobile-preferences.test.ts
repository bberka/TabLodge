import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	MOBILE_APP_KEYS_MAX,
	normalizeMobileApp,
} from '../../extension/src/shared/library-normalize';
import {ANDROID_PREFERENCES} from '../../extension/src/shared/setting-scopes';
import {
	AT_PREFIX,
	settlePreferences,
	type ChangedAt,
	type MobileApp,
} from '../src/settings/preference-merge';
import {
	defaults,
	legacySiteIconsOf,
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
	savePreview: false,
	accent: '#336699',
	theme: 'dark',
	compactSessions: true,
	showSavedOn: false,
};

describe('preference schema', () => {
	test('a preference reaches another phone unless it is scoped to this device', () => {
		const chosen = {...defaults, ...changed};
		const arrived = readSyncedPreferences(
			normalizeMobileApp(syncedPreferences(chosen)),
		);
		for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
			const device = ANDROID_PREFERENCES[key][0] === 'device';
			assert.equal(
				Object.hasOwn(arrived, key),
				!device,
				device
					? `The preference "${key}" is scoped to this device but reaches another phone.`
					: `The preference "${key}" does not reach the other phones. Every preference syncs unless setting-scopes.ts scopes it to the device with a reason.`,
			);
		}
	});

	test("a synced key is never lost to the extension's limit", () => {
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
		assert.deepEqual(readSyncedPreferences(raw), {
			swipeRight: 'open',
			theme: 'light',
		});
		const loaded = parsePreferences(raw);
		assert.equal(loaded.openApp, 'org.example');
		assert.equal(loaded.glassEffect, false);
		assert.equal('openApp' in syncedPreferences(loaded), false);
		assert.equal('glassEffect' in syncedPreferences(loaded), false);
	});

	test('the glass effect is this phone only, so no other phone sets it', () => {
		assert.equal(ANDROID_PREFERENCES.glassEffect[0], 'device');
		assert.equal(SYNCED_KEYS.includes('glassEffect'), false);
		const written = settlePreferences(
			{},
			{...defaults, glassEffect: false},
			{glassEffect: 500},
		);
		assert.deepEqual(written.next, {});
	});

	test('the Icons only bar still reads', () => {
		const bar = parsePreferences({barSize: 'icons'});
		assert.equal(bar.barSize, 'full');
		assert.equal(bar.barLabels, 'never');
	});

	test('the bottom bar names every tab until the setting says otherwise', () => {
		assert.equal(defaults.barLabels, 'always');
	});

	test('an old site icon choice that asked nobody carries over as the shared Letter tiles only', () => {
		assert.equal(legacySiteIconsOf('off'), 'browser');
		assert.equal(legacySiteIconsOf('direct'), 'browser');
		assert.equal(legacySiteIconsOf(true), 'browser');
		assert.equal(legacySiteIconsOf('server'), undefined);
		assert.equal(legacySiteIconsOf(false), undefined);
		assert.equal(legacySiteIconsOf(undefined), undefined);
		assert.equal('siteIcons' in parsePreferences({siteIcons: 'off'}), false);
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
		const result = settlePreferences(
			undefined,
			{...defaults, swipeRight: 'move'},
			{swipeRight: 7},
		);
		assert.equal(result.next.swipeRight, 'move');
		assert.equal(result.next[AT_PREFIX + 'swipeRight'], 7);
	});

	test('a phone keeps the glass effect it had when the setting became this-phone only', () => {
		const phoneOff = phone({glassEffect: false}, {});
		const beforeChange = {glassEffect: true, [`${AT_PREFIX}glassEffect`]: 300};
		const library = settleAll([phoneOff], beforeChange);
		assert.equal(phoneOff.prefs.glassEffect, false);
		assert.deepEqual(library, beforeChange);
	});

	test("a new phone does not take another phone's glass effect from the library", () => {
		const fresh = phone({}, {});
		settleAll([fresh], {glassEffect: false, [`${AT_PREFIX}glassEffect`]: 300});
		assert.equal(fresh.prefs.glassEffect, defaults.glassEffect);
		assert.equal(fresh.at.glassEffect, undefined);
	});

	test('settled phones leave the library alone', () => {
		const a = phone({swipeRight: 'move'}, {swipeRight: 100});
		const library = settleAll([a], {});
		const again = settlePreferences(library, a.prefs, a.at);
		assert.equal(again.next, library);
		assert.deepEqual(again.adopt, {});
	});
});
