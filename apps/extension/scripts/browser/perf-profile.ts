import process from 'node:process';
import {chromium, type Page, type Worker} from 'playwright';
import type {DevStore} from '../../src/shared/dev-fixture.ts';
import {createLargeLibrary} from './perf-fixture.ts';

const [endpoint, countArgument, runsArgument] = process.argv.slice(2);
const count = Number(countArgument ?? 600);
const runs = Number(runsArgument ?? 3);

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const findWorker = () =>
	context
		.serviceWorkers()
		.find((candidate) => candidate.url().endsWith('/service-worker.js'));
let worker = findWorker()!;
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

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value: number) => Math.round(value * 10) / 10;

async function send(page: Page, message: Record<string, unknown>) {
	return page.evaluate(async (m) => {
		const start = performance.now();
		const response = await chrome.runtime.sendMessage(m);
		return {ms: performance.now() - start, response};
	}, message);
}

async function seed(page: Page) {
	await page.goto(`${origin}/newtab.html`);
	const state = (await send(page, {type: 'GET_STATE'})).response as DevStore & {
		ok: boolean;
	};
	const {ok: _ok, ...store} = state;
	await page.evaluate(
		async (library) => {
			await chrome.storage.local.clear();
			await chrome.storage.local.set({'tablodge.state': library});
		},
		createLargeLibrary(store, count),
	);
	await restartWorker();
	await page.reload();
	await send(page, {
		type: 'UPDATE_BOOKMARK',
		bookmarkId: 'perf-bookmark-0',
		fields: {notes: 'warm'},
	});
	await page.waitForTimeout(1500);
	worker = findWorker() ?? (await context.waitForEvent('serviceworker'));
}

async function loadMetrics(page: Page, path: string) {
	await page.goto('about:blank');
	const started = Date.now();
	await page.goto(`${origin}/${path}`, {waitUntil: 'commit'});
	await page.waitForSelector('[data-bookmark-id]', {timeout: 60_000});
	const wallToBookmarks = Date.now() - started;
	await page.waitForTimeout(1500);
	const detail = await page.evaluate(() => {
		const paint = performance.getEntriesByType('paint');
		const longTasks = (globalThis as unknown as {__longTasks: number[]})
			.__longTasks;
		return {
			fcp:
				paint.find((entry) => entry.name === 'first-contentful-paint')
					?.startTime ?? 0,
			longTaskMs: longTasks.reduce((sum, task) => sum + task, 0),
			longestTaskMs: Math.max(0, ...longTasks),
			domNodes: document.querySelectorAll('*').length,
			bookmarkNodes: document.querySelectorAll('[data-bookmark-id]').length,
		};
	});
	return {wallToBookmarks, ...detail};
}

const page = await context.newPage();
await page.addInitScript(() => {
	const tasks: number[] = [];
	(globalThis as unknown as {__longTasks: number[]}).__longTasks = tasks;
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			tasks.push(entry.duration);
		}
	}).observe({type: 'longtask', buffered: true});
});
await seed(page);
const layout = await worker.evaluate(
	async () =>
		(await chrome.storage.local.get(['tablodge.state']))['tablodge.state']
			?.layout,
);
console.error('layout', layout);

const results: Record<string, unknown> = {bookmarks: count};
const state = await send(page, {type: 'GET_STATE'});
results.getStateColdMs = round(state.ms);
const warm = [];
for (let i = 0; i < 5; i++) {
	warm.push((await send(page, {type: 'GET_STATE'})).ms);
}

results.getStateWarmMs = round(median(warm));
results.getStateKB = Math.round(JSON.stringify(state.response).length / 1024);

const loads = [];
for (let i = 0; i < runs; i++) {
	loads.push(await loadMetrics(page, 'newtab.html'));
}

results.loadWallMs = round(median(loads.map((l) => l.wallToBookmarks)));
results.fcpMs = round(median(loads.map((l) => l.fcp)));
results.longTaskTotalMs = round(median(loads.map((l) => l.longTaskMs)));
results.longestTaskMs = round(median(loads.map((l) => l.longestTaskMs)));
results.domNodes = loads[0].domNodes;
results.bookmarkNodes = loads[0].bookmarkNodes;

await worker.evaluate(() => {
	const area = chrome.storage.local as unknown as Record<string, unknown>;
	const g = globalThis as unknown as {__perf: {sets: number; chars: number}};
	g.__perf = {sets: 0, chars: 0};
	const original = area.set as (...a: unknown[]) => unknown;
	(globalThis as unknown as {__perfRestore: () => void}).__perfRestore = () => {
		area.set = original;
	};

	area.set = (items: unknown, ...rest: unknown[]) => {
		g.__perf.sets += 1;
		g.__perf.chars += JSON.stringify(items).length;
		return original.call(area, items, ...rest);
	};
});
const edits = [];
for (let i = 0; i < runs; i++) {
	edits.push(
		(
			await send(page, {
				type: 'UPDATE_BOOKMARK',
				bookmarkId: `perf-bookmark-${i + 1}`,
				fields: {notes: `edit ${i}`},
			})
		).ms,
	);
}

const traffic = await worker.evaluate(() => {
	(globalThis as unknown as {__perfRestore: () => void}).__perfRestore();
	return (globalThis as unknown as {__perf: unknown}).__perf;
});
results.editRoundTripMs = round(median(edits));
results.editStorageWrites = traffic;
results.editStorageKBPerEdit = Math.round(
	(traffic as {chars: number}).chars / runs / 1024,
);

const rerender = [];
for (let i = 0; i < runs; i++) {
	await page.evaluate(() => {
		(globalThis as unknown as {__longTasks: number[]}).__longTasks.length = 0;
	});
	await send(page, {
		type: 'UPDATE_BOOKMARK',
		bookmarkId: `perf-bookmark-${i + 20}`,
		fields: {notes: `rerender ${i}`},
	});
	await page.waitForTimeout(1500);
	rerender.push(
		await page.evaluate(() =>
			(globalThis as unknown as {__longTasks: number[]}).__longTasks.reduce(
				(sum, task) => sum + task,
				0,
			),
		),
	);
}

results.afterEditLongTaskMs = round(median(rerender));

const drag = await page.evaluate(async () => {
	const cards = [...document.querySelectorAll('[data-bookmark-id]')];
	const transfer = new DataTransfer();
	cards[0].dispatchEvent(
		new DragEvent('dragstart', {bubbles: true, dataTransfer: transfer}),
	);
	const times = [];
	for (const card of cards.slice(1, 25)) {
		const start = performance.now();
		const box = card.getBoundingClientRect();
		card.dispatchEvent(
			new DragEvent('dragover', {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
				clientX: box.left + 5,
				clientY: box.top + 5,
			}),
		);
		await new Promise((resolve) => {
			requestAnimationFrame(() => setTimeout(resolve, 0));
		});
		times.push(performance.now() - start);
	}

	cards[0].dispatchEvent(
		new DragEvent('dragend', {bubbles: true, dataTransfer: transfer}),
	);
	return times;
});
results.dragOverMedianMs = round(median(drag));
results.dragOverMaxMs = round(Math.max(...drag));

const menu = await page.evaluate(async () => {
	const times = [];
	const cards = [...document.querySelectorAll('[data-bookmark-id]')];
	for (const card of cards.slice(2, 7)) {
		const start = performance.now();
		card.dispatchEvent(
			new MouseEvent('contextmenu', {bubbles: true, cancelable: true}),
		);
		await new Promise((resolve) => {
			requestAnimationFrame(() => setTimeout(resolve, 0));
		});
		times.push(performance.now() - start);
		document.dispatchEvent(
			new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
		);
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}

	return times;
});
results.contextMenuMedianMs = round(median(menu));

const typing = await page.evaluate(async () => {
	const button = document.querySelector<HTMLElement>(
		'[aria-label="Search bookmarks"]',
	);
	button?.click();
	await new Promise((resolve) => setTimeout(resolve, 200));
	const input = document.querySelector<HTMLInputElement>(
		'input[aria-label="Search bookmarks"], input[type="search"], input[placeholder*="earch"]',
	);
	if (!input) {
		return {error: 'no search input'};
	}

	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		'value',
	)!.set!;
	input.focus();
	const times: number[] = [];
	let value = '';
	for (const letter of 'performance guide') {
		value += letter;
		const start = performance.now();
		setter.call(input, value);
		input.dispatchEvent(new Event('input', {bubbles: true}));
		await new Promise((resolve) =>
			requestAnimationFrame(() => setTimeout(resolve, 0)),
		);
		times.push(performance.now() - start);
	}

	return {times};
});
if ('times' in typing && typing.times) {
	results.searchKeystrokeMedianMs = round(median(typing.times));
	results.searchKeystrokeMaxMs = round(Math.max(...typing.times));
} else {
	results.search = typing;
}

console.log(JSON.stringify(results, null, 2));
await page.close();
await browser.close();
