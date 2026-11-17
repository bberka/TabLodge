import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import type {Store} from '../../extension/src/shared/types';
import {BOOKMARK_UNFILED_ID} from '../../extension/src/shared/bookmark-rules';
import {addBookmark, addColumn, deleteColumn} from '../src/library/board-edits';
import {emptyStore} from '../src/library/store-shape';
import {
	buildWidgetSnapshot,
	WIDGET_COLUMNS_MAX,
	WIDGET_LINKS_PER_COLUMN,
} from '../src/library/widget-snapshot';

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

	test('keeps the column order and each column’s own link order', () => {
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
				['reading', ['First', 'Second']],
				['tools', ['Tool one']],
			],
		);
	});

	test('caps the links per column but counts them all', () => {
		let store = withColumns('Reading');
		for (let index = 0; index < WIDGET_LINKS_PER_COLUMN + 10; index += 1) {
			store = save(store, 'reading', `https://a.example/${index}`);
		}

		const [column] = buildWidgetSnapshot(store, OPEN)?.columns ?? [];
		assert.equal(column?.links.length, WIDGET_LINKS_PER_COLUMN);
		assert.equal(column?.count, WIDGET_LINKS_PER_COLUMN + 10);
		assert.equal(column?.links[0]?.url, 'https://a.example/0');
	});

	test('caps the number of columns', () => {
		let store = emptyStore(1);
		for (let index = 0; index < WIDGET_COLUMNS_MAX + 5; index += 1) {
			store = addColumn(store, `Column ${index}`, `c${index}`, 1);
		}

		store = save(store, 'c0', 'https://a.example/');
		assert.equal(
			buildWidgetSnapshot(store, OPEN)?.columns.length,
			WIDGET_COLUMNS_MAX,
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
		assert.deepEqual(snapshot?.columns[0]?.links, [
			{
				title: 'example.org',
				url: 'https://www.example.org/page',
				host: 'example.org',
			},
		]);
	});

	test('drops a deleted column, so a widget showing it finds it gone', () => {
		let store = withColumns('Reading', 'Tools');
		store = save(store, 'reading', 'https://a.example/');
		store = save(store, 'tools', 'https://b.example/');
		store = deleteColumn(store, 'tools', null, 3);
		const snapshot = buildWidgetSnapshot(store, OPEN);
		assert.deepEqual(
			snapshot?.columns.map((column) => column.id),
			['reading'],
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
			['reading', BOOKMARK_UNFILED_ID],
		);
	});
});
