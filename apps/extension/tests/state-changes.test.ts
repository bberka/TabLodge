import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {normalizeStore} from '../src/shared/library-normalize';
import {
	applyStateChanges,
	createChangeLog,
	type StateChange,
} from '../src/shared/state-changes';
import {library} from './library-memory';

const held = () => ({...normalizeStore(library(3, 3)), revision: 'a'});

const change = (
	from: string,
	to: string,
	extra: Partial<StateChange> = {},
): StateChange => {
	const {folders, bookmarkColumns, settings} = held();
	return {
		from,
		to,
		folders,
		bookmarkColumns,
		settings,
		updatedAt: 1,
		sessions: {changed: [], removed: []},
		bookmarks: {changed: []},
		...extra,
	};
};

test('the log returns the chain between two revisions, and nothing across a gap', () => {
	const log = createChangeLog();
	log.add(change('a', 'b'));
	log.add(change('b', 'c'));
	log.add(change('d', 'e'));
	assert.deepEqual(
		log.since('a', 'c')?.map((item) => item.to),
		['b', 'c'],
	);
	assert.deepEqual(log.since('c', 'c'), []);
	assert.equal(log.since('a', 'e'), undefined);
	log.clear();
	assert.equal(log.since('a', 'c'), undefined);
});

test('a commit that never landed is skipped by the chain', () => {
	const log = createChangeLog();
	log.add(change('a', 'lost'));
	log.add(change('a', 'b'));
	assert.deepEqual(
		log.since('a', 'b')?.map((item) => item.to),
		['b'],
	);
});

test('a change replaces and removes sessions and keeps the others as they were', () => {
	const before = held();
	const renamed = {...before.groups[1], name: 'Renamed'};
	const next = applyStateChanges(before, [
		change('a', 'b', {
			sessions: {changed: [renamed], removed: [before.groups[2].id]},
		}),
	])!;
	assert.deepEqual(next.groups, [before.groups[0], renamed]);
	assert.equal(next.groups[0], before.groups[0]);
	assert.equal(next.bookmarks, before.bookmarks);
	assert.equal(next.revision, 'b');
});

test('a change that does not fit the held library is refused', () => {
	const before = held();
	assert.equal(applyStateChanges(before, [change('z', 'b')]), undefined);
	assert.equal(
		applyStateChanges(before, [
			change('a', 'b', {
				bookmarks: {changed: [{...before.bookmarks[0], id: 'unknown'}]},
			}),
		]),
		undefined,
	);
	assert.equal(
		applyStateChanges(before, [
			change('a', 'b', {
				bookmarks: {patch: {length: 9, head: 0, tail: 0, middle: []}},
			}),
		]),
		undefined,
	);
});
