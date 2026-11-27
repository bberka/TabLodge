import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {DEFAULTS} from '../src/library/links';
import {
	isChanged,
	resetLabel,
	type SettingValues,
} from '../src/screens/settings/row-defaults';
import {ROWS} from '../src/screens/settings/settings-index';
import type {Preferences} from '../src/settings/preferences';

const prefs = {
	barLabels: 'always',
	privateLockMinutes: 5,
	openApp: '',
	showSavedOn: true,
	floatingBar: true,
} as unknown as Preferences;
const defaults: SettingValues = {prefs, synced: DEFAULTS};
const change = (
	values: Partial<Preferences>,
	synced = DEFAULTS,
): SettingValues => ({prefs: {...prefs, ...values}, synced});

describe('row defaults', () => {
	test('a row at its default is not changed', () => {
		assert.equal(isChanged(ROWS.barLabels, defaults, defaults), false);
		assert.equal(isChanged(ROWS.showAll, defaults, defaults), false);
	});

	test('a row away from its default is changed', () => {
		assert.equal(
			isChanged(ROWS.barLabels, change({barLabels: 'active'}), defaults),
			true,
		);
		assert.equal(
			isChanged(ROWS.floatingBar, change({floatingBar: false}), defaults),
			true,
		);
	});

	test('an extension setting is compared in the library', () => {
		const synced = {...DEFAULTS, showAllBookmarks: !DEFAULTS.showAllBookmarks};
		assert.equal(isChanged(ROWS.showAll, change({}, synced), defaults), true);
		assert.equal(
			isChanged(ROWS.barLabels, change({}, synced), defaults),
			false,
		);
		assert.equal(
			isChanged(
				ROWS.newBookmarkPosition,
				change({}, {...DEFAULTS, newBookmarkPosition: 'top'}),
				defaults,
			),
			true,
		);
		assert.equal(
			resetLabel(ROWS.newBookmarkPosition, defaults, [
				{id: 'bottom', name: 'Bottom'},
				{id: 'top', name: 'Top'},
			]),
			'Reset to Bottom',
		);
	});

	test('a row that cannot be reset is never changed', () => {
		assert.equal(isChanged(ROWS.syncSettings, change({}), defaults), false);
	});

	test('the drawer names the default from the row choices', () => {
		const choices = [
			{id: 'active', name: 'Open tab only'},
			{id: 'always', name: 'All tabs'},
		];
		assert.equal(
			resetLabel(ROWS.barLabels, defaults, choices),
			'Reset to All tabs',
		);
	});

	test('a number default matches the choice with the same digits', () => {
		const choices = [{id: '5', name: '5 minutes'}];
		assert.equal(
			resetLabel(ROWS.privateLockMinutes, defaults, choices),
			'Reset to 5 minutes',
		);
	});

	test('a switch says On or Off, also when it is stored as something else', () => {
		assert.equal(resetLabel(ROWS.showSavedOn, defaults), 'Reset to On');
		const comfortable = {
			...defaults,
			synced: {...DEFAULTS, bookmarkDensity: 'comfortable' as const},
		};
		assert.equal(resetLabel(ROWS.spacing, comfortable), 'Reset to Off');
	});

	test('falls back to "default" when no choice carries the default', () => {
		assert.equal(resetLabel(ROWS.openApp, defaults, []), 'Reset to default');
		assert.equal(resetLabel(ROWS.barLabels, defaults), 'Reset to default');
	});
});
