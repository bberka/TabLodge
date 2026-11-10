// Loads dist/tablodge-firefox in a headless Firefox and exercises the core workflows through the extension's own
// message protocol: every page opens, a window is saved as a session and restored (order, pinned tab, tab group),
// a bookmark is added, a full backup is exported, and sessions and bookmarks survive a browser restart.
//
//   vp run build && vp run browser:firefox
//
// Needs Firefox; see scripts/firefox-driver.ts for how it is found and how the add-on is installed.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {By, until} from 'selenium-webdriver';
import type * as Firefox from 'selenium-webdriver/firefox.js';
import {
	evaluateInPage,
	launchFirefox,
	openExtensionPage,
} from './firefox-driver.ts';

const PAGES = [
	'newtab.html',
	'popup.html',
	'options.html',
	'help.html',
	'sidepanel.html',
	'name-session.html',
	'add-bookmark.html',
	'palette.html',
];

type Reply = {ok: boolean; error?: string};

const server = createServer((request, response) => {
	response.setHeader('content-type', 'text/html');
	response.end(
		`<!doctype html><title>Page ${request.url}</title><h1>${request.url}</h1>`,
	);
});
await new Promise<void>((resolve) => {
	server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const profile = await mkdtemp(join(tmpdir(), 'tablodge-firefox-'));
let driver: Firefox.Driver | undefined;
let steps = 0;
const pass = (message: string) => {
	console.log(`ok   ${message}`);
	steps++;
};

async function launch() {
	driver = (await launchFirefox(profile, true)).driver;
	await openPage('options.html');
}

const openPage = async (page: string) => {
	assert.ok(driver);
	await openExtensionPage(driver, page);
};

const evaluate = async <T>(body: string) => {
	assert.ok(driver);
	return evaluateInPage<T>(driver, body);
};

const send = async <T = Reply>(type: string, payload: object = {}) =>
	evaluate<T>(
		`return await chrome.runtime.sendMessage(${JSON.stringify({type, ...payload})});`,
	);

type SavedTab = {url: string; pinned?: boolean};
type State = {
	ok: true;
	groups: Array<{id: string; tabs: SavedTab[]}>;
	bookmarks: Array<{url: string}>;
	bookmarkColumns: Array<{id: string}>;
	settings: Record<string, unknown>;
};
const getState = async () => send<State>('GET_STATE');

try {
	await launch();

	for (const page of PAGES) {
		await openPage(page);
		const root = await driver!.wait(
			until.elementLocated(By.css('#root')),
			10_000,
			`${page} has no #root`,
		);
		await driver!.wait(
			async () => ((await root.getAttribute('innerHTML')) ?? '').length > 0,
			10_000,
			`${page} rendered nothing`,
		);
		assert.equal((await getState()).ok, true);
	}

	pass(`all ${PAGES.length} extension pages render and reach the worker`);

	// A window with a pinned tab and a two-tab group, saved and restored.
	await openPage('options.html');
	await evaluate(`
		const win = await chrome.windows.create({url: '${origin}/one', focused: true});
		const two = await chrome.tabs.create({windowId: win.id, url: '${origin}/two'});
		const three = await chrome.tabs.create({windowId: win.id, url: '${origin}/three'});
		const [first] = await chrome.tabs.query({windowId: win.id});
		await chrome.tabs.update(first.id, {pinned: true});
		const group = await chrome.tabs.group({tabIds: [two.id, three.id], createProperties: {windowId: win.id}});
		await chrome.tabGroups.update(group, {title: 'Docs', color: 'blue'});
		await new Promise((resolve) => setTimeout(resolve, 1500));
	`);
	await send('UPDATE_SETTINGS', {
		settings: {includePinnedTabs: true, closeOnSave: true},
	});
	const saved = await send('SAVE_TABS', {scope: 'all-windows'});
	assert.equal(saved.ok, true, saved.error);
	const session = (await getState()).groups[0];
	assert.deepEqual(
		session.tabs.map((tab) => tab.url),
		[`${origin}/one`, `${origin}/two`, `${origin}/three`],
	);
	pass('saved a window with a pinned tab and a tab group as a session');

	const restored = await send('RESTORE_GROUP', {
		groupId: session.id,
		restoreTarget: 'always-new-window',
		restoreMode: 'keep',
	});
	assert.equal(restored.ok, true, restored.error);
	await driver!.sleep(1500);
	const windows = await evaluate<
		Array<Array<{url: string; pinned: boolean; groupId: number}>>
	>(`
		const windows = await chrome.windows.getAll({populate: true});
		return windows.map((win) => win.tabs.map(({url, pinned, groupId}) => ({url, pinned, groupId})));
	`);
	const restoredWindow = windows.find((tabs) =>
		tabs.some((tab) => tab.url === `${origin}/one`),
	);
	assert.deepEqual(
		restoredWindow?.map((tab) => tab.url),
		[`${origin}/one`, `${origin}/two`, `${origin}/three`],
		'tabs reopen in order and the blank start tab is gone',
	);
	assert.equal(restoredWindow?.[0].pinned, true);
	assert.equal(restoredWindow?.[1].groupId, restoredWindow?.[2].groupId);
	assert.notEqual(restoredWindow?.[1].groupId, -1);
	pass('restored the session into a new window with order, pin, and group');

	const first = (await getState()).bookmarkColumns[0];
	const added = await send('ADD_BOOKMARK', {
		bookmark: {
			title: 'Example',
			url: 'https://example.com/',
			columnId: first.id,
		},
	});
	assert.equal(added.ok, true, added.error);
	pass('added a bookmark');

	// The locked area keeps its key in session storage and its idle timer in an alarm, which both browsers must honor.
	const made = await send('LOCKED_SETUP', {
		kind: 'password',
		value: 'correct horse battery',
	});
	assert.equal(made.ok, true, made.error);
	const hidden = await send('LOCKED_ADD', {
		bookmarks: [{title: 'Zebra diary', url: 'https://zebra-diary.example/'}],
	});
	assert.equal(hidden.ok, true, hidden.error);
	assert.equal(
		JSON.stringify(await getState()).includes('zebra'),
		false,
		'locked bookmarks stay out of the library',
	);
	pass(
		'set up the locked area and saved a bookmark into it, out of the library',
	);

	const imported = await send('IMPORT_BROWSER_BOOKMARKS');
	assert.equal(imported.ok, true, imported.error);
	const backup = await send('GET_FULL_BACKUP');
	assert.equal(backup.ok, true, backup.error);
	pass('imported the browser bookmarks and exported a full backup');

	// Firefox cannot open the toolbar button's side panel, so the button keeps its popup.
	await send('UPDATE_SETTINGS', {settings: {actionMode: 'sidepanel'}});
	const popup = await evaluate<string>(
		'return await chrome.action.getPopup({});',
	);
	assert.ok(popup.endsWith('popup.html'), popup);
	await send('UPDATE_SETTINGS', {settings: {actionMode: 'popup'}});
	pass('the toolbar button keeps its popup for the side panel mode');

	await driver!.quit();
	driver = undefined;
	await launch();
	const after = await getState();
	assert.ok(after.groups.some((group) => group.tabs.length === 3));
	assert.ok(
		after.bookmarks.some((bookmark) => bookmark.url === 'https://example.com/'),
	);
	pass('sessions and bookmarks persist across a browser restart');
	const closed = await send('LOCKED_LIST');
	assert.equal(closed.ok, false, 'a browser restart locks the locked area');
	const opened = await send('LOCKED_UNLOCK', {
		credential: 'correct horse battery',
	});
	assert.equal(opened.ok, true, opened.error);
	const kept = await send<{bookmarks: Array<{title: string}>}>('LOCKED_LIST');
	assert.equal(kept.bookmarks[0].title, 'Zebra diary');
	pass(
		'the locked area is locked after a browser restart and unlocks with its password',
	);

	console.log(`Firefox smoke check passed (${steps} steps).`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	await driver?.quit().catch(() => undefined);
	server.close();
	await rm(profile, {recursive: true, force: true});
}
