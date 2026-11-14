import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	headHit,
	normalizeQuery,
	ROWS,
	rowHit,
	SECTIONS,
	sectionVisible,
} from '../mobile/src/screens/settings-index';

const visible = (query: string) =>
	Object.values(SECTIONS)
		.filter((section) => sectionVisible(section, normalizeQuery(query)))
		.map((section) => section.title);

describe('settings search', () => {
	test('shows every card for an empty search', () => {
		assert.equal(visible('  ').length, Object.keys(SECTIONS).length);
	});

	test('finds a card by its name, ignoring case and spaces around the word', () => {
		assert.deepEqual(visible(' PRIVATE '), ['Private library']);
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
	});

	test('a row is found by its own text, and a card name matches without its rows', () => {
		assert.equal(rowHit(ROWS.cleanOnSave, 'utm'), true);
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
});
