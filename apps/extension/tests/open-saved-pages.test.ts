import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {test} from 'vite-plus/test';
import {
	openSavedPagesStatus,
	openSavedPageTabs,
	SAVED_PAGES_GROUP_TITLE,
	savedPagesPlan,
	skippedSourcesHint,
	type OpenSavedPagesBrowser,
} from '../src/app/open-saved-pages';
import {
	SITE_SOURCES,
	siteSourceById,
	siteSourceForUrl,
	type SiteSourceId,
} from '../src/app/site-sources';
import type {SavedPageReader} from '../src/app/source-catch-up';
import {readGithubSavedPage} from '../src/app/source-github';
import {readInstagramSavedPage} from '../src/app/source-instagram';
import {readRedditSavedPage} from '../src/app/source-reddit';
import {readTwitterSavedPage} from '../src/app/source-x';
import {readYoutubeSavedPage} from '../src/app/source-youtube';
import type {SiteSourceStatus} from '../src/shared/types';

const READERS: Partial<Record<SiteSourceId, SavedPageReader>> = {
	youtube: readYoutubeSavedPage,
	reddit: readRedditSavedPage,
	x: readTwitterSavedPage,
	instagram: readInstagramSavedPage,
	github: readGithubSavedPage,
};

function documentAt(
	url: string,
	html = '<html><head></head><body></body></html>',
) {
	const {document} = parseHTML(html);
	Object.defineProperty(document, 'location', {value: new URL(url)});
	return document;
}

const statusOf = (
	id: SiteSourceId,
	overrides: Partial<SiteSourceStatus> = {},
): SiteSourceStatus => ({
	id,
	enabled: true,
	wanted: true,
	...overrides,
});

test('every source with a savedPageUrl is accepted by its catch-up reader and matches its own site', () => {
	const withUrl = SITE_SOURCES.filter((source) => source.savedPageUrl);
	assert.deepEqual(
		withUrl.map((source) => source.id),
		['youtube', 'reddit', 'x', 'github'],
	);

	for (const source of withUrl) {
		const url = source.savedPageUrl!;
		assert.equal(siteSourceForUrl(url)?.id, source.id, source.id);
		const reader = READERS[source.id];
		assert.ok(reader, `${source.id} has a saved page reader`);
		const html =
			source.id === 'github'
				? '<html><head><meta name="user-login" content="octo"></head><body></body></html>'
				: '<html><body></body></html>';
		assert.ok(
			Array.isArray(reader(documentAt(url, html))),
			`${source.id} reader accepts ${url}`,
		);
	}
});

test('instagram is marked as needing a username and sources without readers have neither flag', () => {
	const instagram = siteSourceById('instagram')!;
	assert.equal(instagram.savedPageUrl, undefined);
	assert.equal(instagram.savedPageNeedsUsername, true);

	for (const source of SITE_SOURCES) {
		if (Object.hasOwn(READERS, source.id)) {
			continue;
		}

		assert.equal(source.savedPageUrl, undefined, source.id);
		assert.equal(source.savedPageNeedsUsername, undefined, source.id);
	}
});

test('savedPagesPlan includes only enabled sources with readers and separates skipped username-dependent sources', () => {
	const statuses: SiteSourceStatus[] = [
		statusOf('youtube'),
		statusOf('reddit', {enabled: false, notice: 'revoked'}),
		statusOf('x', {enabled: false, wanted: true}),
		statusOf('github'),
		statusOf('instagram'),
		statusOf('spotify'),
		statusOf('hackernews', {enabled: false, wanted: false}),
	];

	const plan = savedPagesPlan(SITE_SOURCES, statuses);
	assert.deepEqual(
		plan.openable.map((source) => source.id),
		['youtube', 'github'],
	);
	assert.deepEqual(
		plan.skipped.map((source) => source.id),
		['instagram'],
	);
	assert.equal(
		skippedSourcesHint(plan.skipped),
		'Skips Instagram saved (saved page URL includes your username).',
	);
});

test('savedPagesPlan returns empty lists when statuses are not loaded or nothing is enabled', () => {
	assert.deepEqual(savedPagesPlan(SITE_SOURCES, undefined), {
		openable: [],
		skipped: [],
	});
	assert.deepEqual(
		savedPagesPlan(SITE_SOURCES, [
			statusOf('spotify'),
			statusOf('youtube', {enabled: false}),
		]),
		{openable: [], skipped: []},
	);
});

test('openSavedPageTabs opens background tabs in the current window and groups multiple tabs', async () => {
	const created: chrome.tabs.CreateProperties[] = [];
	const groupedCalls: chrome.tabs.GroupOptions[] = [];
	const updatedGroups: Array<[number, chrome.tabGroups.UpdateProperties]> = [];
	let nextTabId = 10;

	const browser: OpenSavedPagesBrowser = {
		windows: {
			getCurrent: async () => ({id: 7}) as chrome.windows.Window,
		},
		permissions: {
			contains: async () => true,
		},
		tabs: {
			async create(properties) {
				created.push(properties);
				return {id: nextTabId++} as chrome.tabs.Tab;
			},
			async group(options) {
				groupedCalls.push(options);
				return 42;
			},
		},
		tabGroups: {
			async update(groupId, properties) {
				updatedGroups.push([groupId, properties]);
				return {id: groupId} as chrome.tabGroups.TabGroup;
			},
		},
	};

	const youtube = siteSourceById('youtube')!;
	const x = siteSourceById('x')!;
	const result = await openSavedPageTabs([youtube, x], {group: true, browser});

	assert.deepEqual(
		result.opened.map((source) => source.id),
		['youtube', 'x'],
	);
	assert.deepEqual(result.failed, []);
	assert.deepEqual(result.tabIds, [10, 11]);
	assert.equal(result.grouped, true);
	assert.deepEqual(created, [
		{
			url: 'https://www.youtube.com/playlist?list=WL',
			active: false,
			windowId: 7,
		},
		{url: 'https://x.com/i/bookmarks', active: false, windowId: 7},
	]);
	assert.deepEqual(groupedCalls, [
		{tabIds: [10, 11], createProperties: {windowId: 7}},
	]);
	assert.deepEqual(updatedGroups, [[42, {title: SAVED_PAGES_GROUP_TITLE}]]);
});

test('openSavedPageTabs skips sources without host permission and tolerates missing or failing tab groups', async () => {
	const created: string[] = [];
	const browser: OpenSavedPagesBrowser = {
		permissions: {
			contains: async ({origins}) =>
				origins?.includes('https://www.youtube.com/*') ?? false,
		},
		tabs: {
			async create(properties) {
				created.push(properties.url ?? '');
				return {id: created.length} as chrome.tabs.Tab;
			},
		},
	};

	const result = await openSavedPageTabs(
		[siteSourceById('youtube')!, siteSourceById('github')!],
		{group: true, browser},
	);
	assert.deepEqual(
		result.opened.map((source) => source.id),
		['youtube'],
	);
	assert.deepEqual(created, ['https://www.youtube.com/playlist?list=WL']);
	assert.equal(result.grouped, false);
});

test('openSavedPageTabs does not group a single tab even when group is true', async () => {
	let groupCalled = false;
	const browser: OpenSavedPagesBrowser = {
		tabs: {
			create: async () => ({id: 1}) as chrome.tabs.Tab,
			async group() {
				groupCalled = true;
				return 1;
			},
		},
	};

	const result = await openSavedPageTabs([siteSourceById('github')!], {
		group: true,
		browser,
	});
	assert.equal(result.opened.length, 1);
	assert.equal(result.grouped, false);
	assert.equal(groupCalled, false);
});

test('openSavedPagesStatus reports opened, skipped, and failed sources clearly', () => {
	const youtube = siteSourceById('youtube')!;
	const github = siteSourceById('github')!;
	const instagram = siteSourceById('instagram')!;

	assert.deepEqual(
		openSavedPagesStatus({opened: [youtube], skipped: [], failed: []}),
		{
			text: 'Opened YouTube Watch later in a background tab.',
			isError: false,
		},
	);
	assert.deepEqual(
		openSavedPagesStatus({
			opened: [youtube, github],
			skipped: [instagram],
			failed: [],
		}),
		{
			text: 'Opened 2 saved pages in background tabs. Skipped Instagram saved (saved page URL includes your username).',
			isError: false,
		},
	);
	assert.deepEqual(
		openSavedPagesStatus({opened: [], skipped: [instagram], failed: []}),
		{
			text: 'Nothing to open. Skipped Instagram saved (saved page URL includes your username).',
			isError: false,
		},
	);
	assert.deepEqual(
		openSavedPagesStatus({opened: [], skipped: [], failed: [youtube]}),
		{
			text: 'Could not open YouTube Watch later.',
			isError: true,
		},
	);
});
