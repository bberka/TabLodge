import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {chooseStart, readLastUsed} from '../src/library/start-choice';
import {
	defaults,
	parsePreferences,
	STARTUP_TABS,
} from '../src/settings/preference-schema';

const remembered = {tab: 'sessions', columnId: 'col-work'} as const;

describe('startup tab', () => {
	test('defaults to Bookmarks, so a new install opens where it always did', () => {
		assert.equal(defaults.startupTab, 'bookmarks');
		assert.deepEqual(chooseStart(defaults.startupTab, {}), {tab: 'bookmarks'});
	});

	test('a fixed choice ignores what was used last', () => {
		assert.deepEqual(chooseStart('bookmarks', remembered), {tab: 'bookmarks'});
		assert.deepEqual(
			chooseStart('sessions', {tab: 'bookmarks', columnId: 'x'}),
			{
				tab: 'sessions',
			},
		);
	});

	test('Last used returns to the tab the app was left on', () => {
		assert.deepEqual(chooseStart('last', {tab: 'sessions'}), {tab: 'sessions'});
		assert.deepEqual(chooseStart('last', {tab: 'sessions', columnId: 'x'}), {
			tab: 'sessions',
		});
	});

	test('Last used on Bookmarks reopens the last column', () => {
		assert.deepEqual(
			chooseStart('last', {tab: 'bookmarks', columnId: 'col-work'}),
			{tab: 'bookmarks', columnId: 'col-work'},
		);
	});

	test('Last used with nothing remembered falls back to Bookmarks', () => {
		assert.deepEqual(chooseStart('last', {}), {tab: 'bookmarks'});
		assert.deepEqual(chooseStart('last', {columnId: 'col-work'}), {
			tab: 'bookmarks',
			columnId: 'col-work',
		});
	});

	test('a stored startup value the schema does not know falls back to Bookmarks', () => {
		assert.equal(
			parsePreferences({startupTab: 'settings'}).startupTab,
			'bookmarks',
		);
		assert.equal(parsePreferences({startupTab: 'last'}).startupTab, 'last');
		assert.deepEqual([...STARTUP_TABS], ['bookmarks', 'sessions', 'last']);
	});

	test('the remembered tab and column read back only when they are valid', () => {
		assert.deepEqual(readLastUsed(undefined), {});
		assert.deepEqual(readLastUsed('sessions'), {});
		assert.deepEqual(readLastUsed({tab: 'settings', columnId: ''}), {});
		assert.deepEqual(readLastUsed({tab: 'sessions', columnId: 7}), {
			tab: 'sessions',
		});
		assert.deepEqual(readLastUsed({tab: 'bookmarks', columnId: 'col-work'}), {
			tab: 'bookmarks',
			columnId: 'col-work',
		});
	});
});
