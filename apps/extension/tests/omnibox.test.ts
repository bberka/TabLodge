import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {
	OMNIBOX_KEYWORD,
	findOmniboxItem,
	omniboxIndex,
	omniboxSuggestions,
	type OmniboxSources,
} from '../src/app/omnibox';
import type {Bookmark, BookmarkColumn, Session} from '../src/shared/types';

const column: BookmarkColumn = {
	id: 'c1',
	name: 'Dev tools',
	createdAt: 0,
	isDefault: false,
};
const bookmark = (id: string, title: string, url: string): Bookmark => ({
	id,
	title,
	url,
	columnId: 'c1',
	createdAt: 0,
	updatedAt: 0,
});
const session = {
	id: 's1',
	name: 'Holiday planning',
	folderId: 'f1',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: [
		{id: 't1', title: 'Skyscanner flights', url: 'https://www.skyscanner.net/'},
	],
} as unknown as Session;

const sources: OmniboxSources = {
	groups: [session],
	folders: [],
	columns: [column],
	bookmarks: [
		bookmark('b1', 'GitHub', 'https://github.com/'),
		bookmark('b2', 'Tom & Jerry <fan> page', 'https://tom.example/'),
	],
	tabs: [
		{id: 7, windowId: 2, title: 'GitHub issues', url: 'https://github.com/x'},
	],
};
const index = omniboxIndex(sources);

test('the keyword in the manifest is the one the code documents', () => {
	const manifest = JSON.parse(
		readFileSync(
			join(import.meta.dirname, '..', 'shell', 'manifest.json'),
			'utf8',
		),
	) as {omnibox?: {keyword?: string}; permissions: string[]};
	assert.equal(manifest.omnibox?.keyword, OMNIBOX_KEYWORD);
});

test('suggests open tabs, bookmarks, saved tabs and sessions for a query', () => {
	const contents = new Set(
		omniboxSuggestions('github', index).map((suggestion) => suggestion.content),
	);
	assert.ok(contents.has('tab:7'));
	assert.ok(contents.has('bookmark:b1'));
	assert.deepEqual(
		omniboxSuggestions('skyscanner', index).map((s) => s.content),
		['saved-tab:s1:t1'],
	);
	assert.equal(
		omniboxSuggestions('holiday', index).map((s) => s.content)[0],
		'session:s1',
	);
});

test('does not suggest web search, typed addresses, columns or folders', () => {
	const contents = omniboxSuggestions('dev tools', index).map((s) => s.content);
	assert.ok(contents.every((content) => !content.startsWith('column:')));
	assert.deepEqual(
		omniboxSuggestions('github.com', index).filter(
			(s) => s.content === 'web' || s.content.startsWith('url:'),
		),
		[],
	);
	assert.deepEqual(omniboxSuggestions('zzzzqqq', index), []);
});

test('lists recent sessions and open tabs when nothing is typed yet', () => {
	assert.deepEqual(
		omniboxSuggestions('', index).map((s) => s.content),
		['session:s1', 'tab:7'],
	);
});

test('escapes titles for the XML description and marks the match', () => {
	const [suggestion] = omniboxSuggestions('jerry', index);
	assert.equal(suggestion.content, 'bookmark:b2');
	assert.ok(
		suggestion.description.includes(
			'Tom &amp; <match>Jerry</match> &lt;fan&gt; page',
		),
	);
	assert.doesNotMatch(suggestion.description, /<fan>/);
});

test('keeps the list short and balanced between kinds', () => {
	const many = omniboxIndex({
		...sources,
		bookmarks: Array.from({length: 20}, (_, number) =>
			bookmark(`n${number}`, `note ${number}`, `https://n${number}.example/`),
		),
		tabs: [],
		groups: [{...session, name: 'note session'}],
	});
	const contents = omniboxSuggestions('note', many).map((s) => s.content);
	assert.ok(contents.length <= 8);
	assert.ok(contents.includes('session:s1'));
	assert.ok(contents.filter((c) => c.startsWith('bookmark:')).length <= 4);
});

test('resolves a chosen suggestion, and treats anything else as a query', () => {
	assert.equal(
		findOmniboxItem('bookmark:b1', index)?.url,
		'https://github.com/',
	);
	assert.equal(findOmniboxItem('tab:7', index)?.windowId, 2);
	assert.equal(findOmniboxItem('column:c1', index), undefined);
	assert.equal(findOmniboxItem('github', index), undefined);
});
