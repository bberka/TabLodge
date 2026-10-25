import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {rankByQuery, sortByQuery} from '../src/app/fuzzy';

// Rows as Settings searches them: label, help, then option labels.
type Row = [label: string, help: string, ...options: string[]];
const rows: Row[] = [
	[
		'Show sessions at the top',
		'Put the sessions section above the bookmark board.',
	],
	['Hide addresses', 'Show only page titles in lists.'],
	[
		'Toolbar button action',
		'The default is a compact popup.',
		'Popup',
		'Open Dashboard',
	],
	[
		'Toolbar icon opens',
		'Choose whether the toolbar icon opens the quick popup or the TabLodge side panel.',
		'Popup',
		'Side panel',
	],
	['Keep sessions expanded by default', 'Show every session’s saved tabs.'],
	[
		'Open links',
		'Choose what happens when you click a link inside a saved session.',
	],
	['Right-click menus', 'Choose which menus appear.'],
	['Back up', 'Save bookmarks or sessions to a file.', 'backup', 'export'],
	['Hide tab titles', 'Show icons only.'],
];

const labels = (query: string) =>
	rankByQuery(query, rows, (row) => row).map((row) => row[0]);

test('"side" lists real side matches before any typo match', () => {
	const result = labels('side');
	assert.equal(result[0], 'Toolbar icon opens', 'help text "side panel" word');
	const firstHide = result.findIndex((label) => label.startsWith('Hide'));
	const lastReal = result.findLastIndex((label) => !label.startsWith('Hide'));
	assert.ok(firstHide > lastReal, result.join(' | '));
	assert.ok(result.includes('Open links'), 'inside "inside"');
});

test('"hide" puts the hide rows first', () => {
	assert.deepEqual(labels('hide').slice(0, 2), [
		'Hide addresses',
		'Hide tab titles',
	]);
});

test('abbreviations, typos and hyphenated words', () => {
	assert.equal(labels('kse')[0], 'Keep sessions expanded by default');
	assert.equal(labels('bakup')[0], 'Back up');
	assert.equal(labels('right click')[0], 'Right-click menus');
});

test('ranking is stable and sortByQuery keeps non-matching rows last', () => {
	const same = ['Tab aa', 'Tab bb', 'Tab cc'];
	assert.deepEqual(
		sortByQuery('tab', same, (item) => [item]),
		same,
	);
	assert.deepEqual(
		sortByQuery('b', ['Zeta', 'Bee', 'Alpha'], (item) => [item]),
		['Bee', 'Zeta', 'Alpha'],
	);
});
