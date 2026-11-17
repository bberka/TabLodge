import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	BOOKMARK_UNFILED_ID,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
} from '../../extension/src/shared/bookmark-rules';
import {
	addBookmark,
	addColumn,
	bookmarksIn,
	columnViews,
	moveBookmarks,
	removeBookmarks,
	removedBookmarks,
	restoreBookmarks,
	searchBookmarks,
	updateBookmark,
	addBookmarks,
	deleteColumn,
	setColumnSites,
	updateColumn,
	moveBookmark,
	moveColumn,
	setSessionColor,
	restoreColumn,
	allBookmarks,
} from '../src/library/board-edits';
import {
	emptyStore,
	extractUrl,
	splitShared,
	extractUrls,
	libraryStats,
} from '../src/library/store-shape';
import {
	addSession,
	renameSession,
	moveSession,
	archiveSession,
	removeSession,
	restoreSession,
	removeSessionTab,
	markSessionOpened,
	sessionLinks,
	addTabsToSession,
	ALL_SESSIONS_ID,
	sessionFolders,
	sessionsIn,
	canChangeFolder,
	deleteFolder,
	describeSession,
	renameFolder,
	addFolder,
	folderLimitProblem,
	folderNameProblem,
	updateFolder,
	restoreFolder,
	updateSessionTab,
	isArchivedSession,
	unarchiveSession,
	searchSessions,
} from '../src/library/session-edits';
import {sampleStore} from '../src/library/seed';

const NOW = 1000;
const ids = (store: ReturnType<typeof emptyStore>, columnId: string) =>
	bookmarksIn(store, columnId).map((bookmark) => bookmark.id);

describe('extractUrl', () => {
	test('finds the link in shared text and drops trailing punctuation', () => {
		assert.equal(
			extractUrl('Look at this (https://example.com/a?b=1).'),
			'https://example.com/a?b=1',
		);
	});

	test('refuses text without a web link', () => {
		assert.equal(extractUrl('javascript:alert(1)'), undefined);
		assert.equal(extractUrl('no link here'), undefined);
	});
});

describe('bookmarks', () => {
	test('creates the default column for the first saved link', () => {
		const store = addBookmark(
			emptyStore(NOW),
			{url: 'https://example.com', title: '', columnId: ''},
			'b1',
			NOW,
		);
		assert.equal(store.bookmarkColumns.length, 1);
		assert.equal(store.bookmarkColumns[0].id, DEFAULT_BOOKMARK_COLUMN_ID);
		assert.equal(store.bookmarkColumns[0].isDefault, true);
		assert.equal(store.bookmarks[0].title, 'example.com');
		assert.equal(store.bookmarks[0].columnId, DEFAULT_BOOKMARK_COLUMN_ID);
	});

	test('puts a new bookmark last in the chosen column, as the extension does', () => {
		let store = addColumn(emptyStore(NOW), 'Read', 'c1', NOW);
		store = addBookmark(
			store,
			{url: 'https://a.test', title: 'A', columnId: 'c1'},
			'a',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://b.test', title: 'B', columnId: 'c1'},
			'b',
			NOW,
		);
		assert.deepEqual(ids(store, 'c1'), ['a', 'b']);
	});

	test('files a link into the column that claims its site, then the default column', () => {
		let store = addColumn(emptyStore(NOW), 'News', 'c1', NOW);
		store = {
			...store,
			bookmarkColumns: store.bookmarkColumns.map((column) =>
				column.id === 'c1' ? {...column, domains: ['news.example']} : column,
			),
		};
		store = addBookmark(
			store,
			{url: 'https://news.example/a', title: '', columnId: 'gone'},
			'a',
			NOW,
		);
		assert.deepEqual(ids(store, 'c1'), ['a']);
		store = addBookmark(
			store,
			{url: 'https://other.example', title: '', columnId: 'gone'},
			'b',
			NOW,
		);
		assert.equal(
			store.bookmarks.find((bookmark) => bookmark.id === 'b')?.columnId,
			store.bookmarkColumns[0].id,
		);
	});

	test('ignores a link that is not a web address', () => {
		const store = emptyStore(NOW);
		assert.equal(
			addBookmark(
				store,
				{url: 'ftp://x.test', title: '', columnId: ''},
				'x',
				NOW,
			),
			store,
		);
	});

	test('finds a bookmark by words in its title or address', () => {
		let store = addColumn(emptyStore(NOW), 'One', 'c1', NOW);
		store = addBookmark(
			store,
			{url: 'https://a.test/page', title: 'Alpha', columnId: 'c1'},
			'a',
			NOW,
		);
		assert.equal(searchBookmarks(store, 'alpha page').length, 1);
		assert.equal(searchBookmarks(store, 'missing').length, 0);
	});

	test('search operators narrow bookmarks by site, column and words left out', () => {
		let store = addColumn(emptyStore(NOW), 'Read later', 'c1', NOW);
		store = addColumn(store, 'Work', 'c2', NOW);
		store = addBookmark(
			store,
			{url: 'https://github.com/a', title: 'Repo docs', columnId: 'c1'},
			'a',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://example.com/b', title: 'Old docs', columnId: 'c2'},
			'b',
			NOW,
		);
		const found = (query: string) =>
			searchBookmarks(store, query).map((bookmark) => bookmark.id);
		assert.deepEqual(found('docs'), ['a', 'b']);
		assert.deepEqual(found('Site:github.com'), ['a']);
		assert.deepEqual(found('col:"read later"'), ['a']);
		assert.deepEqual(found('docs -old'), ['a']);
		assert.deepEqual(found('in:sessions'), []);
		assert.deepEqual(found('"docs'), ['a', 'b']);
	});

	test('shows bookmarks of a missing column under Unfiled', () => {
		const store = {
			...emptyStore(NOW),
			bookmarks: [
				{
					id: 'a',
					title: 'A',
					url: 'https://a.test',
					columnId: 'gone',
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		};
		assert.deepEqual(columnViews(store), [
			{id: BOOKMARK_UNFILED_ID, name: 'Unfiled'},
		]);
		assert.deepEqual(ids(store, BOOKMARK_UNFILED_ID), ['a']);
	});
});

describe('sample data', () => {
	test('matches the extension dev fixture and groups bookmarks into real columns', () => {
		const store = sampleStore(NOW);
		assert.equal(store.groups.length, 6);
		assert.equal(store.bookmarks.length, 16);
		assert.equal(
			columnViews(store).some((view) => view.id === BOOKMARK_UNFILED_ID),
			false,
		);
		const sessionIds = store.groups.map((session) => session.id);
		assert.equal(new Set(sessionIds).size, sessionIds.length);
	});
});

describe('several bookmarks', () => {
	const build = () => {
		let store = addColumn(
			addColumn(emptyStore(NOW), 'One', 'c1', NOW),
			'Two',
			'c2',
			NOW,
		);
		for (const id of ['a', 'b', 'c']) {
			store = addBookmark(
				store,
				{url: `https://${id}.test`, title: id, columnId: 'c1'},
				id,
				NOW,
			);
		}

		return store;
	};

	test('removes and moves a selection, keeping the rest', () => {
		const store = build();
		assert.deepEqual(
			ids(removeBookmarks(store, new Set(['a', 'c']), NOW), 'c1'),
			['b'],
		);
		const moved = moveBookmarks(store, new Set(['a', 'b']), 'c2', NOW + 1);
		assert.deepEqual(ids(moved, 'c2'), ['a', 'b']);
		assert.deepEqual(ids(moved, 'c1'), ['c']);
		assert.equal(moveBookmarks(store, new Set(['a']), 'missing', NOW), store);
	});

	test('edits a bookmark in place and moves it only when the column changes', () => {
		const store = build();
		const same = updateBookmark(
			store,
			'b',
			{url: 'see https://new.example/x.', title: ' Renamed ', columnId: 'c1'},
			NOW + 1,
		);
		assert.deepEqual(ids(same, 'c1'), ['a', 'b', 'c']);
		const edited = same.bookmarks.find((bookmark) => bookmark.id === 'b');
		assert.equal(edited?.url, 'https://new.example/x');
		assert.equal(edited?.title, 'Renamed');
		const elsewhere = updateBookmark(
			store,
			'b',
			{url: 'https://b.example', title: '', columnId: 'c2'},
			NOW + 2,
		);
		assert.deepEqual(ids(elsewhere, 'c2'), ['b']);
		assert.equal(
			updateBookmark(store, 'b', {url: 'nope', title: '', columnId: 'c1'}, NOW),
			store,
		);
		assert.equal(
			updateBookmark(
				store,
				'missing',
				{url: 'https://a.example', title: '', columnId: 'c1'},
				NOW,
			),
			store,
		);
	});

	test('restores removed bookmarks under new ids, where they were', () => {
		const store = build();
		const gone = removedBookmarks(store, new Set(['b']));
		const without = removeBookmarks(store, new Set(['b']), NOW);
		const back = restoreBookmarks(without, gone, ['b2'], NOW + 1);
		assert.deepEqual(ids(back, 'c1'), ['a', 'b2', 'c']);
		assert.equal(
			back.bookmarks.find((bookmark) => bookmark.id === 'b2')?.title,
			'b',
		);
	});

	test('restores neighbours removed together in their old order, and the first one first', () => {
		const store = build();
		const picked = new Set(['a', 'b']);
		const back = restoreBookmarks(
			removeBookmarks(store, picked, NOW),
			removedBookmarks(store, picked),
			['a2', 'b2'],
			NOW + 1,
		);
		assert.deepEqual(ids(back, 'c1'), ['a2', 'b2', 'c']);
		const last = new Set(['c']);
		const again = restoreBookmarks(
			removeBookmarks(store, last, NOW),
			removedBookmarks(store, last),
			['c2'],
			NOW + 1,
		);
		assert.deepEqual(ids(again, 'c1'), ['a', 'b', 'c2']);
	});

	test('restores into the first column when the old one is gone', () => {
		const store = build();
		const gone = removedBookmarks(store, new Set(['b']));
		const without = deleteColumn(
			removeBookmarks(store, new Set(['b']), NOW),
			'c1',
			'c2',
			NOW,
		);
		const back = restoreBookmarks(without, gone, ['b2'], NOW + 1);
		assert.equal(
			back.bookmarks.find((bookmark) => bookmark.id === 'b2')?.columnId,
			'c2',
		);
	});
});

describe('splitShared', () => {
	test('uses the words around a shared link as the title', () => {
		assert.deepEqual(splitShared('Great read https://example.com/post'), {
			url: 'https://example.com/post',
			title: 'Great read',
		});
		assert.deepEqual(splitShared('https://example.com'), {
			url: 'https://example.com/',
			title: '',
		});
		assert.deepEqual(splitShared('just words'), {title: ''});
	});
});

describe('session folders', () => {
	const folder = (id: string, name: string) => ({
		id,
		name,
		createdAt: 1,
		isDefault: false,
	});
	const session = (id: string, folderId: string, createdAt: number) => ({
		id,
		name: id,
		folderId,
		description: '',
		createdAt,
		updatedAt: createdAt,
		sourceWindowName: '',
		sourceWindowId: null,
		tabs: [],
	});
	const store = {
		...emptyStore(NOW),
		folders: [
			folder('unfiled', 'Unfiled'),
			folder('archived-sessions', 'Archived'),
			folder('work', 'Work'),
		],
		groups: [
			session('a', 'unfiled', 1),
			session('b', 'work', 3),
			session('c', 'archived-sessions', 2),
			session('d', 'gone', 4),
		],
	};

	test('lists All without archived, then folders with Archived last', () => {
		assert.deepEqual(
			sessionFolders(store).map(({id, count}) => [id, count]),
			[
				[ALL_SESSIONS_ID, 3],
				['unfiled', 1],
				['work', 1],
				['other-sessions', 1],
				['archived-sessions', 1],
			],
		);
	});

	test('filters by folder and sorts like the extension', () => {
		const names = (id: string, sort: Parameters<typeof sessionsIn>[2]) =>
			sessionsIn(store, id, sort).map((s) => s.id);
		assert.deepEqual(names(ALL_SESSIONS_ID, 'newest'), ['d', 'b', 'a']);
		assert.deepEqual(names(ALL_SESSIONS_ID, 'oldest'), ['a', 'b', 'd']);
		assert.deepEqual(names('archived-sessions', 'newest'), ['c']);
		assert.deepEqual(names('other-sessions', 'newest'), ['d']);
	});
});

describe('shared link lists', () => {
	test('finds every link once, in order', () => {
		assert.deepEqual(
			extractUrls(
				'Tabs\nhttps://a.test/x\nhttps://b.test (see https://a.test/x), https://c.test.',
			),
			['https://a.test/x', 'https://b.test/', 'https://c.test/'],
		);
		assert.deepEqual(extractUrls('no links'), []);
	});

	test('saves them as bookmarks, keeping the order', () => {
		const base = addColumn(emptyStore(NOW), 'One', 'c1', NOW);
		const store = addBookmarks(
			base,
			['https://a.test', 'https://b.test'],
			'c1',
			['x', 'y'],
			NOW,
		);
		assert.equal(store.bookmarks.length, 2);
		assert.equal(new Set(store.bookmarks.map((b) => b.id)).size, 2);
	});

	test('saves them as a session in the default folder, or adds to one', () => {
		const made = addSession(
			emptyStore(NOW),
			{name: ' ', urls: ['https://a.test/', 'https://b.test/']},
			's1',
			['t1', 't2'],
			NOW,
		);
		assert.equal(made.folders[0].id, 'unfiled');
		assert.equal(made.groups[0].name, 'Shared links');
		assert.equal(made.groups[0].deviceName, undefined);
		const stamped = addSession(
			emptyStore(NOW),
			{
				name: 'x',
				urls: ['https://a.test/'],
				device: {deviceName: 'Pixel', deviceKind: 'mobile'},
			},
			's9',
			['t9'],
			NOW,
		);
		assert.equal(stamped.groups[0].deviceName, 'Pixel');
		assert.equal(stamped.groups[0].deviceKind, 'mobile');
		assert.deepEqual(
			made.groups[0].tabs.map((tab) => [tab.id, tab.originalIndex, tab.title]),
			[
				['t1', 0, 'a.test'],
				['t2', 1, 'b.test'],
			],
		);
		const more = addTabsToSession(
			made,
			's1',
			['https://c.test/'],
			['t3'],
			NOW + 1,
		);
		assert.deepEqual(
			more.groups[0].tabs.map((tab) => tab.originalIndex),
			[0, 1, 2],
		);
		assert.equal(
			addTabsToSession(made, 'missing', ['https://c.test/'], [], NOW),
			made,
		);
		assert.equal(addSession(made, {name: 'x', urls: []}, 's2', [], NOW), made);
	});
});

describe('editing columns', () => {
	const build = () => {
		let store = addColumn(
			addColumn(emptyStore(NOW), 'One', 'c1', NOW, 'star', 'teal'),
			'Two',
			'c2',
			NOW,
		);
		store = {
			...store,
			bookmarkColumns: store.bookmarkColumns.map((column) =>
				column.id === 'c1' ? {...column, domains: ['github.com']} : column,
			),
		};
		for (const [id, column] of [
			['a', 'c1'],
			['b', 'c1'],
			['c', 'c2'],
		] as const) {
			store = addBookmark(
				store,
				{url: `https://${id}.test`, title: id, columnId: column},
				id,
				NOW,
			);
		}

		return store;
	};

	const column = (store: ReturnType<typeof emptyStore>, id: string) =>
		store.bookmarkColumns.find((entry) => entry.id === id);

	test('a new column keeps a valid color and drops the rest', () => {
		const store = build();
		assert.equal(column(store, 'c1')?.color, 'teal');
		const odd = addColumn(store, 'Odd', 'c3', NOW, undefined, 'chartreuse');
		assert.equal(column(odd, 'c3')?.color, undefined);
		const hex = addColumn(store, 'Hex', 'c4', NOW, undefined, '#a1b2c3');
		assert.equal(column(hex, 'c4')?.color, '#a1b2c3');
	});

	test('renaming and recoloring keeps the rest, and empty values remove the icon and color', () => {
		const store = build();
		const changed = updateColumn(
			store,
			'c1',
			{name: '  Reading ', icon: 'book-open', color: 'rose'},
			NOW + 1,
		);
		assert.deepEqual(
			{
				name: column(changed, 'c1')?.name,
				icon: column(changed, 'c1')?.icon,
				color: column(changed, 'c1')?.color,
				domains: column(changed, 'c1')?.domains,
			},
			{
				name: 'Reading',
				icon: 'book-open',
				color: 'rose',
				domains: ['github.com'],
			},
		);
		const cleared = updateColumn(
			changed,
			'c1',
			{name: 'Reading', icon: '', color: ''},
			NOW + 2,
		);
		assert.equal(column(cleared, 'c1')?.icon, undefined);
		assert.equal(column(cleared, 'c1')?.color, undefined);
		assert.deepEqual(column(cleared, 'c1')?.domains, ['github.com']);
		// An unknown color is dropped, not stored.
		const bad = updateColumn(
			store,
			'c1',
			{name: 'One', icon: 'star', color: 'chartreuse'},
			NOW + 3,
		);
		assert.equal(column(bad, 'c1')?.color, undefined);
	});

	test("setting a column's sites normalizes them, drops repeats, and an empty list removes the field", () => {
		const store = build();
		const changed = setColumnSites(
			store,
			'c1',
			[
				'https://www.GitHub.com/bberka/',
				'github.com/bberka',
				'news.example',
				'junk',
			],
			NOW + 1,
		);
		assert.deepEqual(column(changed, 'c1')?.domains, [
			'github.com/bberka',
			'news.example',
		]);
		assert.equal(column(changed, 'c1')?.name, column(store, 'c1')?.name);
		assert.equal(changed.updatedAt, NOW + 1);
		const cleared = setColumnSites(changed, 'c1', [], NOW + 2);
		assert.equal('domains' in (column(cleared, 'c1') ?? {}), false);
		assert.equal(setColumnSites(store, 'missing', ['a.example'], NOW), store);
	});

	test('a name that is empty, reserved, or taken is refused', () => {
		const store = build();
		assert.match(
			columnNameProblem(store.bookmarkColumns, ' ') ?? '',
			/different/,
		);
		assert.match(
			columnNameProblem(store.bookmarkColumns, 'All Bookmarks') ?? '',
			/different/,
		);
		assert.match(
			columnNameProblem(store.bookmarkColumns, 'two') ?? '',
			/already exists/,
		);
		assert.equal(
			columnNameProblem(store.bookmarkColumns, 'One', 'c1'),
			undefined,
			'its own name is fine',
		);
		assert.equal(
			updateColumn(store, 'c1', {name: 'Two', icon: '', color: ''}, NOW),
			store,
		);
		assert.equal(
			updateColumn(store, 'missing', {name: 'X', icon: '', color: ''}, NOW),
			store,
		);
	});

	test('deleting a column moves its bookmarks to another, or deletes them with it', () => {
		const store = build();
		const moved = deleteColumn(store, 'c1', 'c2', NOW + 1);
		assert.deepEqual(
			moved.bookmarkColumns.map((entry) => entry.id),
			['c2'],
		);
		assert.deepEqual(ids(moved, 'c2'), ['c', 'a', 'b']);
		const gone = deleteColumn(store, 'c1', null, NOW + 1);
		assert.equal(gone.bookmarks.length, 1);
		assert.equal(gone.bookmarks[0]?.id, 'c');
	});

	test('the last column sends its bookmarks to Unfiled, and a missing column changes nothing', () => {
		const single = deleteColumn(
			deleteColumn(build(), 'c2', 'c1', NOW),
			'c1',
			'c1',
			NOW,
		);
		assert.deepEqual(single.bookmarkColumns, []);
		assert.equal(
			single.bookmarks.every(
				(bookmark) => bookmark.columnId === BOOKMARK_UNFILED_ID,
			),
			true,
		);
		assert.equal(single.bookmarks.length, 3);
		const store = build();
		assert.equal(deleteColumn(store, 'missing', null, NOW), store);
	});
});

describe('session colors', () => {
	test('a session takes a preset or a hex, and an empty or unknown value removes it', () => {
		const base = addSession(
			emptyStore(NOW),
			{name: 's', urls: ['https://a.test/']},
			's1',
			['t1'],
			NOW,
		);
		const blue = setSessionColor(base, 's1', 'blue', NOW + 1);
		assert.equal(blue.groups[0].color, 'blue');
		assert.equal(blue.groups[0].updatedAt, NOW + 1);
		assert.equal(
			setSessionColor(blue, 's1', '#12AB9F', NOW).groups[0].color,
			undefined,
		);
		assert.equal(
			setSessionColor(blue, 's1', '#12ab9f', NOW).groups[0].color,
			'#12ab9f',
		);
		assert.equal(
			setSessionColor(blue, 's1', '', NOW).groups[0].color,
			undefined,
		);
		assert.equal(
			setSessionColor(blue, 's1', 'system', NOW).groups[0].color,
			undefined,
		);
		assert.equal(setSessionColor(blue, 'missing', 'red', NOW), blue);
	});
});

describe('session actions', () => {
	const base = () =>
		addSession(
			emptyStore(NOW),
			{name: 'Work', urls: ['https://a.example/', 'https://b.example/']},
			's1',
			['t1', 't2'],
			NOW,
		);
	test('rename keeps the name non blank', () => {
		const store = base();
		assert.equal(
			renameSession(store, 's1', ' Home ', NOW + 1).groups[0].name,
			'Home',
		);
		assert.equal(renameSession(store, 's1', '  ', NOW + 1), store);
		assert.equal(renameSession(store, 'missing', 'x', NOW + 1), store);
	});

	test('archive makes the Archived folder once and move needs a real folder', () => {
		const once = archiveSession(base(), 's1', NOW + 1);
		const archived = once.folders.find((folder) => folder.name === 'Archived');
		assert.ok(archived);
		assert.equal(once.groups[0].folderId, archived.id);
		assert.equal(
			archiveSession(once, 's1', NOW + 2).folders.length,
			once.folders.length,
		);
		assert.equal(moveSession(once, 's1', 'nowhere', NOW), once);
	});

	test('a deleted session comes back with its id', () => {
		const store = base();
		const session = store.groups[0];
		const gone = removeSession(store, 's1', NOW + 1);
		assert.equal(gone.groups.length, 0);
		assert.equal(restoreSession(gone, session, NOW + 2).groups[0].id, 's1');
		assert.equal(restoreSession(store, session, NOW + 2), store);
	});

	test('a tab can be removed, and opening is noted', () => {
		const store = base();
		const fewer = removeSessionTab(store, 's1', 't1', NOW + 1);
		assert.deepEqual(
			fewer.groups[0].tabs.map((tab) => tab.id),
			['t2'],
		);
		assert.equal(
			markSessionOpened(store, 's1', NOW + 5).groups[0].lastOpenedAt,
			NOW + 5,
		);
		assert.equal(
			sessionLinks(store.groups[0]),
			'https://a.example/\nhttps://b.example/',
		);
	});
});

describe('ordering', () => {
	const base = () => sampleStore(NOW);
	test('a column moves one place at a time and stops at the ends', () => {
		const store = base();
		const order = store.bookmarkColumns.map((column) => column.id);
		const first = order[0];
		assert.equal(moveColumn(store, first, -1, NOW), store);
		const moved = moveColumn(store, first, 1, NOW + 1);
		assert.deepEqual(
			moved.bookmarkColumns.map((column) => column.id),
			[order[1], order[0], ...order.slice(2)],
		);
		assert.equal(moved.updatedAt, NOW + 1);
		const last = order.at(-1)!;
		assert.equal(moveColumn(store, last, 1, NOW), store);
		assert.equal(moveColumn(store, 'missing', 1, NOW), store);
	});

	test('a bookmark moves within its own column only', () => {
		const store = base();
		const column = store.bookmarkColumns[0].id;
		const inColumn = () => (s: typeof store) =>
			s.bookmarks.filter((b) => b.columnId === column).map((b) => b.id);
		const before = inColumn()(store);
		assert.ok(before.length >= 3);
		const others = store.bookmarks
			.filter((b) => b.columnId !== column)
			.map((b) => b.id);
		const down = moveBookmark(store, before[0], 'down', NOW + 1);
		assert.deepEqual(inColumn()(down).slice(0, 2), [before[1], before[0]]);
		assert.deepEqual(
			down.bookmarks.filter((b) => b.columnId !== column).map((b) => b.id),
			others,
		);
		assert.equal(moveBookmark(store, before[0], 'up', NOW), store);
		assert.equal(moveBookmark(store, before.at(-1)!, 'down', NOW), store);
		const top = moveBookmark(store, before.at(-1)!, 'top', NOW);
		assert.equal(inColumn()(top)[0], before.at(-1));
		const bottom = moveBookmark(store, before[0], 'bottom', NOW);
		assert.equal(inColumn()(bottom).at(-1), before[0]);
		assert.equal(inColumn()(bottom).length, before.length);
		assert.equal(moveBookmark(store, 'missing', 'up', NOW), store);
	});
});

describe('session folders', () => {
	const withFolders = () => {
		let store = emptyStore(NOW);
		store = {
			...store,
			folders: [
				{id: 'unfiled', name: 'Unfiled', createdAt: NOW, isDefault: true},
				{id: 'work', name: 'Work', createdAt: NOW, isDefault: false},
				{
					id: 'archived-sessions',
					name: 'Archived',
					createdAt: NOW,
					isDefault: false,
				},
			],
		};
		return addSession(
			store,
			{name: 'Plans', urls: ['https://a.example/'], folderId: 'work'},
			's1',
			['t1'],
			NOW,
		);
	};

	test('renaming keeps the sessions and refuses a taken or reserved name', () => {
		const store = withFolders();
		const renamed = renameFolder(store, 'work', '  Projects ', NOW + 1);
		assert.equal(
			renamed.folders.find((f) => f.id === 'work')?.name,
			'Projects',
		);
		assert.equal(renamed.groups[0].folderId, 'work');
		assert.equal(renameFolder(store, 'work', 'unfiled', NOW), store);
		assert.equal(renameFolder(store, 'work', 'All sessions', NOW), store);
		assert.equal(renameFolder(store, 'work', ' '.repeat(3), NOW), store);
	});

	test('a folder is made and changed with its icon and color, and Undo puts a deleted one back', () => {
		const store = withFolders();
		const made = addFolder(
			store,
			{name: ' Reading ', icon: 'book', color: '#336699', colorSessions: true},
			'read',
			NOW + 1,
		);
		const folder = made.folders.find((f) => f.id === 'read');
		assert.equal(folder?.name, 'Reading');
		assert.equal(folder?.icon, 'book');
		assert.equal(folder?.color, '#336699');
		assert.equal(folder?.colorSessions, true);
		assert.equal(
			addFolder(
				made,
				{name: 'reading', icon: '', color: '', colorSessions: false},
				'x',
				NOW,
			),
			made,
		);

		const plain = updateFolder(
			made,
			'read',
			{name: 'Reading', icon: '', color: '', colorSessions: true},
			NOW + 2,
		).folders.find((f) => f.id === 'read');
		assert.equal(plain?.icon, undefined);
		assert.equal(plain?.color, undefined);
		assert.equal(plain?.colorSessions, undefined);
		assert.equal(
			updateFolder(
				made,
				'unfiled',
				{name: 'Home', icon: '', color: '', colorSessions: false},
				NOW,
			),
			made,
		);

		const moved = moveSession(made, 's1', 'read', NOW + 3);
		assert.equal(moved.groups[0].color, '#336699');
		const gone = deleteFolder(moved, 'read', NOW + 4);
		assert.equal(gone.groups[0].folderId, 'unfiled');
		const back = restoreFolder(gone, folder, ['s1'], NOW + 5);
		assert.equal(back.groups[0].folderId, 'read');
		assert.ok(back.folders.some((f) => f.id === 'read'));
	});

	test('a new folder follows the extension rules: limit, duplicates, reserved name, long names', () => {
		const store = withFolders();
		const plain = {icon: '', color: '', colorSessions: false};
		assert.equal(folderNameProblem(store, 'Reading'), undefined);
		assert.equal(
			folderNameProblem(store, 'UNFILED'),
			'A folder with that name already exists.',
		);
		assert.equal(
			folderNameProblem(store, 'all sessions'),
			'Choose a different folder name.',
		);
		const long = addFolder(
			store,
			{name: 'n'.repeat(90), ...plain},
			'long',
			NOW,
		);
		assert.equal(long.folders.find((f) => f.id === 'long')?.name.length, 60);

		const full = {
			...store,
			folders: [
				...store.folders,
				...Array.from({length: 200}, (_, index) => ({
					id: `f${index}`,
					name: `Folder ${index}`,
					createdAt: NOW,
					isDefault: false,
				})),
			],
		};
		assert.ok(folderLimitProblem(full));
		assert.equal(folderLimitProblem(store), undefined);
		assert.equal(addFolder(full, {name: 'More', ...plain}, 'more', NOW), full);
		assert.equal(
			updateFolder(full, 'f1', {name: 'Renamed', ...plain}, NOW).folders.find(
				(f) => f.id === 'f1',
			)?.name,
			'Renamed',
		);
	});

	test('Unfiled and Archived cannot be renamed or deleted', () => {
		const store = withFolders();
		assert.equal(renameFolder(store, 'unfiled', 'Home', NOW), store);
		assert.equal(deleteFolder(store, 'unfiled', NOW), store);
		assert.equal(deleteFolder(store, 'archived-sessions', NOW), store);
		assert.equal(canChangeFolder(store.folders[0]), false);
		assert.equal(canChangeFolder(store.folders[1]), true);
	});

	test('deleting a folder moves its sessions to Unfiled', () => {
		const next = deleteFolder(withFolders(), 'work', NOW + 1);
		assert.equal(
			next.folders.some((f) => f.id === 'work'),
			false,
		);
		assert.equal(next.groups[0].folderId, 'unfiled');
	});
});

describe('editing a saved tab', () => {
	test('changes its title and address, and refuses an address that is not a web address', () => {
		const store = addSession(
			emptyStore(NOW),
			{name: 'S', urls: ['https://a.example/'], folderId: 'unfiled'},
			's1',
			['t1'],
			NOW,
		);
		const changed = updateSessionTab(
			store,
			's1',
			't1',
			{title: ' New title ', url: 'https://b.example/page'},
			NOW + 1,
		);
		assert.equal(changed.groups[0].tabs[0].url, 'https://b.example/page');
		assert.equal(changed.groups[0].tabs[0].title, 'New title');
		assert.equal(
			updateSessionTab(store, 's1', 't1', {title: 'x', url: 'nope'}, NOW),
			store,
		);
	});
});

describe('saved tab notes', () => {
	const withTwoCopies = () => {
		let store = emptyStore(NOW);
		store = {
			...store,
			groups: ['s1', 's2'].map((id) => ({
				id,
				name: id,
				tabs: [
					{
						id: `${id}-t`,
						url: 'https://a.example/page',
						title: 'Old',
						notes: '',
					},
				],
			})) as unknown as typeof store.groups,
		};
		return store;
	};

	test('a changed note and title reach every copy of the same address', () => {
		const changed = updateSessionTab(
			withTwoCopies(),
			's1',
			's1-t',
			{title: 'New', url: 'https://a.example/page', notes: 'read later'},
			NOW + 1,
		);
		for (const group of changed.groups) {
			assert.equal(group.tabs[0].notes, 'read later');
			assert.equal(group.tabs[0].title, 'New');
			assert.equal(group.updatedAt, NOW + 1);
		}
	});

	test('a new address belongs to this one tab only', () => {
		const changed = updateSessionTab(
			withTwoCopies(),
			's1',
			's1-t',
			{title: 'New', url: 'https://b.example/', notes: 'moved'},
			NOW + 1,
		);
		assert.equal(changed.groups[0].tabs[0].url, 'https://b.example/');
		assert.equal(changed.groups[0].tabs[0].notes, 'moved');
		assert.equal(changed.groups[1].tabs[0].notes, '');
		assert.equal(changed.groups[1].tabs[0].title, 'Old');
	});

	test('leaving the notes out keeps them', () => {
		const store = updateSessionTab(
			withTwoCopies(),
			's1',
			's1-t',
			{title: 'Old', url: 'https://a.example/page', notes: 'keep'},
			NOW,
		);
		const kept = updateSessionTab(
			store,
			's1',
			's1-t',
			{title: 'Other', url: 'https://a.example/page'},
			NOW + 1,
		);
		assert.equal(kept.groups[0].tabs[0].notes, 'keep');
	});
});

describe('library statistics', () => {
	test('counts what is saved and ranks the sites that hold the most links', () => {
		let store = emptyStore(NOW);
		store = addColumn(store, 'Work', 'work', NOW);
		store = addBookmark(
			store,
			{url: 'https://www.a.example/1', title: 'A1', columnId: 'work'},
			'b1',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://b.example/', title: 'B', columnId: 'work'},
			'b2',
			NOW + 5,
		);
		store = addSession(
			store,
			{
				name: 'Big',
				urls: [
					'https://a.example/2',
					'https://a.example/3',
					'https://c.example/',
				],
				folderId: 'unfiled',
			},
			's1',
			['t1', 't2', 't3'],
			NOW + 10,
		);
		const stats = libraryStats(store);
		assert.equal(stats.sessions, 1);
		assert.equal(stats.tabs, 3);
		assert.equal(stats.bookmarks, 2);
		assert.equal(stats.columns, 1);
		assert.deepEqual(stats.topSites[0], {host: 'a.example', count: 3});
		assert.deepEqual(stats.largestSession, {name: 'Big', tabs: 3});
		assert.equal(stats.since, NOW);
		assert.deepEqual(libraryStats(emptyStore(NOW)).topSites, []);
	});
});

describe('unarchiving a session', () => {
	test('takes it out of Archived into Unfiled', () => {
		const base = addSession(
			emptyStore(NOW),
			{name: 'S', urls: ['https://a.example/'], folderId: 'unfiled'},
			's1',
			['t1'],
			NOW,
		);
		const archived = archiveSession(base, 's1', NOW + 1);
		assert.equal(isArchivedSession(archived.folders, archived.groups[0]), true);
		const back = unarchiveSession(archived, 's1', NOW + 2);
		assert.equal(isArchivedSession(back.folders, back.groups[0]), false);
		assert.equal(back.groups[0].folderId, 'unfiled');
	});
});

describe('the All column', () => {
	test('lists every bookmark column by column, with the Unfiled ones last', () => {
		let store = emptyStore(NOW);
		store = addColumn(store, 'Work', 'work', NOW);
		store = addColumn(store, 'Home', 'home', NOW);
		store = addBookmark(
			store,
			{url: 'https://h.example/', title: 'H', columnId: 'home'},
			'b1',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://w.example/', title: 'W', columnId: 'work'},
			'b2',
			NOW,
		);
		store = {
			...store,
			bookmarks: [
				...store.bookmarks,
				{
					id: 'b3',
					title: 'X',
					url: 'https://x.example/',
					columnId: 'gone',
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		};
		assert.deepEqual(
			allBookmarks(store).map((bookmark) => bookmark.id),
			['b2', 'b1', 'b3'],
		);
	});
});

describe('restoring a deleted column', () => {
	test('Undo puts the column and its moved or deleted bookmarks back', () => {
		let store = emptyStore(NOW);
		store = addColumn(store, 'Work', 'work', NOW);
		store = addColumn(store, 'Home', 'home', NOW);
		store = addBookmark(
			store,
			{url: 'https://a.example/', title: 'A', columnId: 'work'},
			'b1',
			NOW,
		);
		const column = store.bookmarkColumns.find((c) => c.id === 'work')!;
		const own = bookmarksIn(store, 'work');
		const moved = deleteColumn(store, 'work', 'home', NOW + 1);
		const back = restoreColumn(moved, column, own, NOW + 2);
		assert.equal(bookmarksIn(back, 'work').length, 1);
		const removed = deleteColumn(store, 'work', null, NOW + 1);
		assert.equal(bookmarksIn(removed, 'home').length, 0);
		const restored = restoreColumn(removed, column, own, NOW + 2);
		assert.equal(bookmarksIn(restored, 'work').length, 1);
		assert.equal(restoreColumn(restored, column, own, NOW + 3), restored);
	});
});

describe('moving a session into a folder', () => {
	const store = (folder: Record<string, unknown>) => ({
		...addSession(
			{
				...emptyStore(NOW),
				folders: [
					{id: 'unfiled', name: 'Unfiled', createdAt: NOW, isDefault: true},
					{
						id: 'work',
						name: 'Work',
						createdAt: NOW,
						isDefault: false,
						...folder,
					},
				],
			},
			{name: 'Plans', urls: ['https://a.example/'], folderId: 'unfiled'},
			's1',
			['t1'],
			NOW,
		),
	});

	test('takes the folder color when the folder colors its sessions', () => {
		const next = moveSession(
			store({color: 'red', colorSessions: true}),
			's1',
			'work',
			NOW + 1,
		);
		assert.equal(next.groups[0].color, 'red');
	});

	test('keeps its own color when the folder does not ask for one', () => {
		const next = moveSession(store({color: 'red'}), 's1', 'work', NOW + 1);
		assert.equal(next.groups[0].color, undefined);
	});
});

describe('describing a session', () => {
	test('sets and trims the description, cut to the extension limit', () => {
		const store = addSession(
			emptyStore(NOW),
			{name: 'Plans', urls: ['https://a.example/']},
			's1',
			['t1'],
			NOW,
		);
		const next = describeSession(store, 's1', '  What it is  ', NOW + 1);
		assert.equal(next.groups[0].description, 'What it is');
		const long = describeSession(store, 's1', 'x'.repeat(20_000), NOW + 1);
		assert.equal(long.groups[0].description.length, 10_502);
	});
});

describe('saving a link with its title to a session', () => {
	test('a new session and an added tab keep the title, and fall back to the site', () => {
		const made = addSession(
			emptyStore(NOW),
			{
				name: 'Reading',
				urls: ['https://a.example/x', 'https://b.example/y'],
				titles: ['The title'],
			},
			's1',
			['t1', 't2'],
			NOW,
		);
		assert.deepEqual(
			made.groups[0].tabs.map((tab) => tab.title),
			['The title', 'b.example'],
		);
		const more = addTabsToSession(
			made,
			's1',
			['https://c.example/z'],
			['t3'],
			NOW + 1,
			['Third'],
		);
		assert.equal(more.groups[0].tabs[2].title, 'Third');
	});
});

describe('searchSessions', () => {
	let store = addFolder(
		emptyStore(NOW),
		{name: 'Travel', icon: '', color: '', colorSessions: false},
		'f1',
		NOW,
	);
	store = addSession(
		store,
		{
			name: 'Holiday',
			urls: ['https://www.skyscanner.net/', 'https://hotels.example/'],
			folderId: 'f1',
		},
		's1',
		['t1', 't2'],
		NOW,
	);
	store = addSession(
		store,
		{name: 'Work tabs', urls: ['https://github.com/x']},
		's2',
		['t3'],
		NOW,
	);
	const found = (query: string) =>
		searchSessions(store.groups, query, store.folders)
			.map((session) => session.id)
			.toSorted();

	test('plain words match one piece of a name or address, as before', () => {
		assert.deepEqual(found('holi'), ['s1']);
		assert.deepEqual(found('work tabs'), ['s2']);
		assert.deepEqual(found('tabs work'), []);
	});

	test('operators narrow sessions by folder, site, phrase and kind', () => {
		assert.deepEqual(found('folder:travel'), ['s1']);
		assert.deepEqual(found('site:skyscanner.net'), ['s1']);
		assert.deepEqual(found('-github'), ['s1']);
		assert.deepEqual(found('"work tabs"'), ['s2']);
		assert.deepEqual(found('in:tabs'), ['s1', 's2']);
		assert.deepEqual(found('in:bookmarks'), []);
	});
});

describe('bookmark notes', () => {
	const withNote = () =>
		addBookmark(
			addColumn(emptyStore(NOW), 'Read', 'c1', NOW),
			{
				url: 'https://example.com',
				title: 'Example',
				columnId: 'c1',
				notes: '  For the trip  ',
			},
			'b1',
			NOW,
		);
	const edit = (
		store: ReturnType<typeof withNote>,
		notes: string | undefined,
	) =>
		updateBookmark(
			store,
			'b1',
			{url: 'https://example.com', title: 'Renamed', columnId: 'c1', notes},
			NOW + 1,
		).bookmarks[0];

	test('are saved trimmed, kept when an edit leaves them out, changed, and cleared', () => {
		const store = withNote();
		assert.equal(store.bookmarks[0].notes, 'For the trip');
		assert.equal(edit(store, undefined).notes, 'For the trip');
		assert.equal(edit(store, 'Booked').notes, 'Booked');
		assert.equal('notes' in edit(store, '  '), false);
	});

	test('take part in plain words, -word, and "phrase" in search', () => {
		const store = addBookmark(
			withNote(),
			{
				url: 'https://other.example',
				title: 'Other',
				columnId: 'c1',
				notes: 'Trip packing list',
			},
			'b2',
			NOW,
		);
		const found = (query: string) =>
			searchBookmarks(store, query)
				.map((entry) => entry.id)
				.toSorted();
		assert.deepEqual(found('trip'), ['b1', 'b2']);
		assert.deepEqual(found('trip -packing'), ['b1']);
		assert.deepEqual(found('"packing list"'), ['b2']);
		assert.deepEqual(found('"list packing"'), []);
	});

	test('are found by search', () => {
		assert.deepEqual(
			searchBookmarks(withNote(), 'trip').map((entry) => entry.id),
			['b1'],
		);
	});
});
