import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import type {Settings, Store} from '../../extension/src/shared/types';
import {saveMessage} from '../../extension/src/shared/save-feedback';
import {addBookmark, addBookmarks} from '../src/library/board-edits';
import {addSession, addTabsToSession} from '../src/library/session-edits';
import {bookmarkCount, counted, tabCount} from '../src/library/save-outcome';
import {emptyStore} from '../src/library/store-shape';

const NOW = 1_700_000_000_000;
const A = 'https://a.test/';
const B = 'https://b.test/';

const withHandling = (
	handling: Settings['saveDuplicateHandling'] | undefined,
): Store => {
	let store = emptyStore(NOW);
	store = {
		...store,
		settings: {...store.settings, saveDuplicateHandling: handling} as Settings,
		bookmarkColumns: [
			{id: 'one', name: 'One', createdAt: NOW, isDefault: true},
			{id: 'two', name: 'Two', createdAt: NOW, isDefault: false},
		],
	};
	return store;
};

const save = (store: Store, url: string, columnId: string, id: string) =>
	addBookmark(store, {url, title: '', columnId}, id, NOW);

describe('bookmark duplicates on the phone', () => {
	for (const handling of ['allow', 'reject', undefined] as const) {
		test(`a link already in the column is skipped (${handling ?? 'no setting yet'})`, () => {
			const first = save(withHandling(handling), A, 'one', 'b1');
			const again = save(first, A, 'one', 'b2');
			assert.equal(again, first);
			assert.equal(bookmarkCount(again), 1);
		});
	}

	test('another column takes a copy when duplicates are allowed', () => {
		const first = save(withHandling('allow'), A, 'one', 'b1');
		assert.equal(bookmarkCount(save(first, A, 'two', 'b2')), 2);
		assert.equal(
			bookmarkCount(
				save(save(withHandling(undefined), A, 'one', 'x'), A, 'two', 'y'),
			),
			2,
			'a phone library without the setting allows duplicates',
		);
	});

	test('another column is skipped when duplicates are rejected', () => {
		const first = save(withHandling('reject'), A, 'one', 'b1');
		assert.equal(save(first, A, 'two', 'b2'), first);
	});

	test('a batch skips what the board holds and repeats inside the batch', () => {
		const first = save(withHandling('reject'), A, 'one', 'b1');
		const next = addBookmarks(first, [A, B, B], 'two', ['x', 'y', 'z'], NOW);
		assert.deepEqual(
			next.bookmarks.map((bookmark) => bookmark.url),
			[A, B],
		);
	});
});

describe('session duplicates on the phone', () => {
	const session = (store: Store, id: string, urls: string[]) =>
		addSession(
			store,
			{name: id, urls},
			id,
			urls.map((_, i) => `${id}-${i}`),
			NOW,
		);

	test('a session never gets a link it holds, whatever the setting', () => {
		for (const handling of ['allow', 'reject'] as const) {
			const store = session(withHandling(handling), 's1', [A]);
			assert.equal(addTabsToSession(store, 's1', [A], ['t'], NOW), store);
			const more = addTabsToSession(store, 's1', [A, B], ['t1', 't2'], NOW);
			assert.deepEqual(
				more.groups[0].tabs.map((tab) => tab.url),
				[A, B],
			);
		}
	});

	test('another session decides by the setting', () => {
		const allow = session(session(withHandling('allow'), 's1', [A]), 's2', [B]);
		assert.equal(tabCount(addTabsToSession(allow, 's2', [A], ['t'], NOW)), 3);
		const reject = session(session(withHandling('reject'), 's1', [A]), 's2', [
			B,
		]);
		assert.equal(addTabsToSession(reject, 's2', [A], ['t'], NOW), reject);
	});

	test('a new session under reject leaves out saved links, and is not made when nothing is left', () => {
		const store = session(withHandling('reject'), 's1', [A]);
		assert.equal(session(store, 's2', [A]), store);
		const made = session(store, 's2', [A, B]);
		assert.deepEqual(
			made.groups
				.find((group) => group.id === 's2')!
				.tabs.map((tab) => tab.url),
			[B],
		);
		const allowed = session(session(withHandling('allow'), 's1', [A]), 's2', [
			A,
		]);
		assert.equal(tabCount(allowed), 2);
	});
});

describe('save outcome on the phone', () => {
	test('says what was saved and what was skipped, and never reports a skipped duplicate as saved', () => {
		const store = save(withHandling('reject'), A, 'one', 'b1');
		const both = counted(bookmarkCount, (current) =>
			addBookmarks(current, [A, B], 'one', ['x', 'y'], NOW),
		);
		both.change(store);
		assert.equal(
			saveMessage(both.outcome(2, 'bookmark', 'One')),
			'Saved 1 bookmark to One. 1 duplicate not saved.',
		);
		const none = counted(bookmarkCount, (current) =>
			save(current, A, 'one', 'z'),
		);
		none.change(store);
		const outcome = none.outcome(1, 'bookmark', 'One');
		assert.equal(outcome.kind, 'duplicate');
		assert.equal(saveMessage(outcome), 'Nothing saved. 1 duplicate not saved.');
	});
});
