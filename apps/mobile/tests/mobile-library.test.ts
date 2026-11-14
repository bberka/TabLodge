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
	emptyStore,
	extractUrl,
	moveBookmarks,
	removeBookmarks,
	restoreBookmarks,
	splitShared,
	searchBookmarks,
	updateBookmark,
	addBookmarks,
	deleteColumn,
	updateColumn,
	addSession,
	moveBookmark,
	moveColumn,
	setSessionColor,
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
	extractUrls,
	sessionFolders,
	sessionsIn,
} from '../src/library';
import {sampleStore} from '../src/seed';

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

	test('restores removed bookmarks under new ids', () => {
		const store = build();
		const gone = store.bookmarks.filter((bookmark) => bookmark.id === 'b');
		const without = removeBookmarks(store, new Set(['b']), NOW);
		const back = restoreBookmarks(without, gone, ['b2'], NOW + 1);
		assert.deepEqual(ids(back, 'c1'), ['b2', 'a', 'c']);
		assert.equal(back.bookmarks[0].title, 'b');
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
