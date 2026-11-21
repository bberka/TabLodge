import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	bookmarkDuplicates,
	defaultTargetSession,
	duplicateFilter,
	sessionDuplicates,
} from '../src/shared/save-rules';
import {
	duplicatesNote,
	saveMessage,
	saveOutcomeOf,
} from '../src/shared/save-feedback';

const tab = (url: string) => ({url});

describe('duplicate rule', () => {
	test('into an existing container, what it holds is always a duplicate', () => {
		for (const handling of ['allow', 'reject'] as const) {
			const filter = duplicateFilter(handling, {
				inside: ['https://a.example/'],
				elsewhere: [],
			});
			assert.equal(filter.isDuplicate('https://a.example/'), true);
			assert.equal(filter.isDuplicate('https://b.example/'), false);
			filter.saved('https://b.example/');
			assert.equal(filter.isDuplicate('https://b.example/'), true);
		}
	});

	test('elsewhere is a duplicate only when duplicates are rejected', () => {
		const scope = {inside: [], elsewhere: ['https://a.example/']};
		assert.equal(
			duplicateFilter('allow', scope).isDuplicate('https://a.example/'),
			false,
		);
		assert.equal(
			duplicateFilter('reject', scope).isDuplicate('https://a.example/'),
			true,
		);
	});

	test('a new session lets a repeat in one batch through only when allowed', () => {
		const allowed = duplicateFilter('allow', {elsewhere: []});
		allowed.saved('https://a.example/');
		assert.equal(allowed.isDuplicate('https://a.example/'), false);
		const rejected = duplicateFilter('reject', {elsewhere: []});
		rejected.saved('https://a.example/');
		assert.equal(rejected.isDuplicate('https://a.example/'), true);
	});

	test('sessions: the target session is "inside", every other session is "elsewhere"', () => {
		const sessions = [
			{id: 'a', tabs: [tab('https://a.example/')]},
			{id: 'b', tabs: [tab('https://b.example/')]},
		] as never;
		const allow = sessionDuplicates(sessions, 'a', 'allow');
		assert.equal(allow.isDuplicate('https://a.example/'), true);
		assert.equal(allow.isDuplicate('https://b.example/'), false);
		const reject = sessionDuplicates(sessions, 'a', 'reject');
		assert.equal(reject.isDuplicate('https://b.example/'), true);
		const fresh = sessionDuplicates(sessions, undefined, 'allow');
		assert.equal(fresh.isDuplicate('https://a.example/'), false);
	});

	test('bookmarks: the target column is "inside", every other column is "elsewhere"', () => {
		const bookmarks = [
			{url: 'https://a.example/', columnId: 'one'},
			{url: 'https://b.example/', columnId: 'two'},
		];
		const allow = bookmarkDuplicates(bookmarks, 'one', 'allow');
		assert.equal(allow.isDuplicate('https://a.example/'), true);
		assert.equal(allow.isDuplicate('https://b.example/'), false);
		const reject = bookmarkDuplicates(bookmarks, 'one', 'reject');
		assert.equal(reject.isDuplicate('https://b.example/'), true);
	});
});

describe('default target session', () => {
	const folders = [
		{id: 'unfiled', name: 'Unfiled'},
		{id: 'old', name: 'Archived'},
	];

	test('is the most recently updated session outside the Archived folder', () => {
		const sessions = [
			{id: 'x', folderId: 'old', updatedAt: 900},
			{id: 'y', folderId: 'unfiled', updatedAt: 10},
			{id: 'z', folderId: 'unfiled', updatedAt: 20},
		];
		assert.equal(defaultTargetSession(sessions, folders)?.id, 'z');
	});

	test('is nothing when every session is archived', () => {
		assert.equal(
			defaultTargetSession([{folderId: 'old', updatedAt: 1}], folders),
			undefined,
		);
	});
});

describe('save feedback', () => {
	test('one wording for success, a skipped duplicate, and failure', () => {
		assert.equal(
			saveMessage({kind: 'saved', count: 3, skipped: 0, noun: 'tab'}),
			'Saved 3 tabs.',
		);
		assert.equal(
			saveMessage({
				kind: 'saved',
				count: 1,
				skipped: 2,
				noun: 'bookmark',
				into: '“Reading”',
			}),
			'Saved 1 bookmark to “Reading”. 2 duplicates not saved.',
		);
		assert.equal(
			saveMessage({
				kind: 'saved',
				count: 2,
				skipped: 0,
				noun: 'tab',
				closed: true,
			}),
			'Saved 2 tabs and closed them.',
		);
		assert.equal(
			saveMessage({kind: 'duplicate', skipped: 1, noun: 'tab'}),
			'Nothing saved. 1 duplicate not saved.',
		);
		assert.equal(saveMessage({kind: 'failed', error: 'Nope.'}), 'Nope.');
		assert.equal(duplicatesNote(0), '');
	});

	test('a save that stored nothing and skipped duplicates is never a success', () => {
		assert.equal(
			saveOutcomeOf({ok: true, count: 0, skipped: 2}, 'tab').kind,
			'duplicate',
		);
		assert.equal(
			saveOutcomeOf({ok: true, count: 0, skipped: 0}, 'tab').kind,
			'failed',
		);
		assert.equal(
			saveOutcomeOf({ok: true, count: 1, skipped: 1}, 'tab').kind,
			'saved',
		);
		assert.equal(saveOutcomeOf({ok: false, error: 'x'}, 'tab').kind, 'failed');
	});
});
