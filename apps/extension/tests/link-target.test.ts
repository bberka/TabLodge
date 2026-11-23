import assert from 'node:assert/strict';
import {afterEach, test, vi} from 'vite-plus/test';
import type {BookmarkClickAction, Settings} from '../src/shared/types';

type Calls = {created: unknown[]; updated: unknown[]; assigned: string[]};
const calls: Calls = {created: [], updated: [], assigned: []};

async function load() {
	vi.resetModules();
	calls.created = [];
	calls.updated = [];
	calls.assigned = [];
	vi.stubGlobal('chrome', {
		runtime: {getURL: () => 'chrome-extension://abc/'},
		tabs: {
			async create(options: unknown) {
				calls.created.push(options);
			},
			async update(id: number, options: unknown) {
				calls.updated.push({id, ...(options as object)});
			},
			async query() {
				return [{id: 7, pinned: false}];
			},
			async getCurrent() {
				return {pinned: false};
			},
		},
		windows: {async update() {}},
	});
	vi.stubGlobal('location', {
		assign(url: string) {
			calls.assigned.push(url);
		},
	});
	return import('../src/app/link-target');
}

afterEach(() => {
	vi.unstubAllGlobals();
});

function settings(
	bookmarkClickAction: BookmarkClickAction,
	sessionLinkClickAction: 'none' | 'current' | 'new',
	strip = false,
) {
	return {
		bookmarkClickAction,
		sessionLinkClickAction,
		removeTrackingParameters: strip,
		keepLodgePinned: false,
	} as Settings;
}

const tracked = 'https://example.com/a?utm_source=x&id=1';
const clean = 'https://example.com/a?id=1';

test('linkDestination strips tracking parameters only when the setting is on', async () => {
	const {linkDestination} = await load();
	assert.equal(linkDestination(tracked, settings('new', 'new', true)), clean);
	assert.equal(linkDestination(tracked, settings('new', 'new')), tracked);
});

test('dashboard rule: each bookmark and saved tab setting value', async () => {
	const {resolveLinkTarget} = await load();
	for (const value of ['none', 'current', 'new', 'menu'] as const) {
		assert.equal(resolveLinkTarget('bookmark', settings(value, 'new')), value);
	}

	for (const value of ['none', 'current', 'new'] as const) {
		assert.equal(
			resolveLinkTarget('session', settings('current', value)),
			value,
		);
	}
});

test('side panel rule: menu without a menu opens the current tab', async () => {
	const {resolveLinkTarget} = await load();
	assert.equal(
		resolveLinkTarget('bookmark', settings('menu', 'new'), {canMenu: false}),
		'current',
	);
	assert.equal(
		resolveLinkTarget('bookmark', settings('none', 'new'), {canMenu: false}),
		'none',
	);
});

test('finder rule: menu and none still open a link', async () => {
	const {resolveLinkTarget} = await load();
	const opts = {canMenu: false, canIdle: false};
	assert.equal(
		resolveLinkTarget('bookmark', settings('menu', 'new'), opts),
		'current',
	);
	assert.equal(
		resolveLinkTarget('bookmark', settings('none', 'new'), opts),
		'current',
	);
	assert.equal(
		resolveLinkTarget('bookmark', settings('new', 'new'), opts),
		'new',
	);
	assert.equal(
		resolveLinkTarget('session', settings('current', 'none'), opts),
		'new',
	);
	assert.equal(
		resolveLinkTarget('session', settings('current', 'current'), opts),
		'current',
	);
	assert.equal(
		resolveLinkTarget('session', settings('current', 'new'), opts),
		'new',
	);
});

test('an explicit choice beats every setting', async () => {
	const {resolveLinkTarget} = await load();
	assert.equal(
		resolveLinkTarget('bookmark', settings('none', 'none'), {
			requested: 'new',
			canIdle: false,
		}),
		'new',
	);
});

test('finder (palette) opens a bookmark by its setting and strips parameters', async () => {
	const {openLink} = await load();
	await openLink(
		tracked,
		'bookmark',
		settings('new', 'new', true),
		undefined,
		{windowId: 1},
		false,
	);
	assert.deepEqual(calls.created, [{url: clean, windowId: 1}]);
	await openLink(
		tracked,
		'bookmark',
		settings('current', 'new'),
		undefined,
		{windowId: 1},
		false,
	);
	assert.deepEqual(calls.updated, [{id: 7, url: tracked, active: true}]);
});

test('finder opens a saved tab on Enter even when its setting is none or menu', async () => {
	const {openLink} = await load();
	await openLink(
		tracked,
		'session',
		settings('menu', 'none'),
		undefined,
		{windowId: 1},
		false,
	);
	assert.deepEqual(calls.created, [{url: tracked, windowId: 1}]);
	await openLink(
		tracked,
		'bookmark',
		settings('menu', 'none'),
		undefined,
		{windowId: 1},
		false,
	);
	assert.equal(calls.updated.length, 1);
});

test('dashboard click does nothing for none and opens the current tab for menu fallback', async () => {
	const {openLink} = await load();
	await openLink(tracked, 'session', settings('current', 'none'));
	await openLink(tracked, 'bookmark', settings('none', 'new'));
	assert.deepEqual(calls.created, []);
	assert.deepEqual(calls.assigned, []);
	await openLink(tracked, 'bookmark', settings('menu', 'new'));
	assert.deepEqual(calls.assigned, [tracked]);
});
