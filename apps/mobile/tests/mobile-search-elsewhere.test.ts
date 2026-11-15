import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {jumpFor, searchElsewhere} from '../src/library/search-elsewhere';
import {addBookmark, addColumn, emptyStore} from '../src/library/library';
import type {Store} from '../../extension/src/shared/types';

const NOW = 1000;

function library(): Store {
	let store = emptyStore(NOW);
	store = addColumn(store, 'Cooking', 'cook', NOW);
	store = addBookmark(
		store,
		{
			url: 'https://recipes.example/risotto',
			title: 'Risotto',
			columnId: 'cook',
		},
		'b1',
		NOW,
	);
	return {
		...store,
		folders: [{id: 'f1', name: 'Trips', createdAt: NOW} as never],
		groups: [
			{
				id: 's1',
				name: 'Lisbon trip',
				description: '',
				folderId: 'f1',
				createdAt: NOW,
				updatedAt: NOW,
				tabs: [
					{
						id: 't1',
						url: 'https://tram.example/28',
						title: 'Tram 28 timetable',
						notes: '',
					},
				],
			} as never,
		],
	};
}

const itemsOf = (sections: ReturnType<typeof searchElsewhere>) =>
	sections.flatMap((section) => section.items.map((item) => item.id));

describe('search elsewhere', () => {
	test('Bookmarks also finds sessions and the tabs saved in them', () => {
		const found = itemsOf(searchElsewhere(library(), 'tram', 'bookmarks'));
		assert.deepEqual(found, ['saved-tab:s1:t1']);
		assert.ok(
			itemsOf(searchElsewhere(library(), 'lisbon', 'bookmarks')).includes(
				'session:s1',
			),
		);
	});

	test('Sessions also finds bookmarks and columns, ranked fuzzily', () => {
		const found = itemsOf(searchElsewhere(library(), 'risto', 'sessions'));
		assert.deepEqual(found, ['bookmark:b1']);
		assert.ok(
			itemsOf(searchElsewhere(library(), 'cook', 'sessions')).includes(
				'column:cook',
			),
		);
	});

	test('never repeats the screen it came from, the web, or an address', () => {
		const sections = searchElsewhere(
			library(),
			'https://tram.example',
			'bookmarks',
		);
		assert.ok(
			sections.every((section) =>
				['session', 'saved-tab'].includes(section.kind),
			),
		);
		assert.deepEqual(searchElsewhere(library(), '  ', 'sessions'), []);
	});

	test('a session or column result jumps, a link result does not', () => {
		const sessions = searchElsewhere(library(), 'lisbon', 'bookmarks');
		const session = sessions
			.flatMap((s) => s.items)
			.find((i) => i.kind === 'session');
		assert.deepEqual(session && jumpFor(session), {
			screen: 'sessions',
			sessionId: 's1',
		});
		const column = searchElsewhere(library(), 'cook', 'sessions')
			.flatMap((s) => s.items)
			.find((i) => i.kind === 'column');
		assert.deepEqual(column && jumpFor(column), {
			screen: 'bookmarks',
			columnId: 'cook',
		});
		const link = searchElsewhere(library(), 'tram', 'bookmarks')[0].items[0];
		assert.equal(jumpFor(link), undefined);
	});
});
