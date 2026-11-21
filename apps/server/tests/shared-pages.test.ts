import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, test} from 'vite-plus/test';
import {unstable_dev, type Unstable_DevWorker} from 'wrangler';
import serverPackage from '../package.json';
import {createApi, DEFAULT_LIMITS, type Limits} from '../src/api';
import {sqlite} from '../src/node-sqlite';
import {SqlChangeLog} from '../src/sql-change-log';
import {SqlPageStore} from '../src/shared-pages';
import {
	newSharedPageId,
	SHARED_PAGE_PASSWORD_HEADER,
} from '../../extension/src/shared/sync/shared-pages';
import {shareHtmlPage} from '../../extension/src/shared/share-formats';
import {refreshLiveSharedPages} from '../../extension/src/shared/live-shared-pages';
import {
	deleteSharedPage,
	listSharedPages,
	sharedPagesSupport,
	updateSharedPage,
	uploadSharedPage,
} from '../../extension/src/shared/sync/shared-pages-client';
import {startClock, tick} from '../../extension/src/shared/sync/clock';

const TOKEN = 'shared-pages-token-0123456789-abcdefghij';
const BASE = 'https://sync.example.test';
const T0 = Date.UTC(2026, 10, 17);
const PAGE = shareHtmlPage(
	'Reading',
	[{name: 'Reading', tabs: [{title: 'Example', url: 'https://example.com/'}]}],
	'TabLodge',
);

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
The Docker server's API with the main library's page store, on a clock the test moves.
*/
function nodeServer(limits?: Partial<Limits>, {pages = true} = {}) {
	const clock = {now: T0};
	const sql = sqlite(':memory:');
	const log = new SqlChangeLog(sql);
	const store = new SqlPageStore(sql);
	const app = createApi({
		token: TOKEN,
		log: () => log,
		pages: pages ? () => store : undefined,
		limits,
		now: () => clock.now,
	});
	const fetch: Fetch = async (url, init) => app.request(url, init);
	return {clock, fetch};
}

const target = {url: BASE, token: TOKEN};
const authorized = (init: RequestInit = {}): RequestInit => ({
	...init,
	headers: {
		Authorization: `Bearer ${TOKEN}`,
		'Content-Type': 'application/json',
	},
});

const pathOf = (url: string) => new URL(url).pathname;

test('an uploaded page is served to anyone at its link, with headers that allow no script', async () => {
	const {fetch} = nodeServer();
	const page = await uploadSharedPage(fetch, target, 'Reading', PAGE);
	assert.match(page.url, /^https:\/\/sync\.example\.test\/p\/[\w-]{22}$/);
	assert.equal(page.size, new TextEncoder().encode(PAGE).length);

	const response = await fetch(`${BASE}${pathOf(page.url)}`);
	assert.equal(response.status, 200);
	assert.equal(await response.text(), PAGE);
	assert.equal(
		response.headers.get('content-type'),
		'text/html; charset=utf-8',
	);
	const csp = response.headers.get('content-security-policy') ?? '';
	assert.match(csp, /default-src 'none'/);
	assert.match(csp, /sandbox allow-popups allow-popups-to-escape-sandbox$/);
	assert.doesNotMatch(csp, /allow-scripts|allow-same-origin|script-src/);
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
	assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
	assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('two uploads of the same page get two links', async () => {
	const {fetch} = nodeServer();
	const first = await uploadSharedPage(fetch, target, 'Reading', PAGE);
	const second = await uploadSharedPage(fetch, target, 'Reading', PAGE);
	assert.notEqual(first.id, second.id);
	assert.equal((await listSharedPages(fetch, target)).length, 2);
});

test('the list needs the token, and a deleted page answers like one that never existed', async () => {
	const {fetch, clock} = nodeServer();
	const older = await uploadSharedPage(fetch, target, 'Older', PAGE);
	clock.now += 1000;
	const newer = await uploadSharedPage(fetch, target, 'Newer', PAGE);
	assert.equal((await fetch(`${BASE}/v1/pages`)).status, 401);
	assert.equal(
		(await fetch(`${BASE}/v1/pages/${older.id}/delete`, {method: 'POST'}))
			.status,
		401,
	);
	assert.deepEqual(
		(await listSharedPages(fetch, target)).map((page) => [
			page.title,
			page.createdAt,
		]),
		[
			['Newer', T0 + 1000],
			['Older', T0],
		],
	);

	await deleteSharedPage(fetch, target, older.id);
	assert.deepEqual(
		(await listSharedPages(fetch, target)).map((page) => page.id),
		[newer.id],
	);
	const gone = await fetch(`${BASE}${pathOf(older.url)}`);
	const unknown = await fetch(`${BASE}/p/AAAAAAAAAAAAAAAAAAAAAA`);
	const malformed = await fetch(`${BASE}/p/..%2Fv1%2Fstatus`);
	for (const response of [gone, unknown, malformed]) {
		assert.equal(response.status, 404);
		assert.equal(await response.text(), 'Not found');
		assert.equal(response.headers.get('cache-control'), 'no-store');
	}

	// Deleting it again is not an error.
	await deleteSharedPage(fetch, target, older.id);
});

test('page views have their own allowance, so visitors cannot slow down sync', async () => {
	const {fetch, clock} = nodeServer({
		pageViewsPerMinute: 3,
		requestsPerMinute: 5,
	});
	const page = await uploadSharedPage(fetch, target, 'Reading', PAGE);
	const view = async () => (await fetch(`${BASE}${pathOf(page.url)}`)).status;
	assert.deepEqual(
		[await view(), await view(), await view(), await view()],
		[200, 200, 200, 429],
	);
	// Unknown ids count too, so guessing does not get around it.
	assert.equal((await fetch(`${BASE}/p/AAAAAAAAAAAAAAAAAAAAAA`)).status, 429);
	assert.ok(
		Number(
			(await fetch(`${BASE}${pathOf(page.url)}`)).headers.get('retry-after'),
		) > 0,
	);

	const status = await fetch(`${BASE}/v1/status`, authorized());
	assert.equal(status.status, 200);

	clock.now += 60_000;
	assert.equal(await view(), 200);
});

test('a page over the size cap and pages over the budget are refused', async () => {
	const {fetch} = nodeServer({
		maxPageBytes: 2000,
		maxPages: 3,
		maxPageStorageBytes: 5000,
	});
	// Each "é" is two bytes, so the cap counts bytes, not characters.
	const large = `<p>${'é'.repeat(1000)}</p>`;
	await assert.rejects(
		uploadSharedPage(fetch, target, 'Large', large),
		/too large/,
	);
	const response = await fetch(
		`${BASE}/v1/pages`,
		authorized({
			method: 'POST',
			body: JSON.stringify({title: 'x', html: large}),
		}),
	);
	assert.equal(response.status, 413);

	const page = `<p>${'a'.repeat(1990)}</p>`;
	await uploadSharedPage(fetch, target, 'One', page);
	await uploadSharedPage(fetch, target, 'Two', page);
	// A third page of this size would take the total over 5000 bytes.
	await assert.rejects(
		uploadSharedPage(fetch, target, 'Three', page),
		/as many shared pages/,
	);
	await uploadSharedPage(fetch, target, 'Small', '<p>a</p>');
	// The fourth page is over the count.
	await assert.rejects(
		uploadSharedPage(fetch, target, 'Tiny', '<p>b</p>'),
		/as many shared pages/,
	);
	assert.equal((await listSharedPages(fetch, target)).length, 3);
});

test('a malformed upload is refused', async () => {
	const {fetch} = nodeServer();
	for (const body of [
		{title: 'x'},
		{title: 'x', html: ''},
		{title: 'x'.repeat(201), html: PAGE},
		{title: 1, html: PAGE},
	]) {
		const response = await fetch(
			`${BASE}/v1/pages`,
			authorized({method: 'POST', body: JSON.stringify(body)}),
		);
		assert.equal(response.status, 400, JSON.stringify(body));
	}
});

test('a device that knows nothing of shared pages syncs as before, and pages never reach the change log', async () => {
	const {fetch} = nodeServer();
	const change = {
		kind: 'folder',
		id: 'f1',
		h: tick(startClock(), T0).h,
		d: 'device-a',
		value: 'f1',
	};
	const pushed = await fetch(
		`${BASE}/v1/changes`,
		authorized({method: 'POST', body: JSON.stringify({changes: [change]})}),
	);
	assert.deepEqual(await pushed.json(), {results: ['applied'], cursor: 1});
	await uploadSharedPage(fetch, target, 'Reading', PAGE);

	const status = (await (
		await fetch(`${BASE}/v1/status`, authorized())
	).json()) as {
		protocol: number;
		cursor: number;
		records: number;
		features: string[];
	};
	assert.equal(status.protocol, 1);
	assert.equal(status.cursor, 1);
	assert.equal(status.records, 1);
	assert.ok(status.features.includes('shared-pages'));
	assert.ok(status.features.includes('trash'));
	const pulled = (await (
		await fetch(`${BASE}/v1/changes?cursor=0`, authorized())
	).json()) as {changes: unknown[]};
	assert.deepEqual(pulled.changes, [change]);
});

test('a page keeps the id and source its device sent, so it can carry its own link', async () => {
	const {fetch} = nodeServer();
	const id = newSharedPageId();
	const page = await uploadSharedPage(fetch, target, 'Reading', PAGE, {
		id,
		source: 'session:s1',
	});
	assert.equal(page.url, `${BASE}/p/${id}`);
	assert.deepEqual(
		(await listSharedPages(fetch, target)).map((entry) => [
			entry.id,
			entry.source,
		]),
		[[id, 'session:s1']],
	);
	const served = await fetch(page.url, {
		headers: {Origin: 'chrome-extension://x'},
	});
	assert.equal(served.status, 200);
	assert.equal(served.headers.get('access-control-allow-origin'), '*');

	await assert.rejects(
		uploadSharedPage(fetch, target, 'Again', PAGE, {id}),
		/already has a page with this link/,
	);
	const post = (body: unknown) =>
		fetch(`${BASE}/v1/pages`, {
			...authorized(),
			method: 'POST',
			body: JSON.stringify(body),
		});
	assert.equal((await post({title: 'x', html: PAGE, id: 'short'})).status, 400);
	assert.equal(
		(await post({title: 'x', html: PAGE, source: 's'.repeat(101)})).status,
		400,
	);
	const plain = await uploadSharedPage(fetch, target, 'Plain', PAGE);
	assert.notEqual(plain.id, id);
	assert.equal(plain.source, '');
});

test('a pages table from before sources upgrades on start and keeps its pages', async () => {
	const sql = sqlite(':memory:');
	sql.all(`CREATE TABLE pages (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		html TEXT NOT NULL,
		size INTEGER NOT NULL,
		created INTEGER NOT NULL
	)`);
	sql.all(
		'INSERT INTO pages (id, title, html, size, created) VALUES (?, ?, ?, ?, ?)',
		'AAAAAAAAAAAAAAAAAAAAAA',
		'Old',
		'<p>old</p>',
		10,
		T0,
	);
	const store = new SqlPageStore(sql);
	assert.deepEqual(store.list(), [
		{
			id: 'AAAAAAAAAAAAAAAAAAAAAA',
			title: 'Old',
			size: 10,
			createdAt: T0,
			updatedAt: T0,
			source: '',
			mode: 'snapshot',
			hasPassword: false,
		},
	]);
	assert.equal(store.html('AAAAAAAAAAAAAAAAAAAAAA'), '<p>old</p>');
	assert.equal(new SqlPageStore(sql).list().length, 1);
});

test('a server without shared pages says so, and has no page routes', async () => {
	const {fetch} = nodeServer(undefined, {pages: false});
	assert.deepEqual(await sharedPagesSupport(fetch, target), {
		server: 'old',
		keepsIds: false,
		supportsLivePassword: false,
	});
	assert.equal((await fetch(`${BASE}/v1/pages`, authorized())).status, 404);
	assert.equal((await fetch(`${BASE}/p/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
	assert.deepEqual(await sharedPagesSupport(nodeServer().fetch, target), {
		server: 'ready',
		keepsIds: true,
		supportsLivePassword: true,
	});
	assert.deepEqual(
		await sharedPagesSupport(async () => {
			throw new TypeError('Failed to fetch');
		}, target),
		{server: 'offline', keepsIds: false, supportsLivePassword: false},
	);
});

test('live links update in place, reject snapshot updates, and stop on delete', async () => {
	const {fetch} = nodeServer();
	const id = newSharedPageId();
	const live = await uploadSharedPage(fetch, target, 'Shop', PAGE, {
		id,
		source: 'column:shop',
		mode: 'live',
	});
	assert.equal(live.mode, 'live');
	assert.equal(live.hasPassword, false);

	const snapshot = await uploadSharedPage(fetch, target, 'Snap', PAGE);
	await assert.rejects(
		updateSharedPage(fetch, target, snapshot.id, 'Snap', '<p>new</p>'),
		/snapshot/,
	);

	const fingerprints = new Map<string, string>();
	const store = {
		bookmarkColumns: [
			{id: 'shop', name: 'Shop', createdAt: T0, isDefault: false},
		],
		bookmarks: [
			{
				id: 'b1',
				title: 'Store A',
				url: 'https://shop.example/a',
				columnId: 'shop',
				order: 0,
				createdAt: T0,
				updatedAt: T0,
			},
			{
				id: 'b2',
				title: 'Store B',
				url: 'https://shop.example/b',
				columnId: 'shop',
				order: 1,
				createdAt: T0,
				updatedAt: T0,
			},
		],
		groups: [],
	};
	assert.equal(
		await refreshLiveSharedPages(
			fetch,
			target,
			store,
			'TabLodge',
			fingerprints,
		),
		1,
	);
	assert.equal(
		await refreshLiveSharedPages(
			fetch,
			target,
			store,
			'TabLodge',
			fingerprints,
		),
		0,
	);
	const body = await (await fetch(`${BASE}${pathOf(live.url)}`)).text();
	assert.match(body, /Store A/);
	assert.match(body, /Store B/);

	await deleteSharedPage(fetch, target, live.id);
	assert.equal((await fetch(`${BASE}${pathOf(live.url)}`)).status, 404);
});

test('password-protected pages hash the password, prompt without links, unlock on POST, and throttle guesses', async () => {
	const sql = sqlite(':memory:');
	const log = new SqlChangeLog(sql);
	const store = new SqlPageStore(sql);
	const api = createApi({
		token: TOKEN,
		log: () => log,
		pages: () => store,
		now: () => T0,
	});
	const fetch: Fetch = async (url, init) => api.fetch(new Request(url, init));

	const page = await uploadSharedPage(fetch, target, 'Secret', PAGE, {
		id: newSharedPageId(),
		source: 'column:secret',
		mode: 'live',
		password: 'correct-horse-battery',
	});
	assert.equal(page.hasPassword, true);
	assert.equal(page.mode, 'live');

	const rawRow = sql.all(
		'SELECT password_hash FROM pages WHERE id = ?',
		page.id,
	)[0];
	const storedHash = String(rawRow?.password_hash ?? '');
	assert.match(storedHash, /^pbkdf2\$100000\$/);
	assert.doesNotMatch(storedHash, /correct-horse-battery/);

	const promptResponse = await fetch(`${BASE}${pathOf(page.url)}`);
	assert.equal(promptResponse.status, 401);
	assert.equal(promptResponse.headers.get(SHARED_PAGE_PASSWORD_HEADER), '1');
	const promptHtml = await promptResponse.text();
	assert.match(promptHtml, /<form method="post"/);
	assert.doesNotMatch(promptHtml, /https:\/\/example\.com/);

	const wrong = await fetch(`${BASE}${pathOf(page.url)}`, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({password: 'wrong-pass'}).toString(),
	});
	assert.equal(wrong.status, 401);
	assert.match(await wrong.text(), /Incorrect password/);

	const unlocked = await fetch(`${BASE}${pathOf(page.url)}`, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({password: 'correct-horse-battery'}).toString(),
	});
	assert.equal(unlocked.status, 200);
	assert.equal(await unlocked.text(), PAGE);
	assert.match(
		unlocked.headers.get('content-security-policy') ?? '',
		/sandbox allow-popups allow-popups-to-escape-sandbox$/,
	);

	const statuses: number[] = [];
	for (let attempt = 0; attempt < 12; attempt += 1) {
		statuses.push(
			(
				await fetch(`${BASE}${pathOf(page.url)}`, {
					method: 'POST',
					headers: {'Content-Type': 'application/x-www-form-urlencoded'},
					body: new URLSearchParams({password: 'wrong'}).toString(),
				})
			).status,
		);
	}

	assert.ok(statuses.includes(429));
});

// The Cloudflare target: the real Worker and Durable Object in workerd, which is where a page is routed before the
// token check and kept out of the private library.
let worker: Unstable_DevWorker;
let state: string;

beforeAll(async () => {
	state = mkdtempSync(join(tmpdir(), 'tablodge-worker-'));
	worker = await unstable_dev(join(import.meta.dirname, '../src/worker.ts'), {
		config: join(import.meta.dirname, '../wrangler.jsonc'),
		vars: {TABLODGE_SYNC_TOKEN: TOKEN},
		persistTo: state,
		logLevel: 'error',
		experimental: {disableExperimentalWarning: true},
	});
}, 60_000);

afterAll(async () => {
	await worker?.stop();
	rmSync(state, {recursive: true, force: true});
});

const workerFetch: Fetch = async (url, init) => {
	const {pathname, search} = new URL(url);
	return worker.fetch(
		`${pathname}${search}`,
		init as Parameters<Unstable_DevWorker['fetch']>[1],
	) as unknown as Response;
};

test('on Cloudflare a page is public, strict, deletable, and absent from the private library', async () => {
	assert.deepEqual(await sharedPagesSupport(workerFetch, target), {
		server: 'ready',
		keepsIds: true,
		supportsLivePassword: true,
	});
	const id = newSharedPageId();
	const page = await uploadSharedPage(workerFetch, target, 'Reading', PAGE, {
		id,
		source: 'column:abc',
	});
	assert.equal(page.id, id);
	assert.deepEqual(
		(await listSharedPages(workerFetch, target)).map((entry) => entry.source),
		['column:abc'],
	);
	const response = await workerFetch(`${BASE}${pathOf(page.url)}`);
	assert.equal(response.status, 200);
	assert.equal(await response.text(), PAGE);
	assert.equal(response.headers.get('access-control-allow-origin'), '*');
	assert.match(
		response.headers.get('content-security-policy') ?? '',
		/sandbox allow-popups allow-popups-to-escape-sandbox$/,
	);
	assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

	const privateTarget = {url: `${BASE}/private`, token: TOKEN};
	assert.equal(
		(await sharedPagesSupport(workerFetch, privateTarget)).server,
		'old',
	);
	assert.equal(
		(await workerFetch(`${BASE}/private/v1/pages`, authorized())).status,
		404,
	);
	assert.equal(
		(await workerFetch(`${BASE}/private${pathOf(page.url)}`)).status,
		401,
	);
	// A request cannot pass itself off as the private library to hide pages, or the other way round.
	const spoofed = await workerFetch(`${BASE}/v1/pages`, {
		headers: {Authorization: `Bearer ${TOKEN}`, 'TabLodge-Library': 'private'},
	});
	assert.equal(spoofed.status, 200);

	const protectedPage = await uploadSharedPage(
		workerFetch,
		target,
		'Locked',
		PAGE,
		{
			id: newSharedPageId(),
			mode: 'live',
			password: 'worker-password-ok',
		},
	);
	assert.equal(protectedPage.hasPassword, true);
	const prompt = await workerFetch(`${BASE}${pathOf(protectedPage.url)}`);
	assert.equal(prompt.status, 401);
	assert.equal(prompt.headers.get(SHARED_PAGE_PASSWORD_HEADER), '1');
	const unlocked = await workerFetch(`${BASE}${pathOf(protectedPage.url)}`, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({password: 'worker-password-ok'}).toString(),
	});
	assert.equal(unlocked.status, 200);
	assert.equal(await unlocked.text(), PAGE);
	await deleteSharedPage(workerFetch, target, protectedPage.id);

	await deleteSharedPage(workerFetch, target, page.id);
	const gone = await workerFetch(`${BASE}${pathOf(page.url)}`);
	assert.equal(gone.status, 404);
	assert.equal(await gone.text(), 'Not found');
	const malformed = await workerFetch(`${BASE}/p/not-an-id`);
	assert.equal(malformed.status, 404);
	assert.equal(await malformed.text(), 'Not found');
}, 30_000);

test('on Cloudflare the size cap and the page budget hold', async () => {
	const big = `<p>${'a'.repeat(DEFAULT_LIMITS.maxPageBytes)}</p>`;
	await assert.rejects(
		uploadSharedPage(workerFetch, target, 'Large', big),
		/too large/,
	);
	const existing = (await listSharedPages(workerFetch, target)).length;
	for (let index = existing; index < DEFAULT_LIMITS.maxPages; index += 1) {
		await uploadSharedPage(workerFetch, target, `Page ${index}`, '<p>a</p>');
	}

	await assert.rejects(
		uploadSharedPage(workerFetch, target, 'One more', '<p>a</p>'),
		/as many shared pages/,
	);
}, 60_000);

test('on Cloudflare page views have their own allowance, and sync keeps answering', async () => {
	const [page] = await listSharedPages(workerFetch, target);
	// Earlier tests used part of this minute's allowance, so it runs out within one allowance.
	const statuses: number[] = [];
	while (
		statuses.at(-1) !== 429 &&
		statuses.length <= DEFAULT_LIMITS.pageViewsPerMinute
	) {
		statuses.push((await workerFetch(`${BASE}${pathOf(page.url)}`)).status);
	}

	assert.equal(statuses.at(-1), 429);
	assert.ok(statuses.slice(0, -1).every((status) => status === 200));
	const status = await workerFetch(`${BASE}/v1/status`, authorized());
	assert.equal(status.status, 200);
	// The same version the Docker server reports, from the same package.json.
	assert.equal(
		((await status.json()) as {version?: unknown}).version,
		serverPackage.version,
	);
}, 60_000);
