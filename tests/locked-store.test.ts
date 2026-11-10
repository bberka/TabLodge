import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {decryptBytes} from '../src/app/crypto-envelope';
import {
	COOLDOWN_MS,
	FREE_ATTEMPTS,
	LOCKED_ALARM,
	LOCKED_ATTEMPTS_KEY,
	LOCKED_FLAG_KEY,
	LOCKED_KEY,
	LOCKED_RESET_CONFIRMATION,
	LOCKED_SESSION_KEY,
	LockedError,
	MAX_LOCKED_ITEMS,
	RESET_OFFER_ATTEMPTS,
	base64ToBytes,
	bytesToBase64,
	createLockedStore,
	type KeyValueArea,
	type LockedBackend,
} from '../src/shared/locked-store';

const password = {kind: 'password', value: 'correct horse battery'} as const;
const pin = {kind: 'pin', value: '4821'} as const;
const MINUTE = 60_000;

type Rig = {
	backend: LockedBackend;
	local: Map<string, unknown>;
	session: Map<string, unknown>;
	clock: {now: number};
	alarm: {at: number | null; sets: number[]};
	/**
	Makes the next call to `set` on the area fail once, before it writes anything.
	*/
	failNextSet(area: 'local' | 'session'): void;
	/**
	Makes the next `set` of the key succeed in local storage and then throw, as if the worker died right after.
	*/
	crashAfterNextSet(area: 'local' | 'session', key: string): void;
	/**
	Makes the next `remove` of the key fail before it deletes anything.
	*/
	failNextRemove(area: 'local' | 'session', key: string): void;
};

function rig(): Rig {
	const local = new Map<string, unknown>();
	const session = new Map<string, unknown>();
	const clock = {now: 1_000_000};
	const alarm = {at: null as number | null, sets: [] as number[]};
	const fail = {local: false, session: false};
	const crashKey = {local: '', session: ''};
	const failRemove = {local: '', session: ''};
	const area = (
		name: 'local' | 'session',
		map: Map<string, unknown>,
	): KeyValueArea => ({
		async get(key) {
			return structuredClone(map.get(key));
		},
		async set(key, value) {
			if (fail[name]) {
				fail[name] = false;
				throw new Error('storage write failed');
			}

			map.set(key, structuredClone(value));
			if (crashKey[name] !== key) {
				return;
			}

			crashKey[name] = '';
			throw new Error('worker stopped after the write');
		},
		async remove(key) {
			if (failRemove[name] === key) {
				failRemove[name] = '';
				throw new Error('storage remove failed');
			}

			map.delete(key);
		},
	});
	return {
		local,
		session,
		clock,
		alarm,
		backend: {
			local: area('local', local),
			session: area('session', session),
			now: () => clock.now,
			alarm: {
				async set(at) {
					alarm.at = at;
					alarm.sets.push(at);
				},
				async clear() {
					alarm.at = null;
				},
			},
		},
		failNextSet(name) {
			fail[name] = true;
		},
		crashAfterNextSet(name, key) {
			crashKey[name] = key;
		},
		failNextRemove(name, key) {
			failRemove[name] = key;
		},
	};
}

async function failure(run: Promise<unknown>): Promise<LockedError> {
	let caught: unknown;
	await run.catch((error: unknown) => {
		caught = error;
	});
	assert.ok(caught instanceof LockedError, 'expected a LockedError');
	return caught;
}

const page = {title: 'Tax portal', url: 'https://example.com/taxes'};

test('setup creates an unlocked, empty area protected by the credential', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	assert.deepEqual(await store.status(), {configured: false});
	await store.setup(password);
	assert.deepEqual(await store.status(), {
		configured: true,
		unlocked: true,
		kind: 'password',
		idleMinutes: 5,
		count: 0,
	});
	assert.deepEqual(await store.list(), []);
	assert.deepEqual(t.session.get(LOCKED_FLAG_KEY), {unlocked: true});
	assert.equal(t.alarm.at, t.clock.now + 5 * MINUTE);
});

test('setup refuses an invalid credential and a second area', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	assert.equal(
		(await failure(store.setup({kind: 'pin', value: '12'}))).code,
		'invalid-credential',
	);
	assert.equal(
		(await failure(store.setup({kind: 'pin', value: 'abcd'}))).code,
		'invalid-credential',
	);
	assert.equal(t.local.has(LOCKED_KEY), false);
	await store.setup(pin);
	assert.equal((await failure(store.setup(password))).code, 'already-set-up');
});

test('titles and addresses never reach storage as plain text, and the credential is never stored', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	const everything = JSON.stringify([...t.local, ...t.session]);
	for (const secret of ['Tax portal', 'example.com', 'taxes', password.value]) {
		assert.equal(everything.includes(secret), false, secret);
	}

	assert.deepEqual(Object.keys(t.local.get(LOCKED_KEY) as object).toSorted(), [
		'envelope',
		'idleMinutes',
		'kind',
		'rev',
		'updatedAt',
		'version',
	]);
});

test('the stored blob is an ordinary envelope that the shared module opens with the credential', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	const record = t.local.get(LOCKED_KEY) as {envelope: string};
	const data = await decryptBytes(
		base64ToBytes(record.envelope),
		password.value,
	);
	const parsed = JSON.parse(new TextDecoder().decode(data)) as {
		items: Array<{url: string}>;
	};
	assert.equal(parsed.items[0].url, 'https://example.com/taxes');
});

test('lock removes the key, clears the alarm, and blocks every read and write', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.lock();
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.deepEqual(t.session.get(LOCKED_FLAG_KEY), {unlocked: false});
	assert.equal(t.alarm.at, null);
	assert.equal((await failure(store.list())).code, 'locked');
	assert.equal((await failure(store.add([page]))).code, 'locked');
	assert.equal((await failure(store.remove(['x']))).code, 'locked');
	assert.equal((await failure(store.setIdleMinutes(15))).code, 'locked');
	assert.deepEqual(await store.status(), {
		configured: true,
		unlocked: false,
		kind: 'password',
		idleMinutes: 5,
	});
	await store.unlock(password.value);
	assert.equal((await store.list()).length, 1);
});

test('a wrong credential is refused, and five wrong entries in a row make the next wait', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(pin);
	await store.lock();
	for (let attempt = 1; attempt <= FREE_ATTEMPTS; attempt++) {
		const error = await failure(store.unlock('0000'));
		assert.equal(error.code, 'wrong-credential');
		assert.equal(
			error.retryAfterMs,
			attempt === FREE_ATTEMPTS ? COOLDOWN_MS : undefined,
		);
	}

	const waiting = await failure(store.unlock(pin.value));
	assert.equal(waiting.code, 'too-many-attempts');
	assert.equal(waiting.retryAfterMs, COOLDOWN_MS);
	assert.equal(
		((await store.status()) as {retryAfterMs?: number}).retryAfterMs,
		COOLDOWN_MS,
	);
	t.clock.now += COOLDOWN_MS;
	await store.unlock(pin.value);
	assert.equal(t.session.has(LOCKED_ATTEMPTS_KEY), false);
	assert.equal(((await store.status()) as {unlocked: boolean}).unlocked, true);
});

test('an unlock with a wrong credential leaves the area locked and the entry unchanged', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.lock();
	const before = JSON.stringify(t.local.get(LOCKED_KEY));
	await failure(store.unlock('wrong horse battery'));
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), before);
});

test('the area locks itself once the idle time is up, even if the alarm never fires', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	t.clock.now += 5 * MINUTE - 1;
	assert.equal((await store.list()).length, 1);
	// The read above counted as use, so the deadline moved.
	assert.equal(t.alarm.at, t.clock.now + 5 * MINUTE);
	t.clock.now += 5 * MINUTE;
	assert.equal((await failure(store.list())).code, 'locked');
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.deepEqual(t.session.get(LOCKED_FLAG_KEY), {unlocked: false});
});

test('checking status does not count as use, but touch does', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	t.clock.now += 4 * MINUTE;
	await store.status();
	t.clock.now += MINUTE;
	assert.equal(((await store.status()) as {unlocked: boolean}).unlocked, false);
	await store.unlock(password.value);
	t.clock.now += 4 * MINUTE;
	await store.touch();
	t.clock.now += 4 * MINUTE;
	assert.equal(((await store.status()) as {unlocked: boolean}).unlocked, true);
});

test('the idle alarm locks when due and sets itself again when the area was used since', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	t.clock.now += 3 * MINUTE;
	await store.touch();
	const lastUsed = t.clock.now;
	// The first alarm fires; the area was used meanwhile, so it only waits again.
	t.clock.now += 2 * MINUTE;
	await store.checkIdle();
	assert.equal(t.session.has(LOCKED_SESSION_KEY), true);
	assert.equal(t.alarm.at, lastUsed + 5 * MINUTE);
	t.clock.now += 5 * MINUTE;
	await store.checkIdle();
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal(t.alarm.at, null);
	assert.equal(LOCKED_ALARM, 'tablodge-locked-idle');
});

test('the idle time is configurable, and 0 keeps the area open until the browser closes', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password, 1);
	t.clock.now += MINUTE;
	assert.equal((await failure(store.list())).code, 'locked');
	await store.unlock(password.value);
	await store.setIdleMinutes(0);
	assert.equal(t.alarm.at, null);
	t.clock.now += 24 * 60 * MINUTE;
	assert.deepEqual(await store.list(), []);
	assert.equal((await failure(store.setIdleMinutes(7))).code, 'invalid');
	const record = t.local.get(LOCKED_KEY) as {idleMinutes: number};
	assert.equal(record.idleMinutes, 0);
});

test('a restarted service worker finds the area still unlocked, and a browser restart finds it locked', async () => {
	const t = rig();
	await createLockedStore(t.backend).setup(password);
	await createLockedStore(t.backend).add([page]);
	// New store objects stand for new worker instances; nothing is held in memory between them.
	const revived = createLockedStore(t.backend);
	assert.equal(
		((await revived.status()) as {unlocked: boolean}).unlocked,
		true,
	);
	assert.equal((await revived.list())[0].title, 'Tax portal');
	await revived.add([{url: 'https://example.org/'}]);
	assert.equal((await createLockedStore(t.backend).list()).length, 2);

	t.session.clear();
	const afterRestart = createLockedStore(t.backend);
	assert.equal(
		((await afterRestart.status()) as {unlocked: boolean}).unlocked,
		false,
	);
	assert.equal((await failure(afterRestart.list())).code, 'locked');
	await afterRestart.unlock(password.value);
	assert.equal((await afterRestart.list()).length, 2);
});

test('startup locks leftovers in session storage', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.startup();
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal((await failure(store.list())).code, 'locked');
});

test('a key that no longer fits the entry locks the area instead of failing', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const other = rig();
	const otherStore = createLockedStore(other.backend);
	await otherStore.setup(password);
	t.session.set(LOCKED_SESSION_KEY, other.session.get(LOCKED_SESSION_KEY));
	assert.equal(((await store.status()) as {unlocked: boolean}).unlocked, false);
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
});

test('adding skips repeats and non web addresses, trims titles, and fills in a missing one', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const result = await store.add([
		{title: '  Bank  ', url: 'https://bank.example/login '},
		{url: 'https://bank.example/login'},
		{title: 'x'.repeat(900), url: 'https://long.example/'},
	]);
	assert.equal(result.added.length, 2);
	assert.equal(result.skipped, 1);
	const [bank, long] = await store.list();
	assert.equal(bank.title, 'Bank');
	assert.equal(bank.url, 'https://bank.example/login');
	assert.equal(long.title.length, 500);
	assert.equal(
		(await failure(store.add([{url: 'javascript:alert(1)'}]))).code,
		'invalid',
	);
	assert.equal(
		(await failure(store.add([{url: 'file:///etc/passwd'}]))).code,
		'invalid',
	);
	const [untitled] = (await store.add([{url: 'https://untitled.example/a'}]))
		.added;
	assert.equal(untitled.title, 'untitled.example');
});

test('the area refuses to grow past its limit', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const many = Array.from({length: MAX_LOCKED_ITEMS}, (_, index) => ({
		url: `https://example.com/${index}`,
	}));
	await store.add(many);
	assert.equal(
		(await failure(store.add([{url: 'https://example.com/one-more'}]))).code,
		'full',
	);
	assert.equal((await store.list()).length, MAX_LOCKED_ITEMS);
});

test('addMany stores in batches, one encrypted write each, and skips what is already there', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([{title: 'Old', url: 'https://example.com/3'}]);
	let writes = 0;
	const write = t.backend.local.set;
	t.backend.local.set = async (key, value) => {
		writes += 1;
		return write(key, value);
	};

	const entries = Array.from({length: 7}, (_, index) => ({
		title: `Link ${index}`,
		url: `https://example.com/${index}`,
	}));
	const result = await store.addMany(entries, 3);
	assert.equal(result.added.length, 6);
	assert.equal(result.skipped, 1);
	assert.equal(writes, 3);
	assert.equal((await store.list()).length, 7);
});

test('addMany checks everything before it writes: an invalid address or too many links store nothing', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const before = JSON.stringify(t.local.get(LOCKED_KEY));
	assert.equal(
		(
			await failure(
				store.addMany([{url: 'https://a.example/'}, {url: 'chrome://flags'}]),
			)
		).code,
		'invalid',
	);
	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), before);

	await store.add(
		Array.from({length: MAX_LOCKED_ITEMS - 1}, (_, index) => ({
			url: `https://fill.example/${index}`,
		})),
	);
	const full = JSON.stringify(t.local.get(LOCKED_KEY));
	assert.equal(
		(
			await failure(
				store.addMany(
					[{url: 'https://x.example/1'}, {url: 'https://x.example/2'}],
					1,
				),
			)
		).code,
		'full',
	);
	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), full);
});

test('addMany interrupted after the first batch leaves that batch stored and the entry readable', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	let writes = 0;
	const write = t.backend.local.set;
	t.backend.local.set = async (key, value) => {
		writes += 1;
		if (writes === 2) {
			throw new Error('storage write failed');
		}

		return write(key, value);
	};

	const entries = Array.from({length: 5}, (_, index) => ({
		url: `https://example.com/${index}`,
	}));
	await assert.rejects(store.addMany(entries, 2), /storage write failed/);
	// The caller removes the originals only after addMany returns, so they are still in the library.
	assert.deepEqual(
		(await store.list()).map((item) => item.url),
		['https://example.com/0', 'https://example.com/1'],
	);
	// Running it again stores the rest and skips the first batch.
	t.backend.local.set = write;
	const again = await store.addMany(entries, 2);
	assert.equal(again.added.length, 3);
	assert.equal(again.skipped, 2);
	assert.equal((await store.list()).length, 5);
});

test('addMany while locked or not set up is refused', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	assert.equal(
		(await failure(store.addMany([{url: 'https://a.example/'}]))).code,
		'not-set-up',
	);
	await store.setup(password);
	await store.lock();
	assert.equal(
		(await failure(store.addMany([{url: 'https://a.example/'}]))).code,
		'locked',
	);
});

test('update changes the title or address and keeps addresses unique', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const {added} = await store.add([
		page,
		{title: 'Other', url: 'https://other.example/'},
	]);
	t.clock.now += 10;
	const updated = await store.update(added[0].id, {title: 'Taxes 2026'});
	assert.equal(updated.title, 'Taxes 2026');
	assert.equal(updated.updatedAt, t.clock.now);
	assert.equal(updated.createdAt, added[0].createdAt);
	assert.equal(
		(await failure(store.update(added[0].id, {url: 'https://other.example/'})))
			.code,
		'invalid',
	);
	assert.equal(
		(await failure(store.update('missing', {title: 'x'}))).code,
		'invalid',
	);
	assert.equal(
		(await store.update(added[0].id, {url: 'https://example.com/new'})).url,
		'https://example.com/new',
	);
});

test('remove deletes for good and reports how many', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const {added} = await store.add([page, {url: 'https://other.example/'}]);
	assert.equal(await store.remove([added[0].id, 'missing']), 1);
	assert.deepEqual(
		(await store.list()).map((item) => item.url),
		['https://other.example/'],
	);
	assert.equal(await store.remove(['missing']), 0);
});

test('a write that fails leaves the previous entry intact and the area unlocked', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	const before = JSON.stringify(t.local.get(LOCKED_KEY));
	t.failNextSet('local');
	const error = await store
		.add([{url: 'https://other.example/'}])
		.catch((reason: unknown) => reason);
	assert.match(String(error), /storage write failed/);
	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), before);
	assert.deepEqual(
		(await store.list()).map((item) => item.url),
		['https://example.com/taxes'],
	);
	// The store works again straight away.
	await store.add([{url: 'https://other.example/'}]);
	assert.equal((await store.list()).length, 2);
});

test('a worker that stops right after the entry is written loses nothing', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	t.crashAfterNextSet('local', LOCKED_KEY);
	await store.add([page]).catch(() => undefined);
	const revived = createLockedStore(t.backend);
	assert.deepEqual(
		(await revived.list()).map((item) => item.url),
		['https://example.com/taxes'],
	);
});

test('changing the credential needs the current one, and the old one stops working', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	const before = JSON.stringify(t.local.get(LOCKED_KEY));
	assert.equal(
		(await failure(store.changeCredential('nope nope nope', pin))).code,
		'wrong-credential',
	);
	assert.equal(
		(
			await failure(
				store.changeCredential(password.value, {kind: 'pin', value: '1'}),
			)
		).code,
		'invalid-credential',
	);
	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), before);

	await store.changeCredential(password.value, pin);
	assert.equal(((await store.status()) as {kind: string}).kind, 'pin');
	assert.equal((await store.list())[0].url, 'https://example.com/taxes');
	await store.lock();
	assert.equal(
		(await failure(store.unlock(password.value))).code,
		'wrong-credential',
	);
	await store.unlock(pin.value);
	assert.equal((await store.list()).length, 1);
	// A fresh salt, so the old key opens nothing.
	assert.equal(
		await decryptBytes(
			base64ToBytes((t.local.get(LOCKED_KEY) as {envelope: string}).envelope),
			pin.value,
		).then((data) => data.length > 0),
		true,
	);
});

test('a worker that stops between replacing the entry and the key leaves it locked, and the new credential opens it', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	t.failNextSet('session');
	await store.changeCredential(password.value, pin).catch(() => undefined);
	const revived = createLockedStore(t.backend);
	assert.equal(
		((await revived.status()) as {unlocked: boolean}).unlocked,
		false,
	);
	await failure(revived.unlock(password.value));
	await revived.unlock(pin.value);
	assert.equal((await revived.list())[0].title, 'Tax portal');
});

test('removing the lock needs the credential, hands over the bookmarks first, and deletes the entry', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	assert.equal(
		(await failure(store.removeLock('wrong wrong wrong'))).code,
		'wrong-credential',
	);
	assert.equal(t.local.has(LOCKED_KEY), true);

	await failure(
		store.removeLock(password.value, async () => {
			throw new LockedError('invalid', 'could not move them');
		}),
	);
	assert.equal(t.local.has(LOCKED_KEY), true);
	assert.equal((await store.list()).length, 1);

	let moved: string[] = [];
	const count = await store.removeLock(password.value, async (items) => {
		moved = items.map((item) => item.title);
	});
	assert.equal(count, 1);
	assert.deepEqual(moved, ['Tax portal']);
	assert.equal(t.local.has(LOCKED_KEY), false);
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.deepEqual(await store.status(), {configured: false});
	await store.setup(pin);
	assert.deepEqual(await store.list(), []);
});

test('removing the lock while locked is refused', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.lock();
	assert.equal(
		(await failure(store.removeLock(password.value))).code,
		'locked',
	);
	assert.equal(t.local.has(LOCKED_KEY), true);
});

test('a backup carries the encrypted entry as it is, and restoring it locks the area', async () => {
	const source = rig();
	const sourceStore = createLockedStore(source.backend);
	await sourceStore.setup(password);
	await sourceStore.add([page]);
	const record = await sourceStore.exportRecord();
	assert.ok(record);
	assert.equal(JSON.stringify(record).includes('Tax portal'), false);

	const target = rig();
	const targetStore = createLockedStore(target.backend);
	assert.equal(await targetStore.exportRecord(), null);
	assert.equal(
		await targetStore.importRecord({...record, envelope: 'AAAA'}),
		false,
	);
	assert.equal(await targetStore.importRecord({version: 1}), false);
	assert.equal(await targetStore.importRecord(structuredClone(record)), true);
	assert.equal(
		((await targetStore.status()) as {unlocked: boolean}).unlocked,
		false,
	);
	await targetStore.unlock(password.value);
	assert.equal((await targetStore.list())[0].url, 'https://example.com/taxes');
});

test('restoring a backup over an unlocked area locks it, because the old key no longer fits', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	const other = rig();
	const otherStore = createLockedStore(other.backend);
	await otherStore.setup(pin);
	await store.importRecord(await otherStore.exportRecord());
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal(((await store.status()) as {kind: string}).kind, 'pin');
	assert.equal(
		(await failure(store.unlock(password.value))).code,
		'wrong-credential',
	);
	await store.unlock(pin.value);
});

test('a damaged entry is reported, not opened', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	t.local.set(LOCKED_KEY, {version: 1, nonsense: true});
	assert.equal((await failure(store.status())).code, 'damaged');
	assert.equal((await failure(store.unlock(password.value))).code, 'damaged');
});

test('a changed ciphertext is refused like a wrong credential and never partly read', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.lock();
	const record = t.local.get(LOCKED_KEY) as {envelope: string};
	const bytes = base64ToBytes(record.envelope);
	bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) === 0 ? 1 : 0;
	record.envelope = bytesToBase64(bytes);
	t.local.set(LOCKED_KEY, record);
	assert.equal(
		(await failure(store.unlock(password.value))).code,
		'wrong-credential',
	);
});

test('operations queue behind each other, so two quick adds both land', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await Promise.all([
		store.add([{url: 'https://a.example/'}]),
		store.add([{url: 'https://b.example/'}]),
		store.add([{url: 'https://c.example/'}]),
	]);
	assert.equal((await store.list()).length, 3);
});

test('a reset deletes the area from the lock screen without the credential, and a new credential starts empty', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.lock();
	await store.reset(LOCKED_RESET_CONFIRMATION);
	assert.deepEqual(await store.status(), {configured: false});
	assert.equal(t.local.has(LOCKED_KEY), false);
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal(t.alarm.at, null);
	assert.equal((await failure(store.list())).code, 'not-set-up');
	assert.equal(
		(await failure(store.unlock(password.value))).code,
		'not-set-up',
	);

	await store.setup(pin);
	assert.deepEqual(await store.list(), []);
	await store.lock();
	assert.equal(
		(await failure(store.unlock(password.value))).code,
		'wrong-credential',
	);
	await store.unlock(pin.value);
	assert.deepEqual(await store.list(), []);
});

test('a reset also works while the area is open', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.reset(LOCKED_RESET_CONFIRMATION);
	assert.deepEqual(await store.status(), {configured: false});
	assert.equal(t.local.has(LOCKED_KEY), false);
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.deepEqual(t.session.get(LOCKED_FLAG_KEY), {unlocked: false});
});

test('a reset without the confirmation changes nothing', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	await store.lock();
	const before = JSON.stringify(t.local.get(LOCKED_KEY));
	for (const confirmation of [undefined, '', 'RESET', true, 1]) {
		assert.equal(
			(await failure(store.reset(confirmation))).code,
			'not-confirmed',
		);
	}

	assert.equal(JSON.stringify(t.local.get(LOCKED_KEY)), before);
	await store.unlock(password.value);
	assert.equal((await store.list()).length, 1);
});

test('a reset clears the wrong entries and the wait, so the new area opens at once', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(pin);
	await store.lock();
	for (let attempt = 1; attempt <= FREE_ATTEMPTS; attempt++) {
		await failure(store.unlock('0000'));
	}

	assert.equal(
		((await store.status()) as {retryAfterMs?: number}).retryAfterMs,
		COOLDOWN_MS,
	);
	assert.equal(t.session.has(LOCKED_ATTEMPTS_KEY), true);
	await store.reset(LOCKED_RESET_CONFIRMATION);
	assert.equal(t.session.has(LOCKED_ATTEMPTS_KEY), false);
	await store.setup(pin);
	await store.lock();
	assert.deepEqual(await store.status(), {
		configured: true,
		unlocked: false,
		kind: 'pin',
		idleMinutes: 5,
	});
	await store.unlock(pin.value);
	assert.equal(((await store.status()) as {unlocked: boolean}).unlocked, true);
});

test('the status counts wrong entries so the lock screen knows when to offer a reset', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(pin);
	await store.lock();
	for (let attempt = 1; attempt < RESET_OFFER_ATTEMPTS; attempt++) {
		await failure(store.unlock('0000'));
	}

	assert.equal(
		((await store.status()) as {failedAttempts?: number}).failedAttempts,
		RESET_OFFER_ATTEMPTS - 1,
	);
	await failure(store.unlock('0000'));
	assert.equal(
		((await store.status()) as {failedAttempts?: number}).failedAttempts,
		RESET_OFFER_ATTEMPTS,
	);
	await store.unlock(pin.value);
	assert.equal('failedAttempts' in (await store.status()), false);
});

test('a reset that stops before the entry is deleted leaves a locked area that can be reset again', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	t.failNextRemove('local', LOCKED_KEY);
	await store.reset(LOCKED_RESET_CONFIRMATION).then(
		() => assert.fail('the reset should have failed'),
		() => undefined,
	);
	// Locked, nothing lost: the credential still opens it.
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.equal((await store.status()).configured, true);
	await store.unlock(password.value);
	assert.equal((await store.list()).length, 1);

	t.failNextRemove('local', LOCKED_KEY);
	await store.reset(LOCKED_RESET_CONFIRMATION).catch(() => undefined);
	await store.reset(LOCKED_RESET_CONFIRMATION);
	assert.deepEqual(await store.status(), {configured: false});
});

test('a reset that stops after the entry is deleted is complete: not set up, old credential opens nothing, setup works', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(pin);
	await store.add([page]);
	await store.lock();
	await failure(store.unlock('0000'));
	t.failNextRemove('session', LOCKED_ATTEMPTS_KEY);
	await store.reset(LOCKED_RESET_CONFIRMATION).then(
		() => assert.fail('the reset should have failed'),
		() => undefined,
	);
	assert.equal(t.local.has(LOCKED_KEY), false);
	assert.equal(t.session.has(LOCKED_SESSION_KEY), false);
	assert.deepEqual(await store.status(), {configured: false});
	assert.equal((await failure(store.unlock(pin.value))).code, 'not-set-up');

	// The leftover count does not carry into the new area.
	await store.setup(password);
	assert.equal(t.session.has(LOCKED_ATTEMPTS_KEY), false);
	assert.deepEqual(await store.list(), []);
	await store.lock();
	assert.equal(
		(await failure(store.unlock(pin.value))).code,
		'wrong-credential',
	);
});

test('a reset when nothing is set up is harmless', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.reset(LOCKED_RESET_CONFIRMATION);
	assert.deepEqual(await store.status(), {configured: false});
	await store.setup(pin);
	assert.deepEqual(await store.list(), []);
});

test('after a reset the old entry from a backup is the only way back to the old credential', async () => {
	const t = rig();
	const store = createLockedStore(t.backend);
	await store.setup(password);
	await store.add([page]);
	const backup = await store.exportRecord();
	await store.reset(LOCKED_RESET_CONFIRMATION);
	await store.setup(pin);
	assert.equal(await store.importRecord(backup), true);
	await store.unlock(password.value);
	assert.equal((await store.list())[0].title, 'Tax portal');
});
