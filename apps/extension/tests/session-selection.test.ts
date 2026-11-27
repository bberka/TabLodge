import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import type {Session} from '../src/shared/types';
import {
	groupSelectedTabs,
	parseSelectedTabKey,
	pruneGroupIdSet,
	pruneSelectedTabKeys,
	selectedSessions,
} from '../src/app/session-selection';

function makeSession(id: string, tabIds: string[]): Session {
	return {
		id,
		name: `Session ${id}`,
		description: '',
		folderId: 'unfiled',
		createdAt: 1,
		updatedAt: 1,
		sourceWindowName: 'Window 1',
		sourceWindowId: 1,
		tabs: tabIds.map((tabId, index) => ({
			id: tabId,
			title: `Tab ${tabId}`,
			url: `https://example.com/${tabId}`,
			pinned: false,
			notes: '',
			nativeGroup: null,
			savedAt: 1,
			originalIndex: index,
		})),
	};
}

test('parseSelectedTabKey decodes valid keys and rejects malformed ones', () => {
	assert.deepEqual(parseSelectedTabKey('["s1","t1"]'), ['s1', 't1']);
	assert.equal(parseSelectedTabKey('not-json'), null);
	assert.equal(parseSelectedTabKey('["only-one"]'), null);
	assert.equal(parseSelectedTabKey('[1,2]'), null);
});

test('groupSelectedTabs groups valid keys by session id', () => {
	const grouped = groupSelectedTabs(
		new Set(['["s1","t1"]', '["s1","t2"]', '["s2","t9"]', 'bad']),
	);
	assert.deepEqual([...grouped.keys()], ['s1', 's2']);
	assert.deepEqual([...(grouped.get('s1') ?? [])], ['t1', 't2']);
	assert.deepEqual([...(grouped.get('s2') ?? [])], ['t9']);
});

test('selectedSessions returns empty array when nothing is selected and filters matching tabs', () => {
	const groups = [makeSession('s1', ['t1', 't2']), makeSession('s2', ['t3'])];
	assert.deepEqual(selectedSessions(groups, new Map()), []);

	const byGroup = groupSelectedTabs(new Set(['["s1","t2"]', '["s2","t99"]']));
	const result = selectedSessions(groups, byGroup);
	assert.equal(result.length, 1);
	assert.equal(result[0].id, 's1');
	assert.deepEqual(
		result[0].tabs.map((tab) => tab.id),
		['t2'],
	);
});

test('pruneGroupIdSet keeps the same reference when nothing needs pruning', () => {
	const empty = new Set<string>();
	assert.equal(pruneGroupIdSet(empty, new Set(['s1'])), empty);

	const unchanged = new Set(['s1']);
	assert.equal(pruneGroupIdSet(unchanged, new Set(['s1', 's2'])), unchanged);

	const pruned = pruneGroupIdSet(new Set(['s1', 'gone']), new Set(['s1']));
	assert.deepEqual([...pruned], ['s1']);
});

test('pruneSelectedTabKeys keeps reference when empty or valid and drops removed tabs', () => {
	const groups = [makeSession('s1', ['t1', 't2']), makeSession('s2', ['t3'])];

	const empty = new Set<string>();
	assert.equal(pruneSelectedTabKeys(empty, groups), empty);

	const valid = new Set(['["s1","t1"]', '["s2","t3"]']);
	assert.equal(pruneSelectedTabKeys(valid, groups), valid);

	const mixed = new Set([
		'["s1","t1"]',
		'["s1","removed"]',
		'["gone","t1"]',
		'bad',
	]);
	const pruned = pruneSelectedTabKeys(mixed, groups);
	assert.deepEqual([...pruned], ['["s1","t1"]']);
});
