import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	createPrivateLock,
	generateDataKey,
	importDataKey,
	isSealed,
	LOCK_ACTIVITY_KEY,
	LOCK_RECORD_KEY,
	LOCK_SESSION_KEY,
	openValue,
	parseLockRecord,
	PrivateLockError,
	readStored,
	sealValue,
	unwrapDataKey,
	wrapDataKey,
	type LockEnv,
	type LockRecord,
} from '../src/app/private-lock';

const PREFIX = 'tablodge.private.';
const CONFIG_KEY = `${PREFIX}config`;
const password = {kind: 'password', value: 'correct horse battery'} as const;

/**
Two in-memory storage areas and a clock, shaped like chrome.storage.local and chrome.storage.session.
`failSetAfter` lets that many local writes through, then every later one throws: the browser stopping mid pass.
*/
function createEnv(seed: Record<string, unknown> = {}) {
	const local = new Map<string, unknown>(Object.entries(structuredClone(seed)));
	const session = new Map<string, unknown>();
	const clock = {now: 1_000_000};
	const control = {failSetAfter: Infinity, localSets: 0};
	const area = (store: Map<string, unknown>, counted: boolean) => ({
		async get(keys: string[] | null) {
			const wanted = keys ?? [...store.keys()];
			return Object.fromEntries(
				wanted
					.filter((key) => store.has(key))
					.map((key) => [key, structuredClone(store.get(key))]),
			);
		},
		async set(values: Record<string, unknown>) {
			if (counted) {
				if (control.localSets >= control.failSetAfter) {
					throw new Error('storage stopped');
				}

				control.localSets += 1;
			}

			for (const [key, value] of Object.entries(values)) {
				store.set(key, structuredClone(value));
			}
		},
		async remove(keys: string | string[]) {
			for (const key of [keys].flat()) {
				store.delete(key);
			}
		},
	});
	const env: LockEnv = {
		local: area(local, true),
		session: area(session, false),
		prefix: PREFIX,
		reserved: [CONFIG_KEY, LOCK_RECORD_KEY],
		now: () => clock.now,
		batch: {batchKeys: 2, batchChars: 400},
	};
	return {env, local, session, clock, control};
}

const library = {
	[`${PREFIX}config`]: {mode: 'saved', configured: true},
	[`${PREFIX}tablodge.state`]: {layout: 'records', rev: 3, sessions: []},
	[`${PREFIX}tablodge.session.a.1`]: {id: 'a', tabs: ['https://a.example/']},
	[`${PREFIX}tablodge.session.b.2`]: {id: 'b', tabs: ['https://b.example/']},
	[`${PREFIX}tablodge.bookmarks.3`]: {items: [{url: 'https://c.example/'}]},
	[`${PREFIX}tablodge.trash`]: {version: 1, items: []},
	uiTheme: 'dark',
};

const sealedKeys = (local: Map<string, unknown>) =>
	[...local]
		.filter(([key, value]) => key.startsWith(PREFIX) && isSealed(value))
		.map(([key]) => key)
		.toSorted();

const dataKeys = Object.keys(library).filter(
	(key) => key.startsWith(PREFIX) && key !== CONFIG_KEY,
);

async function failure(run: Promise<unknown>) {
	let caught: unknown;
	await run.catch((error: unknown) => {
		caught = error;
	});
	assert.ok(caught instanceof PrivateLockError, 'expected a PrivateLockError');
	return caught;
}

test('a sealed value opens only with its key and its storage name', async () => {
	const key = await importDataKey(generateDataKey());
	const other = await importDataKey(generateDataKey());
	const sealed = await sealValue(key, 'tablodge.state', {a: [1, 'two']});
	assert.equal(isSealed(sealed), true);
	assert.deepEqual(await openValue(key, 'tablodge.state', sealed), {
		a: [1, 'two'],
	});
	assert.equal(
		(await failure(openValue(other, 'tablodge.state', sealed))).code,
		'damaged',
	);
	assert.equal(
		(await failure(openValue(key, 'tablodge.trash', sealed))).code,
		'damaged',
	);
	// Plain values pass through the reader untouched.
	assert.deepEqual(await readStored(key, 'x', {plain: true}), {plain: true});
	assert.equal(JSON.stringify(sealed).includes('two'), false);
});

test('two seals of one value differ, and a changed byte fails', async () => {
	const key = await importDataKey(generateDataKey());
	const first = await sealValue(key, 'k', 'same');
	const second = await sealValue(key, 'k', 'same');
	assert.notEqual(first.ct, second.ct);
	assert.notEqual(first.iv, second.iv);
	const flipped = {...first, ct: `${first.ct.slice(0, -4)}AAAA`};
	assert.equal((await failure(openValue(key, 'k', flipped))).code, 'damaged');
});

test('the data key is wrapped in the credential envelope and opens with the credential only', async () => {
	const dataKey = generateDataKey();
	const wrapped = await wrapDataKey(dataKey, password);
	assert.deepEqual(await unwrapDataKey(wrapped, password.value), dataKey);
	assert.equal(
		(await failure(unwrapDataKey(wrapped, 'wrong horse battery'))).code,
		'wrong-credential',
	);
	assert.equal((await failure(unwrapDataKey('!!!', 'x'))).code, 'damaged');
});

test('lock records are checked before use', () => {
	const good: LockRecord = {
		version: 1,
		state: 'encrypted',
		kind: 'pin',
		wrapped: 'abc',
		idleMinutes: 5,
	};
	assert.deepEqual(parseLockRecord(good), good);
	for (const bad of [
		null,
		'x',
		{...good, version: 2},
		{...good, state: 'open'},
		{...good, kind: 'face'},
		{...good, wrapped: ''},
		{...good, idleMinutes: 7},
	]) {
		assert.equal(parseLockRecord(bad), null);
	}
});

test('enabling seals every library value, and leaves the config, the lock record, and appearance plain', async () => {
	const {env, local} = createEnv(library);
	const lock = createPrivateLock(env);
	assert.equal(await lock.gate(), null);
	await lock.enable(password);
	assert.deepEqual(sealedKeys(local), dataKeys.toSorted());
	assert.deepEqual(local.get(CONFIG_KEY), library[CONFIG_KEY]);
	assert.equal(local.get('uiTheme'), 'dark');
	const record = parseLockRecord(local.get(LOCK_RECORD_KEY));
	assert.equal(record?.state, 'encrypted');
	assert.equal(record?.kind, 'password');
	assert.equal(record?.idleMinutes, 5);
	const stored = JSON.stringify([...local]);
	assert.equal(stored.includes('a.example'), false);
	assert.equal(stored.includes(password.value), false);
	const gate = await lock.gate();
	assert.equal(gate?.state, 'encrypted');
	assert.ok(gate?.key);
	const index = local.get(`${PREFIX}tablodge.state`);
	assert.ok(isSealed(index));
	assert.deepEqual(
		await openValue(gate.key, 'tablodge.state', index),
		library[`${PREFIX}tablodge.state`],
	);
});

test('lock now and a restart that loses the session drop the key; the credential brings it back', async () => {
	const {env, session} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	await lock.lock();
	assert.equal(session.has(LOCK_SESSION_KEY), false);
	assert.equal((await lock.gate())?.key, null);
	const status = await lock.status();
	assert.equal(status.locked, true);
	assert.equal(status.enabled, true);
	assert.equal(
		(await failure(lock.unlock('nope nope nope'))).code,
		'wrong-credential',
	);
	assert.equal((await lock.gate())?.key, null);
	await lock.unlock(password.value);
	assert.ok((await lock.gate())?.key);
	// A worker that restarts while unlocked finds the key in the session store without asking again.
	const restarted = createPrivateLock(env);
	assert.ok((await restarted.gate())?.key);
	// A browser restart empties the session store.
	session.clear();
	assert.equal((await createPrivateLock(env).gate())?.key, null);
});

test('a late activity write after Lock now cannot bring the key back', async () => {
	const {env, session} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	await lock.lock();
	await env.session.set({[LOCK_ACTIVITY_KEY]: env.now()});
	assert.equal(session.has(LOCK_SESSION_KEY), false);
	assert.equal((await lock.gate())?.key, null);
	assert.equal((await lock.status()).locked, true);
});

test('the key is never written to the persistent area', async () => {
	const {env, local, session} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	const raw = (session.get(LOCK_SESSION_KEY) as {key: string}).key;
	assert.ok(raw.length > 20);
	assert.equal(JSON.stringify([...local]).includes(raw), false);
});

test('the idle timeout locks, activity postpones it, and 0 never times out', async () => {
	const {env, clock, session} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password, 5);
	clock.now += 4 * 60_000;
	assert.ok((await lock.gate())?.key);
	// The read at minute 4 counted as activity, so minute 8 is still inside the window.
	clock.now += 4 * 60_000;
	assert.ok((await lock.gate())?.key);
	clock.now += 5 * 60_000;
	assert.equal((await lock.gate())?.key, null);
	assert.equal(session.has(LOCK_SESSION_KEY), false);
	await lock.unlock(password.value);
	await lock.setIdleMinutes(0);
	clock.now += 24 * 3_600_000;
	assert.ok((await lock.gate())?.key);
	assert.equal((await lock.status()).expiresAt, null);
	assert.equal((await failure(lock.setIdleMinutes(7))).code, 'invalid');
});

test('status reports when the idle timeout will lock', async () => {
	const {env, clock} = createEnv(library);
	const lock = createPrivateLock(env);
	assert.deepEqual(await lock.status(), {
		enabled: false,
		state: 'none',
		locked: false,
		kind: null,
		idleMinutes: 5,
		expiresAt: null,
	});
	await lock.enable({kind: 'pin', value: '2468'}, 15);
	const status = await lock.status();
	assert.equal(status.kind, 'pin');
	assert.equal(status.locked, false);
	assert.equal(status.expiresAt, clock.now + 15 * 60_000);
});

test('repeated wrong entries lock the form for a while, and a right entry resets the count', async () => {
	const {env, clock} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	await lock.lock();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		assert.equal(
			(await failure(lock.unlock('wrong wrong wrong'))).code,
			'wrong-credential',
		);
	}

	const blocked = await failure(lock.unlock(password.value));
	assert.equal(blocked.code, 'rate-limited');
	clock.now += 31_000;
	await lock.unlock(password.value);
	assert.ok((await lock.gate())?.key);
	await lock.lock();
	// The count started over.
	assert.equal(
		(await failure(lock.unlock('wrong wrong wrong'))).code,
		'wrong-credential',
	);
});

test('writes made while sealing is under way stay readable, and a pass cut off at any write resumes', async () => {
	const probe = createEnv(library);
	await createPrivateLock(probe.env).enable(password);
	const total = probe.control.localSets;
	assert.ok(total > 3, 'the pass should take several writes');
	for (let allowed = 0; allowed < total; allowed += 1) {
		const {env, local, control} = createEnv(library);
		control.failSetAfter = allowed;
		const first = createPrivateLock(env);
		await first.enable(password).catch(() => undefined);
		control.failSetAfter = Infinity;
		// The worker restarted: a new controller, the same stores.
		const restarted = createPrivateLock(env);
		const record = parseLockRecord(local.get(LOCK_RECORD_KEY));
		if (record) {
			assert.equal(
				record.state === 'encrypting' || record.state === 'encrypted',
				true,
			);
			// The key is in memory when the pass stopped (or enable stopped before writing anything).
			assert.equal(await restarted.resume(), record.state === 'encrypting');
		} else {
			// Cut off before the record existed: nothing was sealed, and no lock is set.
			assert.deepEqual(sealedKeys(local), []);
			continue;
		}

		assert.deepEqual(
			sealedKeys(local),
			dataKeys.toSorted(),
			`cut off after ${allowed} writes`,
		);
		assert.equal(
			parseLockRecord(local.get(LOCK_RECORD_KEY))?.state,
			'encrypted',
		);
		const gate = await restarted.gate();
		assert.ok(gate?.key);
		assert.deepEqual(
			await readStored(
				gate.key,
				'tablodge.session.a.1',
				local.get(`${PREFIX}tablodge.session.a.1`),
			),
			library[`${PREFIX}tablodge.session.a.1`],
		);
	}
});

test('a pass cut off by a browser restart resumes after unlocking with the credential', async () => {
	const {env, local, session, control} = createEnv(library);
	control.failSetAfter = 2;
	await createPrivateLock(env)
		.enable(password)
		.catch(() => undefined);
	assert.equal(
		parseLockRecord(local.get(LOCK_RECORD_KEY))?.state,
		'encrypting',
	);
	assert.ok(sealedKeys(local).length < dataKeys.length);
	control.failSetAfter = Infinity;
	session.clear();
	const lock = createPrivateLock(env);
	assert.equal(await lock.resume(), false);
	assert.equal((await lock.gate())?.key, null);
	await lock.unlock(password.value);
	assert.equal(await lock.resume(), true);
	assert.deepEqual(sealedKeys(local), dataKeys.toSorted());
});

test('removing the lock opens every value and deletes the record; wrong credentials change nothing', async () => {
	const {env, local, session} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	assert.equal(
		(await failure(lock.disable('wrong wrong wrong'))).code,
		'wrong-credential',
	);
	assert.deepEqual(sealedKeys(local), dataKeys.toSorted());
	await lock.disable(password.value);
	assert.deepEqual(sealedKeys(local), []);
	assert.equal(local.has(LOCK_RECORD_KEY), false);
	assert.equal(session.has(LOCK_SESSION_KEY), false);
	for (const key of dataKeys) {
		assert.deepEqual(local.get(key), library[key as keyof typeof library]);
	}

	assert.equal(await lock.gate(), null);
});

test('a removal cut off at any write resumes and never loses a value', async () => {
	const probe = createEnv(library);
	const probeLock = createPrivateLock(probe.env);
	await probeLock.enable(password);
	const before = probe.control.localSets;
	await probeLock.disable(password.value);
	const total = probe.control.localSets - before;
	assert.ok(total > 3);
	for (let allowed = 0; allowed < total; allowed += 1) {
		const {env, local, control} = createEnv(library);
		const lock = createPrivateLock(env);
		await lock.enable(password);
		control.localSets = 0;
		control.failSetAfter = allowed;
		await lock.disable(password.value).catch(() => undefined);
		control.failSetAfter = Infinity;
		const restarted = createPrivateLock(env);
		// Mixed sealed and plain values are all readable with the key.
		const gate = await restarted.gate();
		if (gate?.key) {
			for (const key of dataKeys) {
				assert.deepEqual(
					await readStored(gate.key, key.slice(PREFIX.length), local.get(key)),
					library[key as keyof typeof library],
					`${key} cut off after ${allowed} writes`,
				);
			}
		}

		await restarted.resume();
		if (parseLockRecord(local.get(LOCK_RECORD_KEY))?.state === 'encrypted') {
			// Stopped before the removal began: the lock simply stays on.
			assert.deepEqual(sealedKeys(local), dataKeys.toSorted());
			continue;
		}

		assert.deepEqual(sealedKeys(local), [], `cut off after ${allowed} writes`);
		assert.equal(local.has(LOCK_RECORD_KEY), false);
		for (const key of dataKeys) {
			assert.deepEqual(local.get(key), library[key as keyof typeof library]);
		}
	}
});

test('a removal cut off and then locked finishes after unlocking with the credential', async () => {
	const {env, local, session, control} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	control.localSets = 0;
	control.failSetAfter = 2;
	await lock.disable(password.value).catch(() => undefined);
	assert.equal(
		parseLockRecord(local.get(LOCK_RECORD_KEY))?.state,
		'decrypting',
	);
	control.failSetAfter = Infinity;
	session.clear();
	const restarted = createPrivateLock(env);
	assert.equal((await restarted.gate())?.key, null);
	assert.equal(await restarted.resume(), false);
	await restarted.unlock(password.value);
	assert.equal(await restarted.resume(), true);
	assert.equal(local.has(LOCK_RECORD_KEY), false);
	assert.deepEqual(sealedKeys(local), []);
});

test('changing the credential keeps the data readable and invalidates the old credential', async () => {
	const {env, local} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	const sealedBefore = JSON.stringify(local.get(`${PREFIX}tablodge.state`));
	assert.equal(
		(
			await failure(
				lock.changeCredential('wrong wrong wrong', {
					kind: 'pin',
					value: '2468',
				}),
			)
		).code,
		'wrong-credential',
	);
	assert.equal(
		(
			await failure(
				lock.changeCredential(password.value, {kind: 'pin', value: '12'}),
			)
		).code,
		'invalid',
	);
	await lock.changeCredential(password.value, {kind: 'pin', value: '2468'});
	assert.equal(
		JSON.stringify(local.get(`${PREFIX}tablodge.state`)),
		sealedBefore,
	);
	assert.equal(parseLockRecord(local.get(LOCK_RECORD_KEY))?.kind, 'pin');
	await lock.lock();
	assert.equal(
		(await failure(lock.unlock(password.value))).code,
		'wrong-credential',
	);
	await lock.unlock('2468');
	const gate = await lock.gate();
	assert.ok(gate?.key);
	assert.deepEqual(
		await readStored(
			gate.key,
			'tablodge.trash',
			local.get(`${PREFIX}tablodge.trash`),
		),
		library[`${PREFIX}tablodge.trash`],
	);
});

test('the credential cannot change while a pass is unfinished', async () => {
	const {env, control} = createEnv(library);
	control.failSetAfter = 2;
	const lock = createPrivateLock(env);
	await lock.enable(password).catch(() => undefined);
	control.failSetAfter = Infinity;
	assert.equal(
		(
			await failure(
				lock.changeCredential(password.value, {kind: 'pin', value: '2468'}),
			)
		).code,
		'state',
	);
});

test('enable refuses a second lock and a credential outside the limits', async () => {
	const {env} = createEnv(library);
	const lock = createPrivateLock(env);
	assert.equal(
		(await failure(lock.enable({kind: 'pin', value: '12'}))).code,
		'invalid',
	);
	assert.equal((await failure(lock.enable(password, 3))).code, 'invalid');
	await lock.enable(password);
	assert.equal((await failure(lock.enable(password))).code, 'state');
});

test('a damaged lock record is reported, never treated as no lock', async () => {
	const {env} = createEnv({
		...library,
		[LOCK_RECORD_KEY]: {version: 1, state: 'oops'},
	});
	const lock = createPrivateLock(env);
	assert.equal((await failure(lock.gate())).code, 'damaged');
	const status = await lock.status();
	assert.equal(status.state, 'damaged');
	assert.equal(status.locked, true);
	assert.equal((await failure(lock.unlock('anything at all'))).code, 'damaged');
});

test('a sealed value moved to another key is refused', async () => {
	const {env, local} = createEnv(library);
	const lock = createPrivateLock(env);
	await lock.enable(password);
	const gate = await lock.gate();
	assert.ok(gate?.key);
	const moved = local.get(`${PREFIX}tablodge.session.a.1`);
	assert.equal(
		(await failure(readStored(gate.key, 'tablodge.session.b.2', moved))).code,
		'damaged',
	);
});
