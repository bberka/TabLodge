import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	bookmarkDeleteQuestion,
	columnDeleteQuestion,
	sessionDeleteQuestion,
} from '../src/shared/delete-question';

const session = (name: string, links: number) => ({
	name,
	tabs: Array.from({length: links}),
});

describe('what the delete question names', () => {
	test('one bookmark by its title, or its address without one', () => {
		assert.equal(
			bookmarkDeleteQuestion([{title: 'Docs', url: 'https://a.test/'}]).title,
			'Delete bookmark “Docs”?',
		);
		assert.equal(
			bookmarkDeleteQuestion([{title: '', url: 'https://a.test/'}]).title,
			'Delete bookmark “https://a.test/”?',
		);
	});

	test('several bookmarks by their count', () => {
		const bookmark = {title: 'x', url: 'https://a.test/'};
		assert.equal(
			bookmarkDeleteQuestion([bookmark, bookmark, bookmark]).title,
			'Delete 3 bookmarks?',
		);
	});

	test('a session by its name and links', () => {
		assert.deepEqual(sessionDeleteQuestion([session('Work', 1)]), {
			title: 'Delete session “Work”?',
			description: 'It has 1 link. You can undo this right after.',
		});
	});

	test('several sessions by their count and all their links', () => {
		assert.deepEqual(
			sessionDeleteQuestion([session('A', 2), session('B', 3)]),
			{
				title: 'Delete 2 sessions?',
				description: 'They have 5 links. You can undo this right after.',
			},
		);
	});

	test('a column says where its bookmarks go', () => {
		assert.deepEqual(columnDeleteQuestion('Read', 2, 'Inbox'), {
			title: 'Delete column “Read”?',
			description:
				'Its 2 bookmarks move to “Inbox”. You can undo this right after.',
		});
		assert.equal(
			columnDeleteQuestion('Read', 1).description,
			'Its 1 bookmark moves to Unfiled. You can undo this right after.',
		);
		assert.equal(
			columnDeleteQuestion('Read', 0, 'Inbox').description,
			'It has no bookmarks. You can undo this right after.',
		);
	});

	test('a very long name is cut so the question fits a screen', () => {
		const {title} = sessionDeleteQuestion([session('n'.repeat(500), 1)]);
		assert.equal(title, `Delete session “${'n'.repeat(79)}…”?`);
	});
});
