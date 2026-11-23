import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {defaults} from '../src/settings/preference-schema';
import {RESETS} from '../src/screens/settings/row-defaults';
import {
	headHit,
	matchCount,
	normalizeQuery,
	ROWS,
	rowHit,
	type Row,
	SECTIONS,
	sectionVisible,
} from '../src/screens/settings/settings-index';

const visible = (query: string) =>
	Object.values(SECTIONS)
		.filter((section) => sectionVisible(section, normalizeQuery(query)))
		.map((section) => section.title);

describe('settings search', () => {
	test('shows every card for an empty search', () => {
		assert.equal(visible('  ').length, Object.keys(SECTIONS).length);
	});

	test('finds a card by its name, ignoring case and spaces around the word', () => {
		assert.deepEqual(visible(' APPEARANCE '), ['Appearance']);
		assert.deepEqual(visible(' PRIVATE '), [
			'Open links',
			'Private library',
			'Sync',
		]);
	});

	test('finds a card through one of its settings, by label or by hint', () => {
		assert.deepEqual(visible('utm_source'), ['Links and titles']);
		assert.ok(visible('swipe').includes('Bookmarks'));
		assert.deepEqual(visible('counters'), ['Links and titles']);
	});

	test('finds a card by an alias', () => {
		assert.ok(visible('token').includes('Sync'));
		assert.ok(visible('theme').includes('Appearance'));
	});

	test('shows nothing for a word no setting uses', () => {
		assert.deepEqual(visible('zzzz'), []);
		assert.equal(matchCount('zzzz'), 0);
	});

	test('counts the rows a search shows, and all rows of a card found by its name', () => {
		assert.equal(matchCount('utm_source'), 1);
		assert.equal(matchCount('appearance'), SECTIONS.appearance.rows.length);
	});

	test('a row is found by its own text, and a card name matches without its rows', () => {
		assert.equal(rowHit(ROWS.removeTracking, 'utm'), true);
		assert.equal(rowHit(ROWS.tap, 'utm'), false);
		assert.equal(headHit(SECTIONS.bookmarks, 'bookmarks'), true);
		assert.equal(headHit(SECTIONS.bookmarks, 'utm'), false);
	});

	test('every row of a card is findable by its label', () => {
		for (const section of Object.values(SECTIONS)) {
			for (const row of section.rows) {
				assert.equal(
					sectionVisible(section, normalizeQuery(row.label)),
					true,
					row.label,
				);
			}
		}
	});

	test('every row belongs to a card, so a search can reach it', () => {
		const listed = new Set<object>(
			Object.values(SECTIONS).flatMap((section) => section.rows),
		);
		for (const [name, row] of Object.entries(ROWS)) {
			assert.equal(listed.has(row), true, `${name} is in no card`);
		}
	});

	test('every preference has a row, or says why it has none', () => {
		const withRow = new Set(
			[...RESETS.values()].flatMap((reset) => reset.prefs ?? []),
		);
		const noReset: Record<string, Row> = {
			syncSettings: ROWS.syncSettings,
			syncPrivate: ROWS.syncPrivate,
			backgroundSync: ROWS.backgroundSync,
			deviceName: ROWS.deviceName,
		};
		const noRow = {
			lastColumnId: 'remembers the last column used; not a setting',
		};
		for (const key of Object.keys(defaults)) {
			assert.equal(
				withRow.has(key as never) ||
					Object.hasOwn(noReset, key) ||
					Object.hasOwn(noRow, key),
				true,
				`${key} has no settings row (add one to settings-index.ts and row-defaults.ts, or list it here with a reason)`,
			);
		}
	});
});
