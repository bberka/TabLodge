import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import type {
	Bookmark,
	SavedTab,
	Session,
} from '../../extension/src/shared/types';
import {emptyStore} from '../src/library/store-shape';
import {
	addToTrash,
	describeEntry,
	filterTrash,
	parseTrash,
	purgeExpired,
	removeFromTrash,
	restoreEntry,
	type NewTrash,
	type TrashEntry,
} from '../src/library/trash';

const DAY = 86_400_000;
const NOW = 100 * DAY;

const tab = (id: string): SavedTab => ({
	id,
	title: id,
	url: `https://example.com/${id}`,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 1,
	originalIndex: 0,
});

const session = (id: string, folderId = 'f1', tabs = ['a', 'b']): Session => ({
	id,
	name: `Session ${id}`,
	folderId,
	description: '',
	createdAt: 1,
	updatedAt: 1,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: tabs.map((entry) => tab(entry)),
});

const bookmark = (id: string, columnId: string): Bookmark => ({
	id,
	title: id,
	url: `https://example.com/${id}`,
	columnId,
	createdAt: 1,
	updatedAt: 1,
});

const folder = (id: string) => ({
	id,
	name: `Folder ${id}`,
	createdAt: 1,
	isDefault: false,
});
const column = (id: string) => ({
	id,
	name: `Column ${id}`,
	createdAt: 1,
	isDefault: false,
});

const ids = (count: number) => Array.from({length: count}, (_, i) => `t${i}`);
let counter = 0;
const nextId = () => `new${++counter}`;

const stored = (id: string, deletedAt: number): TrashEntry =>
	addToTrash([], [{kind: 'session', session: session(id)}], [id], deletedAt)[0];

describe('trash list', () => {
	test('new entries go first and get an id and a time', () => {
		const first = addToTrash(
			[],
			[{kind: 'session', session: session('s1')}],
			ids(1),
			NOW,
		);
		const both = addToTrash(
			first,
			[{kind: 'bookmark', bookmark: bookmark('b1', 'c1'), after: null}],
			['t9'],
			NOW + 1,
		);
		assert.deepEqual(
			both.map((entry) => [entry.id, entry.deletedAt]),
			[
				['t9', NOW + 1],
				['t0', NOW],
			],
		);
	});

	test('what outlived the retention is purged, the rest stays', () => {
		const items = [
			{id: 'old', deletedAt: NOW - 8 * DAY},
			{id: 'new', deletedAt: NOW - 6 * DAY},
		].map((entry) => stored(entry.id, entry.deletedAt));
		assert.deepEqual(
			purgeExpired(items, 7, NOW).map((entry) => entry.id),
			['new'],
		);
		assert.equal(purgeExpired(items, 90, NOW).length, 2);
	});

	test('a missing retention falls back to 30 days', () => {
		const items = [
			{id: 'a', deletedAt: NOW - 29 * DAY},
			{id: 'b', deletedAt: NOW - 31 * DAY},
		].map((entry) => stored(entry.id, entry.deletedAt));
		assert.deepEqual(
			purgeExpired(items, NaN, NOW).map((entry) => entry.id),
			['a'],
		);
	});

	test('removing one entry leaves the others', () => {
		const items = addToTrash(
			[],
			[
				{kind: 'session', session: session('s1')},
				{kind: 'session', session: session('s2')},
			],
			['x', 'y'],
			NOW,
		);
		assert.deepEqual(
			removeFromTrash(items, 'x').map((entry) => entry.id),
			['y'],
		);
	});

	test('stored junk is dropped when reading', () => {
		const good = addToTrash(
			[],
			[{kind: 'session', session: session('s1')}],
			['x'],
			NOW,
		);
		assert.deepEqual(parseTrash([...good, {id: 1}, null, 'text']), good);
		assert.deepEqual(parseTrash('nope'), []);
	});
});

const trashed = (details: NewTrash): TrashEntry =>
	addToTrash([], [details], ['e'], NOW)[0];

const fromExtension = (
	kind: TrashEntry['kind'],
	data: TrashEntry['data'],
): TrashEntry => ({
	id: 'x',
	kind,
	deletedAt: NOW,
	label: 'From the browser',
	origin: '',
	count: 1,
	data,
});

describe('trash in the shape every device shares', () => {
	test('an entry holds what the extension and the server read', () => {
		const [entry] = addToTrash(
			[],
			[{kind: 'session', session: session('s1')}],
			['x'],
			NOW,
		);
		assert.equal(entry.kind, 'session');
		assert.equal(entry.label, 'Session s1');
		assert.equal(entry.count, 2);
		assert.deepEqual(Object.keys(entry.data), ['session', 'index']);
	});

	test('entries saved before the shared shape are still read', () => {
		const earlier = [
			{
				id: 'a',
				deletedAt: NOW,
				kind: 'session',
				session: session('s1'),
			},
			{
				id: 'b',
				deletedAt: NOW,
				kind: 'tab',
				tab: tab('t'),
				index: 2,
				sessionId: 's1',
				sessionName: 'Reading',
				folderId: 'f1',
			},
			{
				id: 'c',
				deletedAt: NOW,
				kind: 'bookmark',
				bookmark: bookmark('m', 'c1'),
				after: 'x',
			},
			{
				id: 'd',
				deletedAt: NOW,
				kind: 'column',
				column: column('c1'),
				bookmarks: [bookmark('m', 'c1')],
			},
			{
				id: 'e',
				deletedAt: NOW,
				kind: 'folder',
				folder: folder('f1'),
				sessionIds: ['s1'],
			},
			{id: 'f', deletedAt: NOW, kind: 'tab'},
		];
		const read = parseTrash(earlier);
		assert.deepEqual(
			read.map((entry) => [entry.id, entry.kind]),
			[
				['a', 'session'],
				['b', 'tabs'],
				['c', 'bookmark'],
				['d', 'column'],
				['e', 'folder'],
			],
		);
		const store = {
			...emptyStore(1),
			folders: [folder('f1')],
			groups: [session('s1', 'f1', ['a', 'c'])],
			bookmarkColumns: [column('c1')],
			bookmarks: [bookmark('x', 'c1')],
		};
		const link = restoreEntry(store, read[1], nextId, NOW);
		assert.deepEqual(
			link.store.groups[0].tabs.map((entry) => entry.id),
			['a', 'c', 't'],
		);
		const placed = restoreEntry(store, read[2], () => 'fresh', NOW);
		assert.deepEqual(
			placed.store.bookmarks.map((entry) => entry.id),
			['x', 'fresh'],
		);
	});

	test('the list never holds more than the extension keeps', () => {
		const items = Array.from({length: 520}, (_, index) =>
			stored(`s${index}`, NOW - index),
		);
		assert.equal(purgeExpired(items, 30, NOW).length, 500);
	});

	test('the filter separates sessions from bookmarks', () => {
		const items = addToTrash(
			[],
			[
				{kind: 'session', session: session('s1')},
				{
					kind: 'tab',
					tab: tab('t'),
					index: 0,
					sessionId: 's1',
					sessionName: 'S',
					folderId: 'f1',
				},
				{kind: 'folder', folder: folder('f1'), sessionIds: []},
				{kind: 'bookmark', bookmark: bookmark('b', 'c1'), after: null},
				{kind: 'column', column: column('c1'), bookmarks: []},
			],
			['a', 'b', 'c', 'd', 'e'],
			NOW,
		);
		const kinds = (filter: Parameters<typeof filterTrash>[1]) =>
			filterTrash(items, filter).map((entry) => entry.kind);
		assert.deepEqual(kinds('sessions'), ['session', 'tabs', 'folder']);
		assert.deepEqual(kinds('bookmarks'), ['bookmark', 'column']);
		assert.equal(kinds('all').length, 5);
	});

	test('a list line names where an entry came from', () => {
		const [one] = parseTrash([
			fromExtension('tabs', {
				groupId: 's1',
				groupName: 'Reading',
				items: [{tab: tab('a'), index: 0}],
			}),
		]);
		assert.deepEqual(describeEntry({...one, origin: 'Reading'}), {
			title: 'From the browser',
			origin: 'Link from Reading',
			links: 0,
		});
		assert.equal(describeEntry({...one, count: 3, origin: 'Reading'}).links, 3);
	});
});

describe('restoring what the extension deleted', () => {
	test('a session with its tabs', () => {
		const store = {...emptyStore(1), folders: [folder('f1')]};
		const result = restoreEntry(
			store,
			fromExtension('session', {session: session('s9', 'f1'), index: 3}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups[0].id, 's9');
		assert.equal(result.store.groups[0].tabs.length, 2);
	});

	test('two links go back to the places they had in their session', () => {
		const store = {
			...emptyStore(1),
			folders: [folder('f1')],
			groups: [session('s1', 'f1', ['b', 'd'])],
		};
		const result = restoreEntry(
			store,
			fromExtension('tabs', {
				groupId: 's1',
				groupName: 'Session s1',
				groupIndex: 0,
				groupMeta: null,
				items: [
					{tab: tab('a'), index: 0},
					{tab: tab('c'), index: 2},
				],
			}),
			nextId,
			NOW,
		);
		assert.deepEqual(
			result.store.groups[0].tabs.map((entry) => entry.id),
			['a', 'b', 'c', 'd'],
		);
	});

	test('a session that disappeared with its last link comes back with its details', () => {
		const store = {...emptyStore(1), folders: [folder('f1')]};
		const result = restoreEntry(
			store,
			fromExtension('tabs', {
				groupId: 'gone',
				groupName: 'Reading list',
				groupIndex: 0,
				groupMeta: {...session('gone', 'f1'), name: 'Reading list', tabs: []},
				items: [{tab: tab('a'), index: 0}],
			}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups[0].id, 'gone');
		assert.equal(result.store.groups[0].name, 'Reading list');
		assert.equal(result.store.groups[0].folderId, 'f1');
	});

	test('a bookmark goes before the one that followed it when nothing came before', () => {
		const store = {
			...emptyStore(1),
			bookmarkColumns: [column('c1')],
			bookmarks: [bookmark('x', 'c1'), bookmark('y', 'c1')],
		};
		const result = restoreEntry(
			store,
			fromExtension('bookmark', {
				bookmark: bookmark('m', 'c1'),
				columnId: 'c1',
				prevId: 'x',
				nextId: 'y',
			}),
			() => 'fresh',
			NOW,
		);
		assert.deepEqual(
			result.store.bookmarks.map((entry) => entry.id),
			['x', 'fresh', 'y'],
		);
	});

	test('a column takes back the links that were moved out when it was deleted', () => {
		const store = {
			...emptyStore(1),
			bookmarkColumns: [column('c2')],
			bookmarks: [bookmark('m', 'c2'), bookmark('n', 'c2')],
		};
		const result = restoreEntry(
			store,
			fromExtension('column', {
				column: column('c1'),
				index: 0,
				bookmarks: [],
				movedIds: ['m'],
				movedTo: 'c2',
			}),
			nextId,
			NOW,
		);
		assert.deepEqual(
			result.store.bookmarks.map((entry) => [entry.id, entry.columnId]),
			[
				['m', 'c1'],
				['n', 'c2'],
			],
		);
	});

	test('a folder takes back its sessions', () => {
		const store = {
			...emptyStore(1),
			folders: [folder('unfiled')],
			groups: [session('s1', 'unfiled')],
		};
		const result = restoreEntry(
			store,
			fromExtension('folder', {
				folder: folder('f1'),
				index: 1,
				groupIds: ['s1'],
			}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups[0].folderId, 'f1');
	});

	test('an entry that is not what it says is refused and changes nothing', () => {
		const store = emptyStore(1);
		for (const kind of [
			'session',
			'tabs',
			'bookmark',
			'column',
			'folder',
		] as const) {
			const result = restoreEntry(
				store,
				fromExtension(kind, {session: 'nope', items: 7, bookmark: {url: 'x'}}),
				nextId,
				NOW,
			);
			assert.equal(result.store, store, kind);
			assert.match(result.error ?? '', /could not be restored/, kind);
		}
	});
});

describe('restoring from the trash', () => {
	test('a session returns to its folder', () => {
		const store = {...emptyStore(1), folders: [folder('f1')]};
		const result = restoreEntry(
			store,
			trashed({kind: 'session', session: session('s1', 'f1')}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups[0].folderId, 'f1');
		assert.equal(result.note, undefined);
	});

	test('a session whose folder is gone goes to the first folder and says so', () => {
		const store = {...emptyStore(1), folders: [folder('f2')]};
		const result = restoreEntry(
			store,
			trashed({kind: 'session', session: session('s1', 'gone')}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups[0].folderId, 'f2');
		assert.match(result.note ?? '', /folder is gone/);
	});

	test('a link goes back to its old place in its session', () => {
		const store = {
			...emptyStore(1),
			folders: [folder('f1')],
			groups: [session('s1', 'f1', ['a', 'c'])],
		};
		const result = restoreEntry(
			store,
			trashed({
				kind: 'tab',
				tab: tab('b'),
				index: 1,
				sessionId: 's1',
				sessionName: 'Session s1',
				folderId: 'f1',
			}),
			nextId,
			NOW,
		);
		assert.deepEqual(
			result.store.groups[0].tabs.map((entry) => entry.id),
			['a', 'b', 'c'],
		);
	});

	test('a link whose session is gone makes a new session', () => {
		const store = {...emptyStore(1), folders: [folder('f1')]};
		const result = restoreEntry(
			store,
			trashed({
				kind: 'tab',
				tab: tab('b'),
				index: 1,
				sessionId: 'gone',
				sessionName: 'Reading list',
				folderId: 'f1',
			}),
			nextId,
			NOW,
		);
		assert.equal(result.store.groups.length, 1);
		assert.equal(result.store.groups[0].name, 'Reading list');
		assert.deepEqual(
			result.store.groups[0].tabs.map((entry) => entry.id),
			['b'],
		);
		assert.match(result.note ?? '', /session is gone/);
	});

	test('a bookmark returns after the bookmark it followed, with a new id', () => {
		const store = {
			...emptyStore(1),
			bookmarkColumns: [column('c1')],
			bookmarks: [bookmark('x', 'c1'), bookmark('y', 'c1')],
		};
		const result = restoreEntry(
			store,
			trashed({kind: 'bookmark', bookmark: bookmark('m', 'c1'), after: 'x'}),
			() => 'fresh',
			NOW,
		);
		assert.deepEqual(
			result.store.bookmarks.map((entry) => entry.id),
			['x', 'fresh', 'y'],
		);
		assert.equal(result.note, undefined);
	});

	test('a bookmark whose column is gone goes to the first column and says so', () => {
		const store = {...emptyStore(1), bookmarkColumns: [column('c2')]};
		const result = restoreEntry(
			store,
			trashed({kind: 'bookmark', bookmark: bookmark('m', 'gone'), after: null}),
			() => 'fresh',
			NOW,
		);
		assert.equal(result.store.bookmarks[0].columnId, 'c2');
		assert.match(result.note ?? '', /column is gone/);
	});

	test('a column returns with the bookmarks it held', () => {
		const store = {
			...emptyStore(1),
			bookmarkColumns: [column('c2')],
			bookmarks: [bookmark('m', 'c2')],
		};
		const result = restoreEntry(
			store,
			trashed({
				kind: 'column',
				column: column('c1'),
				bookmarks: [bookmark('m', 'c1')],
			}),
			nextId,
			NOW,
		);
		assert.deepEqual(
			result.store.bookmarkColumns.map((entry) => entry.id),
			['c2', 'c1'],
		);
		assert.equal(result.store.bookmarks[0].columnId, 'c1');
	});

	test('a folder returns with the sessions that still exist', () => {
		const store = {
			...emptyStore(1),
			folders: [folder('f2')],
			groups: [session('s1', 'f2'), session('s2', 'f2')],
		};
		const result = restoreEntry(
			store,
			trashed({
				kind: 'folder',
				folder: folder('f1'),
				sessionIds: ['s1', 'gone'],
			}),
			nextId,
			NOW,
		);
		assert.equal(result.store.folders.length, 2);
		assert.deepEqual(
			result.store.groups.map((entry) => entry.folderId),
			['f1', 'f2'],
		);
	});
});
