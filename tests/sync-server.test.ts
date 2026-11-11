import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createApi, type Limits} from '../server/src/api';
import {isAuthMessage, sameToken} from '../server/src/live';
import {sqlite} from '../server/src/node-sqlite';
import {SqlChangeLog} from '../server/src/sql-change-log';
import type {SyncChange} from '../src/shared/sync/changes';
import {startClock, tick} from '../src/shared/sync/clock';

const TOKEN = 'test-token-0123456789-abcdefghijklmnop';
const T0 = Date.UTC(2026, 10, 1);

function server(limits?: Partial<Limits>) {
	const applied: number[] = [];
	const log = new SqlChangeLog(sqlite(':memory:'));
	const app = createApi({
		token: TOKEN,
		log: () => log,
		limits,
		now: () => T0,
		onApplied(cursor) {
			applied.push(cursor);
		},
	});
	const call = async (path: string, init: RequestInit = {}, token = TOKEN) => {
		const response = await app.request(path, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
		});
		return {
			status: response.status,
			body: (await response.json()) as Record<string, unknown>,
		};
	};

	const push = (changes: unknown[]) =>
		call('/v1/changes', {method: 'POST', body: JSON.stringify({changes})});
	return {app, applied, call, push};
}

const folder = (id: string, offset = 0, value: unknown = id): SyncChange => ({
	kind: 'folder',
	id,
	h: tick(startClock(), T0 + offset).h,
	d: 'device-a',
	value,
});

test('the API refuses a missing or wrong token but answers health checks', async () => {
	const {app, call} = server();
	assert.equal((await app.request('/health')).status, 200);
	assert.equal((await app.request('/v1/status')).status, 401);
	assert.equal((await call('/v1/status', {}, 'wrong')).status, 401);
	assert.equal((await call('/v1/status')).status, 200);
});

test('a pushed change comes back from a pull, and only real changes notify devices', async () => {
	const {applied, call, push} = server();
	const change = folder('f1');
	assert.deepEqual((await push([change])).body, {
		results: ['applied'],
		cursor: 1,
	});
	assert.deepEqual((await push([change])).body, {
		results: ['superseded'],
		cursor: 1,
	});
	assert.deepEqual(applied, [1]);

	assert.deepEqual((await call('/v1/changes?cursor=0')).body, {
		resync: false,
		changes: [change],
		cursor: 1,
		more: false,
		purged: 0,
	});
	assert.deepEqual((await call('/v1/status')).body, {
		protocol: 1,
		cursor: 1,
		records: 1,
		limits: {maxRecords: 500_000, retentionDays: 90},
	});
});

test('a push with a malformed change is refused whole', async () => {
	const {call, push} = server();
	const response = await push([folder('ok'), {kind: 'folder', id: 'bad'}]);
	assert.deepEqual(response, {
		status: 400,
		body: {error: 'bad_change', index: 1},
	});
	assert.equal((await call('/v1/status')).body.cursor, 0);

	assert.equal(
		(await push(Array.from({length: 501}, (_, index) => folder(`f${index}`))))
			.status,
		400,
	);
	assert.equal(
		(await call('/v1/changes', {method: 'POST', body: '{not json'})).body.error,
		'bad_json',
	);
	assert.equal(
		(await push([folder('big', 0, 'x'.repeat(300 * 1024))])).status,
		413,
	);
	assert.equal((await call('/v1/changes?cursor=-1')).status, 400);
	assert.equal((await call('/v1/changes?limit=5000')).status, 400);
});

test('a full library refuses new records but still takes deletes', async () => {
	const {push} = server({maxRecords: 2});
	await push([folder('a'), folder('b')]);
	assert.deepEqual((await push([folder('c')])).body, {
		error: 'quota',
		maxRecords: 2,
	});
	const remove = {...folder('a', 5), deleted: true};
	delete remove.value;
	assert.deepEqual((await push([remove])).body, {
		results: ['applied'],
		cursor: 3,
	});
});

test('the live channel needs the token in its first message', () => {
	assert.ok(isAuthMessage(JSON.stringify({type: 'auth', token: TOKEN}), TOKEN));
	assert.ok(
		!isAuthMessage(JSON.stringify({type: 'auth', token: `${TOKEN}x`}), TOKEN),
	);
	assert.ok(!isAuthMessage(JSON.stringify({type: 'auth'}), TOKEN));
	assert.ok(!isAuthMessage('ping', TOKEN));
	assert.ok(sameToken(TOKEN, TOKEN));
	assert.ok(!sameToken('', TOKEN));
	assert.ok(!sameToken(TOKEN.slice(0, -1), TOKEN));
});

test('the extension can call the server across origins without a host permission', async () => {
	const {app} = server();
	const preflight = await app.request('/v1/changes', {
		method: 'OPTIONS',
		headers: {
			Origin: 'chrome-extension://abc',
			'Access-Control-Request-Method': 'POST',
			'Access-Control-Request-Headers': 'authorization, content-type',
		},
	});
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
	assert.match(
		preflight.headers.get('Access-Control-Allow-Headers') ?? '',
		/Authorization/,
	);
	const refused = await app.request('/v1/status', {
		headers: {Origin: 'chrome-extension://abc'},
	});
	assert.equal(refused.headers.get('Access-Control-Allow-Origin'), '*');
});
