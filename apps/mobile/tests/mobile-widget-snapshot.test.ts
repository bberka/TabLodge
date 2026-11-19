import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import type {Store} from '../../extension/src/shared/types';
import {BOOKMARK_UNFILED_ID} from '../../extension/src/shared/bookmark-rules';
import {
	ALL_BOOKMARKS_ID,
	addBookmark,
	addColumn,
	deleteColumn,
} from '../src/library/board-edits';
import {emptyStore} from '../src/library/store-shape';
import {buildWidgetSnapshot} from '../src/library/widget-snapshot';

const OPEN = {how: 'system' as const, app: ''};
let counter = 0;
const id = () => {
	counter += 1;
	return `id-${counter}`;
};

function withColumns(...names: string[]): Store {
	let store = emptyStore(1);
	for (const name of names) {
		store = addColumn(store, name, name.toLowerCase(), 1);
	}

	return store;
}

const save = (store: Store, columnId: string, url: string, title = '') =>
	addBookmark(store, {url, title, columnId}, id(), 2);

describe('the Bookmarks widget snapshot', () => {
	test('gives nothing for a library with no bookmarks, so erasing them deletes the copy', () => {
		assert.equal(buildWidgetSnapshot(emptyStore(1), OPEN), undefined);
		assert.equal(buildWidgetSnapshot(withColumns('Reading'), OPEN), undefined);
	});

	test('puts All first, then the columns, each in its own link order', () => {
		let store = withColumns('Reading', 'Tools');
		store = save(store, 'tools', 'https://b.example/1', 'Tool one');
		store = save(store, 'reading', 'https://a.example/1', 'First');
		store = save(store, 'reading', 'https://a.example/2', 'Second');
		const snapshot = buildWidgetSnapshot(store, OPEN);
		assert.deepEqual(
			snapshot?.columns.map((column) => [
				column.id,
				column.links.map((link) => link.title),
			]),
			[
				[ALL_BOOKMARKS_ID, ['First', 'Second', 'Tool one']],
				['reading', ['First', 'Second']],
				['tools', ['Tool one']],
			],
		);
	});

	test('caps the links per column, All included, but counts them all', () => {
		let store = withColumns('Reading');
		for (let index = 0; index < 60; index += 1) {
			store = save(store, 'reading', `https://a.example/${index}`);
		}

		const columns = buildWidgetSnapshot(store, OPEN)?.columns ?? [];
		for (const columnId of [ALL_BOOKMARKS_ID, 'reading']) {
			const column = columns.find((each) => each.id === columnId);
			assert.equal(column?.links.length, 50, columnId);
			assert.equal(column?.count, 60, columnId);
			assert.equal(column?.links[0]?.url, 'https://a.example/0', columnId);
		}
	});

	test('caps the number of columns', () => {
		let store = emptyStore(1);
		for (let index = 0; index < 55; index += 1) {
			store = addColumn(store, `Column ${index}`, `c${index}`, 1);
		}

		store = save(store, 'c0', 'https://a.example/');
		assert.equal(
			buildWidgetSnapshot(store, OPEN)?.columns.length,
			51,
			'the capped columns, and All',
		);
	});

	test('keeps only web links, names an untitled one by its site, and carries the Open links choice', () => {
		let store = withColumns('Reading');
		store = save(store, 'reading', 'https://www.example.org/page');
		store = {
			...store,
			bookmarks: [
				...store.bookmarks,
				{...store.bookmarks[0], id: 'ftp', url: 'ftp://files.example/'},
			],
		};
		const snapshot = buildWidgetSnapshot(store, {
			how: 'app',
			app: 'org.mozilla.firefox',
		});
		assert.deepEqual(snapshot?.open, {how: 'app', app: 'org.mozilla.firefox'});
		assert.deepEqual(
			snapshot?.columns.find((column) => column.id === 'reading')?.links,
			[
				{
					title: 'example.org',
					url: 'https://www.example.org/page',
					host: 'example.org',
				},
			],
		);
	});

	test('drops a deleted column, so a widget showing it finds it gone', () => {
		let store = withColumns('Reading', 'Tools');
		store = save(store, 'reading', 'https://a.example/');
		store = save(store, 'tools', 'https://b.example/');
		store = deleteColumn(store, 'tools', null, 3);
		const snapshot = buildWidgetSnapshot(store, OPEN);
		assert.deepEqual(
			snapshot?.columns.map((column) => column.id),
			[ALL_BOOKMARKS_ID, 'reading'],
		);
		assert.ok(
			!JSON.stringify(snapshot).includes('b.example'),
			'the deleted column’s links are gone too',
		);
	});

	test('lists bookmarks whose column is missing under Unfiled, last', () => {
		let store = withColumns('Reading');
		store = save(store, 'reading', 'https://a.example/');
		store = {
			...store,
			bookmarks: [
				...store.bookmarks,
				{
					...store.bookmarks[0],
					id: 'orphan',
					columnId: 'gone',
					url: 'https://c.example/',
				},
			],
		};
		const columns = buildWidgetSnapshot(store, OPEN)?.columns ?? [];
		assert.deepEqual(
			columns.map((column) => column.id),
			[ALL_BOOKMARKS_ID, 'reading', BOOKMARK_UNFILED_ID],
		);
	});
});
