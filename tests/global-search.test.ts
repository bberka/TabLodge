import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	buildFinderIndex,
	flattenSections,
	looksLikeUrl,
	searchFinder,
	type FinderSources,
} from '../src/app/global-search';
import type {Bookmark, BookmarkColumn, Folder, Session} from '../src/app/types';

const column = (id: string, name: string): BookmarkColumn => ({
	id,
	name,
	createdAt: 0,
	isDefault: false,
});
const bookmark = (
	id: string,
	title: string,
	url: string,
	columnId: string,
): Bookmark => ({
	id,
	title,
	url,
	columnId,
	createdAt: 0,
	updatedAt: 0,
});
const session: Session = {
	id: 's1',
	name: 'Holiday planning',
	folderId: 'f1',
	description: 'Flights and hotels\n\nremember passports',
	createdAt: 0,
	updatedAt: 0,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: [
		{id: 't1', title: 'Skyscanner flights', url: 'https://www.skyscanner.net/'},
		{id: 't2', title: 'Hotel deals', url: 'https://hotels.example/deals'},
	],
} as unknown as Session;
const folder: Folder = {
	id: 'f1',
	name: 'Travel',
	createdAt: 0,
	isDefault: false,
};

const sources: FinderSources = {
	groups: [session],
	folders: [folder],
	columns: [column('c1', 'Reading'), column('c2', 'Dev tools')],
	bookmarks: [
		bookmark('b1', 'GitHub', 'https://github.com/', 'c2'),
		bookmark('b2', 'Hacker News', 'https://news.ycombinator.com/', 'c1'),
	],
	tabs: [
		{
			id: 7,
			windowId: 2,
			title: 'Inbox - Mail',
			url: 'https://mail.example.com/inbox',
		},
	],
	commands: [
		{id: 'open-settings', title: 'Open Settings', keywords: ['preferences']},
		{id: 'new-column', title: 'New column'},
	],
};
const index = buildFinderIndex(sources);
const kinds = (query: string) =>
	searchFinder(query, index).map((section) => section.kind);
const ids = (query: string) =>
	flattenSections(searchFinder(query, index)).map((item) => item.id);

test('results are grouped by type and always end with a web search', () => {
	const sections = searchFinder('github', index);
	assert.equal(sections[0].kind, 'bookmark');
	assert.equal(sections.at(-1)?.kind, 'web');
	assert.equal(sections.at(-1)?.items[0].ref, 'github');
	assert.deepEqual(kinds('zzzzqqq'), ['web']);
	assert.equal(
		searchFinder('zzzzqqq', index)[0].items[0].title,
		'Search the web for “zzzzqqq”',
	);
});

test('bookmarks match by title, address and column name', () => {
	assert.ok(ids('github').includes('bookmark:b1'));
	assert.ok(ids('ycombinator').includes('bookmark:b2'));
	assert.ok(ids('dev tools').includes('bookmark:b1'));
	assert.ok(!ids('dev tools').includes('bookmark:b2'));
});

test('saved tabs match by session name and notes; sessions by description', () => {
	assert.ok(ids('holiday').includes('saved-tab:s1:t2'));
	assert.ok(ids('passports').includes('session:s1'));
	assert.ok(ids('hotels').includes('session:s1'));
	assert.ok(ids('skyscaner').includes('saved-tab:s1:t1'), 'typos still match');
});

test('open tabs, columns, folders and commands are found', () => {
	assert.deepEqual(ids('inbox').slice(0, 1), ['tab:7']);
	assert.ok(ids('reading').includes('column:c1'));
	assert.ok(ids('travel').includes('folder:f1'));
	assert.ok(ids('preferences').includes('command:open-settings'));
	assert.equal(ids('new col')[0], 'command:new-column');
});

test('the group holding the best match comes first, and a better title ranks first within a group', () => {
	assert.equal(kinds('open settings')[0], 'command');
	const near = buildFinderIndex({
		...sources,
		bookmarks: [
			bookmark('x1', 'Release notes for apps', 'https://x.example/', 'c1'),
			bookmark('x2', 'Notes', 'https://y.example/', 'c1'),
		],
	});
	const hit = flattenSections(searchFinder('notes', near)).find(
		(item) => item.kind === 'bookmark',
	);
	assert.equal(hit?.id, 'bookmark:x2');
});

test('a blank query lists commands and open tabs only', () => {
	assert.deepEqual(kinds(''), ['tab', 'command']);
});

test('typed addresses offer "Go to" first', () => {
	const sections = searchFinder('example.org/docs', index);
	assert.equal(sections[0].kind, 'url');
	assert.equal(sections[0].items[0].url, 'https://example.org/docs');
	assert.equal(sections.at(-1)?.kind, 'web');
	assert.notEqual(kinds('github')[0], 'url');
});

test('looksLikeUrl accepts addresses and rejects ordinary searches', () => {
	assert.equal(looksLikeUrl('github.com'), 'https://github.com');
	assert.equal(looksLikeUrl('https://a.test/x?y=1'), 'https://a.test/x?y=1');
	assert.equal(looksLikeUrl('localhost:3000'), 'http://localhost:3000');
	assert.equal(looksLikeUrl('192.168.0.1/admin'), 'http://192.168.0.1/admin');
	for (const text of [
		'hello world',
		'github',
		'what is example.com',
		'file.txt1',
		'',
		'chrome://settings',
		'ftp://x.test',
	]) {
		assert.equal(looksLikeUrl(text), undefined, text);
	}
});

test('real matches outrank typo matches, within and across groups', () => {
	const typoIndex = buildFinderIndex({
		...sources,
		bookmarks: [
			bookmark('t1', 'Hide and seek', 'https://a.example/', 'c1'),
			bookmark('t2', 'The inside story', 'https://b.example/', 'c1'),
			bookmark('t3', 'Sidebar tips', 'https://c.example/', 'c1'),
		],
		tabs: [],
		commands: [],
	});
	const found = flattenSections(searchFinder('side', typoIndex))
		.filter((item) => item.kind === 'bookmark')
		.map((item) => item.id);
	assert.deepEqual(found, ['bookmark:t3', 'bookmark:t2', 'bookmark:t1']);
});
