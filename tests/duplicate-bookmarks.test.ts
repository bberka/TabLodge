import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	findDuplicateBookmarks,
	removalIds,
} from '../src/app/duplicate-bookmarks';

const bookmark = (
	id: string,
	url: string,
	createdAt: number,
	columnId = 'a',
) => ({id, title: id, url, columnId, createdAt, updatedAt: createdAt});

test('finds nothing when every address is saved once', () => {
	assert.deepEqual(
		findDuplicateBookmarks([
			bookmark('1', 'https://a.test/', 1),
			bookmark('2', 'https://a.test/?x=1', 2),
		]),
		[],
	);
});

test('groups copies across columns in board order and keeps the oldest by default', () => {
	const groups = findDuplicateBookmarks([
		bookmark('new', 'https://a.test/', 30, 'x'),
		bookmark('other', 'https://b.test/', 5),
		bookmark('old', 'https://a.test/', 10, 'y'),
		bookmark('mid', 'https://a.test/', 20, 'x'),
		bookmark('solo', 'https://c.test/', 1),
	]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].url, 'https://a.test/');
	assert.deepEqual(
		groups[0].copies.map((copy) => copy.id),
		['new', 'old', 'mid'],
	);
	assert.equal(groups[0].keepId, 'old');
});

test('an equal creation time keeps the copy that comes first on the board', () => {
	const [group] = findDuplicateBookmarks([
		bookmark('first', 'https://a.test/', 7),
		bookmark('second', 'https://a.test/', 7),
	]);
	assert.equal(group.keepId, 'first');
});

test('matches the canonical address that saving uses', () => {
	const groups = findDuplicateBookmarks([
		bookmark('1', 'https://A.test', 1),
		bookmark('2', 'https://a.test/', 2),
	]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].url, 'https://a.test/');
});

test('removalIds lists every copy except the chosen one in each group', () => {
	const groups = findDuplicateBookmarks([
		bookmark('1', 'https://a.test/', 1),
		bookmark('2', 'https://a.test/', 2),
		bookmark('3', 'https://a.test/', 3),
		bookmark('4', 'https://b.test/', 4),
		bookmark('5', 'https://b.test/', 5),
	]);
	assert.deepEqual(removalIds(groups, new Map()), ['2', '3', '5']);
	assert.deepEqual(removalIds(groups, new Map([['https://a.test/', '3']])), [
		'1',
		'2',
		'5',
	]);
});

test('handles a large board', () => {
	const many = Array.from({length: 20_000}, (_, index) =>
		bookmark(`b${index}`, `https://site${index % 10_000}.test/`, index),
	);
	const groups = findDuplicateBookmarks(many);
	assert.equal(groups.length, 10_000);
	assert.equal(removalIds(groups, new Map()).length, 10_000);
});
