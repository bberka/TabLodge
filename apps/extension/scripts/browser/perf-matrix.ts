import process from 'node:process';
import {chromium} from 'playwright';
import {createScenario, type Scenario} from './perf-fixture.ts';


export const SCENARIOS: Record<string, Scenario> = {
	'col1-100': {bookmarks: 100, columns: 1},
	'col1-1000': {bookmarks: 1000, columns: 1},
	'col1-10000': {bookmarks: 10_000, columns: 1},
	'cols100x100-board': {columns: 100, perColumn: 100, view: 'board'},
	'cols100x100-focus': {columns: 100, perColumn: 100, view: 'focus'},
	'sessions-100': {sessions: 100, columns: 1},
	'sessions-1000': {sessions: 1000, columns: 1},
	'sessions-10000': {sessions: 10_000, columns: 1},
	'oneSession-100': {sessions: 1, tabsPerSession: 100, columns: 1},
	'oneSession-1000': {sessions: 1, tabsPerSession: 1000, columns: 1},
	'oneSession-10000': {sessions: 1, tabsPerSession: 10_000, columns: 1},
	'folders-100': {sessions: 300, folders: 100, columns: 1},
};

const [endpoint, name, extra] = process.argv.slice(2);
const spec = SCENARIOS[name];
if (!spec) {
	throw new Error(`Unknown scenario ${name}`);
}

const edges: string[] = [];
const row: Record<string, unknown> = {scenario: name};
const round = (value: number) => Math.round(value * 10) / 10;
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const findWorker = () =>
	context.serviceWorkers().find((w) => w.url().endsWith('/service-worker.js'));
let worker = findWorker();
const origin = `chrome-extension://${new URL(worker.url()).hostname}`;

async function restartWorker() {
	const cdp = await browser.newBrowserCDPSession();
	const {targetInfos} = await cdp.send('Target.getTargets');
	const target = targetInfos.find((info) =>
		info.url.endsWith('/service-worker.js'),
	);
	if (target) {
		await cdp.send('Target.closeTarget', {targetId: target.targetId});
	}

	await cdp.detach();
}

async function step<T>(label: string, work: () => Promise<T>, ms = 120_000) {
	const started = Date.now();
	try {
		const result = await Promise.race([
			work(),
			new Promise((_, reject) => {
				setTimeout(
					() => reject(new Error(`timed out after ${ms / 1000}s`)),
					ms,
				);
			}),
		]);
		row[`${label}Ms`] = Date.now() - started;
		return result as T;
	} catch (error) {
		edges.push(
			`${label}: ${String(error?.message ?? error)
				.split('\n', 1)[0]
				.slice(0, 160)}`,
		);
		row[`${label}Ms`] = `FAILED after ${Date.now() - started}`;
		return undefined;
	}
}

const page = await context.newPage();
const consoleErrors: string[] = [];
page.on('pageerror', (error) =>
	consoleErrors.push(
		`pageerror: ${error.message.slice(0, 120)} @ ${String(error.stack).split('\n').slice(1, 3).join(' | ').slice(0, 200)}`,
	),
);
page.on('crash', () => edges.push('page crashed'));
await page.addInitScript(() => {
	const tasks = [];
	globalThis.__longTasks = tasks;
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			tasks.push(entry.duration);
		}
	}).observe({type: 'longtask', buffered: true});
});

const send = (message) =>
	page.evaluate(async (m) => {
		const start = performance.now();
		const response = await chrome.runtime.sendMessage(m);
		return {ms: performance.now() - start, response};
	}, message);

await page.goto(`${origin}/newtab.html`);
const base = (await send({type: 'GET_STATE'})).response;
const {ok: _ok, ...store} = base;
const library = createScenario(store, spec);
row.bookmarks = library.bookmarks.length;
row.columns = library.bookmarkColumns.length;
row.sessions = library.groups.length;
row.tabs = library.groups.reduce((sum, g) => sum + g.tabs.length, 0);
row.folders = library.folders.length;
row.libraryKB = Math.round(JSON.stringify(library).length / 1024);
await step('seedStorage', () =>
	page.evaluate(async (data) => {
		await chrome.storage.local.clear();
		await chrome.storage.local.set({'tablodge.state': data});
	}, library),
);
await restartWorker();
await page.reload().catch(() => {});

const migrated = await step('migrateOnFirstEdit', () =>
	send({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: library.bookmarks[0]?.id ?? 'none',
		fields: {notes: 'warm'},
	}),
);
if (library.bookmarks.length === 0) {
	await step('migrateOnFirstEdit', () =>
		send({
			type: 'UPDATE_GROUP',
			groupId: library.groups[0].id,
			fields: {name: 'warm'},
		}),
	);
}

await page.waitForTimeout(2000);
worker = findWorker() ?? (await context.waitForEvent('serviceworker'));
row.layout = await worker.evaluate(
	async () =>
		(await chrome.storage.local.get(['tablodge.state']))['tablodge.state']
			?.layout,
);
row.storageKeys = await worker.evaluate(
	async () => Object.keys(await chrome.storage.local.get(null)).length,
);
row.storageBytes = await worker.evaluate(() =>
	chrome.storage.local.getBytesInUse(null),
);

const state = await step('getState', () => send({type: 'GET_STATE'}));
if (state) {
	row.getStateKB = Math.round(JSON.stringify(state.response).length / 1024);
}

const readySelector =
	library.bookmarks.length > 0
		? '[data-bookmark-id]'
		: 'article[id^="session-"]';
await page.goto('about:blank');
const loadStarted = Date.now();
await page.goto(`${origin}/newtab.html`, {waitUntil: 'commit'}).catch(() => {});
const ready = await step(
	'loadUntilVisible',
	async () => {
		await page.waitForSelector(readySelector, {timeout: 90_000});
		return true;
	},
	95_000,
);
if (ready) {
	await page.waitForTimeout(1500);
	const detail = await page.evaluate(() => {
		const tasks = globalThis.__longTasks ?? [];
		const paint = performance
			.getEntriesByType('paint')
			.find((e) => e.name === 'first-contentful-paint');
		return {
			fcpMs: Math.round(paint?.startTime ?? 0),
			longTaskMs: Math.round(tasks.reduce((s, t) => s + t, 0)),
			longestTaskMs: Math.round(Math.max(0, ...tasks)),
			domNodes: document.querySelectorAll('*').length,
			bookmarkRows: document.querySelectorAll('[data-bookmark-id]').length,
			sessionCards: document.querySelectorAll('article[id^="session-"]').length,
			tabRows: document.querySelectorAll('[data-tab-id]').length,
			columnSections: document.querySelectorAll('section[data-column-id]')
				.length,
			heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1_048_576),
		};
	});
	Object.assign(row, detail);
	row.wallToVisibleMs = Date.now() - loadStarted;
}

if (library.groups.length > 0) {
	await page.evaluate(() => {
		globalThis.__longTasks.length = 0;
	});
	const expandStarted = Date.now();
	await step('expandFirstSession', async () => {
		await page
			.locator('article[id^="session-"] button[aria-expanded="false"]')
			.first()
			.click({timeout: 20_000});
		await page.waitForSelector('[data-tab-id]', {timeout: 60_000});
	});
	await page.waitForTimeout(1500);
	row.expandedTabRows = await page.evaluate(
		() => document.querySelectorAll('[data-tab-id]').length,
	);
	row.expandedDomNodes = await page.evaluate(
		() => document.querySelectorAll('*').length,
	);
	row.expandLongTaskMs = await page.evaluate(() =>
		Math.round(globalThis.__longTasks.reduce((s, t) => s + t, 0)),
	);
	row.expandWallMs = Date.now() - expandStarted;
}

row.folderListShown = await page.evaluate(() =>
	Boolean(
		[...document.querySelectorAll('button')].find(
			(b) => b.getAttribute('aria-label') === 'Switch to folder chips',
		),
	),
);

await worker.evaluate(() => {
	const area = chrome.storage.local;
	const stats = {sets: 0, chars: 0, keys: 0, biggest: 0};
	globalThis.__perf = stats;
	const original = area.set;
	globalThis.__perfRestore = () => {
		area.set = original;
	};

	area.set = (items, ...rest) => {
		stats.sets += 1;
		for (const value of Object.values(items)) {
			const size = JSON.stringify(value).length;
			stats.chars += size;
			stats.keys += 1;
			stats.biggest = Math.max(stats.biggest, size);
		}

		return original.call(area, items, ...rest);
	};
});
await page.evaluate(() => {
	globalThis.__longTasks.length = 0;
});
const editMessage =
	library.bookmarks.length > 0
		? {
				type: 'UPDATE_BOOKMARK',
				bookmarkId: library.bookmarks[5 % library.bookmarks.length].id,
				fields: {notes: `edit ${Date.now()}`},
			}
		: {
				type: 'UPDATE_GROUP',
				groupId: library.groups[0].id,
				fields: {name: `edit ${Date.now()}`},
			};
await step('editRoundTrip', () => send(editMessage));
await page.waitForTimeout(2500);
row.afterEditLongTaskMs = await page.evaluate(() =>
	Math.round(globalThis.__longTasks.reduce((s, t) => s + t, 0)),
);
const traffic = await worker.evaluate(() => {
	globalThis.__perfRestore();
	return globalThis.__perf;
});
row.editStorage = `${traffic.sets} sets, ${traffic.keys} keys, ${Math.round(traffic.chars / 1024)} KB, biggest value ${Math.round(traffic.biggest / 1024)} KB`;

const visibleName = `visible ${Date.now()}`;
await step('editUntilShownOnPage', async () => {
	await send(
		library.bookmarks.length > 0
			? {
					type: 'UPDATE_BOOKMARK',
					bookmarkId: library.bookmarks[0].id,
					fields: {title: visibleName},
				}
			: {
					type: 'UPDATE_GROUP',
					groupId: library.groups[0].id,
					fields: {name: visibleName},
				},
	);
	await page.getByText(visibleName).first().waitFor({timeout: 90_000});
});

await restartWorker();
await step('firstEditAfterWorkerRestart', () =>
	send({...editMessage, fields: {...editMessage.fields}}),
);

const typing = await page.evaluate(
	async (label) => {
		document.querySelector(`[aria-label="${CSS.escape(label)}"]`)?.click();
		await new Promise((r) => setTimeout(r, 300));
		const input = document.querySelector(
			`input[aria-label="${CSS.escape(label)}"], input[placeholder*="earch"]`,
		);
		if (!input) {
			return undefined;
		}

		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			'value',
		).set;
		input.focus();
		const times = [];
		let value = '';
		for (const letter of 'guide 1') {
			value += letter;
			const start = performance.now();
			setter.call(input, value);
			input.dispatchEvent(new Event('input', {bubbles: true}));
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
			times.push(performance.now() - start);
		}

		return times;
	},
	library.bookmarks.length > 0
		? 'Search bookmarks'
		: 'Search sessions and tabs',
);
if (typing) {
	const sorted = [...typing].sort((a, b) => a - b);
	row.searchKeystrokeMedianMs = round(sorted[Math.floor(sorted.length / 2)]);
	row.searchKeystrokeMaxMs = round(sorted.at(-1));
} else {
	edges.push('search input not found');
}

const backup = await step(
	'fullBackup',
	() => send({type: 'GET_FULL_BACKUP'}),
	180_000,
);
if (backup?.response) {
	row.fullBackupKB = Math.round(JSON.stringify(backup.response).length / 1024);
}

row.consoleErrors = consoleErrors.slice(0, 3);
row.edges = edges;
console.log(JSON.stringify(row));
await page.close().catch(() => {});
await browser.close();
