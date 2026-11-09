import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {findDuplicateTabs, reopenOrder} from '../src/app/duplicate-tabs';

type TabInit = Partial<chrome.tabs.Tab> & {id: number};

const tab = (init: TabInit): chrome.tabs.Tab =>
	({
		index: init.id,
		windowId: 1,
		active: false,
		pinned: false,
		lastAccessed: 0,
		url: 'https://a.test/',
		...init,
	}) as chrome.tabs.Tab;

const closedIds = (tabs: chrome.tabs.Tab[]) =>
	findDuplicateTabs(tabs)
		.close.map((entry) => entry.id)
		.toSorted((a, b) => a - b);

test('keeps the most recently used copy and closes the others', () => {
	const result = findDuplicateTabs([
		tab({id: 1, lastAccessed: 100}),
		tab({id: 2, lastAccessed: 300}),
		tab({id: 3, lastAccessed: 200}),
	]);
	assert.deepEqual(
		result.close.map((entry) => entry.id).toSorted((a, b) => a - b),
		[1, 3],
	);
});

test('different addresses are not duplicates, including a different fragment or query', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, url: 'https://a.test/page'}),
			tab({id: 2, url: 'https://a.test/page#top'}),
			tab({id: 3, url: 'https://a.test/page?x=1'}),
			tab({id: 4, url: 'https://b.test/page'}),
		]),
		[],
	);
});

test('compares canonical addresses', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, url: 'https://A.test', lastAccessed: 2}),
			tab({id: 2, url: 'https://a.test/', lastAccessed: 1}),
		]),
		[2],
	);
});

test('never closes pinned or active tabs', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, pinned: true, lastAccessed: 1}),
			tab({id: 2, lastAccessed: 5}),
			tab({id: 3, active: true, windowId: 2, lastAccessed: 2}),
			tab({id: 4, lastAccessed: 3}),
		]),
		[2, 4],
	);
});

test('a protected copy counts as the one to keep, even when an unprotected copy is newer', () => {
	const result = findDuplicateTabs([
		tab({id: 1, pinned: true, lastAccessed: 1}),
		tab({id: 2, lastAccessed: 900}),
	]);
	assert.deepEqual(
		result.close.map((entry) => entry.id),
		[2],
	);
});

test('spans windows', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, windowId: 1, lastAccessed: 1}),
			tab({id: 2, windowId: 2, lastAccessed: 2}),
		]),
		[1],
	);
});

test('ignores browser pages, extension pages, and tabs without an address', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, url: 'chrome://extensions/'}),
			tab({id: 2, url: 'chrome://extensions/'}),
			tab({id: 3, url: 'chrome-extension://abc/newtab.html'}),
			tab({id: 4, url: 'chrome-extension://abc/newtab.html'}),
			tab({id: 5, url: undefined}),
			tab({id: 6, url: undefined}),
		]),
		[],
	);
});

test('falls back to the higher tab id when lastAccessed is missing or tied', () => {
	assert.deepEqual(
		closedIds([
			tab({id: 1, lastAccessed: undefined}),
			tab({id: 2, lastAccessed: undefined}),
		]),
		[1],
	);
});

test('reopenOrder puts tabs back window by window, left to right', () => {
	const ordered = reopenOrder([
		{url: 'u', windowId: 2, index: 0},
		{url: 'u', windowId: 1, index: 5},
		{url: 'u', windowId: 1, index: 2},
	]);
	assert.deepEqual(
		ordered.map((entry) => `${entry.windowId}:${entry.index}`),
		['1:2', '1:5', '2:0'],
	);
});
