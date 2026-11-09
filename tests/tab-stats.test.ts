import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	estimateTabMemoryMb,
	idleText,
	leastRecentlyUsedTabs,
	memoryEstimateText,
	savedStats,
} from '../src/app/tab-stats';

test('counts sessions, saved tabs and the largest session', () => {
	assert.deepEqual(
		savedStats([{tabs: [{}, {}, {}]}, {tabs: []}, {tabs: [{}]}]),
		{sessions: 3, tabs: 4, largest: 3},
	);
	assert.deepEqual(savedStats([]), {sessions: 0, tabs: 0, largest: 0});
});

test('lists open tabs from the longest untouched', () => {
	const tabs = [
		{id: 1, title: 'New', lastAccessed: 300},
		{id: 2, title: 'Old', lastAccessed: 100},
		{id: 3, title: 'Middle', lastAccessed: 200},
	];
	assert.deepEqual(
		leastRecentlyUsedTabs(tabs, 2).map((tab) => tab.id),
		[2, 3],
	);
	assert.deepEqual(
		tabs.map((tab) => tab.id),
		[1, 2, 3],
		'does not reorder the input',
	);
});

test('skips tabs with no access time and the active tab', () => {
	const tabs = [
		{id: 1, title: 'Unknown'},
		{id: 2, title: 'Active', lastAccessed: 1, active: true},
		{id: 3, title: 'Seen', lastAccessed: 50},
	];
	assert.deepEqual(
		leastRecentlyUsedTabs(tabs, 5).map((tab) => tab.id),
		[3],
	);
});

test('estimates memory from loaded tabs only', () => {
	assert.equal(estimateTabMemoryMb(0, 0), 0);
	assert.equal(estimateTabMemoryMb(10, 0), 1000);
	assert.equal(estimateTabMemoryMb(10, 4), 600 + 4 * 5);
});

test('words the estimate as a rough figure', () => {
	assert.equal(memoryEstimateText(0), '0 MB');
	assert.equal(memoryEstimateText(620), 'about 600 MB');
	assert.equal(memoryEstimateText(1500), 'about 1.5 GB');
});

test('says how long ago a tab was used', () => {
	const now = 10 * 86_400_000;
	assert.equal(idleText(now, now - 20_000), 'just now');
	assert.equal(idleText(now, now - 60_000), '1 minute ago');
	assert.equal(idleText(now, now - 3 * 3_600_000), '3 hours ago');
	assert.equal(idleText(now, now - 4 * 86_400_000), '4 days ago');
	assert.equal(idleText(now, now + 5000), 'just now');
});
