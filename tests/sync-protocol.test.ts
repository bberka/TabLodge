import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {sqlite} from '../server/src/node-sqlite';
import {SqlChangeLog} from '../server/src/sql-change-log';
import {ChangeLog, type SyncLog} from '../src/shared/sync/change-log';
import {
	mergeInto,
	parseChange,
	recordKey,
	type SyncChange,
} from '../src/shared/sync/changes';
import {
	type Clock,
	ClockDriftError,
	MAX_CLOCK_DRIFT_MS,
	observe,
	startClock,
	tick,
} from '../src/shared/sync/clock';
import {isOrderKey, keyBetween, spreadKeys} from '../src/shared/sync/order-key';

const DAY = 24 * 60 * 60 * 1000;

/**
Every server log runs the same tests: the in memory reference and the SQLite one the servers use.
*/
const LOGS: Array<[string, () => SyncLog]> = [
	['memory', () => new ChangeLog()],
	['sqlite', () => new SqlChangeLog(sqlite(':memory:'))],
];

/**
Everything a device starting from cursor 0 receives.
*/
function pullAll(log: SyncLog): SyncChange[] {
	const changes: SyncChange[] = [];
	let cursor = 0;
	for (;;) {
		const response = log.pull(cursor, 100);
		assert.ok(!response.resync);
		changes.push(...response.changes);
		cursor = response.cursor;
		if (!response.more) {
			return changes;
		}
	}
}

const T0 = Date.UTC(2026, 10, 1);

/**
A seeded linear congruential generator, so a failing simulation can be replayed from its seed.
*/
function random(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

test('stamps from one device sort in write order even when the system clock goes back', () => {
	let clock = startClock();
	const stamps: string[] = [];
	for (const now of [T0, T0, T0 + 5, T0 - 1000, T0 + 5]) {
		const next = tick(clock, now);
		clock = next.clock;
		stamps.push(next.h);
	}

	assert.deepEqual(stamps.toSorted(), stamps);
	assert.equal(new Set(stamps).size, stamps.length);
});

test('a device with a slow clock writes after the stamps it has seen', () => {
	const fast = tick(startClock(), T0 + 60_000);
	const slow = observe(startClock(), fast.h, T0);
	assert.ok(tick(slow, T0).h > fast.h);
});

test('a stamp from a clock more than a day ahead is refused', () => {
	const ahead = tick(startClock(), T0 + MAX_CLOCK_DRIFT_MS + 1).h;
	assert.throws(() => observe(startClock(), ahead, T0), ClockDriftError);
	assert.throws(() => observe(startClock(), 'not a stamp', T0), TypeError);
});

test('order keys fit between any two neighbours and stay valid', () => {
	const next = random(1);
	let keys = spreadKeys(5);
	for (let step = 0; step < 2000; step += 1) {
		const index = Math.floor(next() * (keys.length + 1));
		const key = keyBetween(keys[index - 1], keys[index]);
		keys = [...keys.slice(0, index), key, ...keys.slice(index)];
	}

	assert.ok(keys.every((key) => isOrderKey(key)));
	assert.deepEqual(keys.toSorted(), keys);
	assert.equal(new Set(keys).size, keys.length);
});

test('adding at either end many times keeps keys short', () => {
	let last: string | undefined;
	let first: string | undefined;
	for (let step = 0; step < 500; step += 1) {
		last = keyBetween(last, undefined);
		first = keyBetween(undefined, first);
	}

	assert.ok(last!.length <= 3, last);
	assert.ok(first!.length <= 3, first);
});

test('spread keys for a long list are short, sorted, and distinct', () => {
	const keys = spreadKeys(10_000);
	assert.ok(keys.every((key) => isOrderKey(key) && key.length <= 4));
	assert.deepEqual(keys.toSorted(), keys);
	assert.equal(new Set(keys).size, keys.length);
	assert.deepEqual(spreadKeys(0), []);
});

test('keyBetween refuses keys that are malformed or out of order', () => {
	assert.throws(() => keyBetween('a1', 'a0'), RangeError);
	assert.throws(() => keyBetween('a0', 'a0'), RangeError);
	assert.throws(() => keyBetween('a00'), TypeError);
	assert.throws(() => keyBetween('a-b'), TypeError);
});

const stamp = (offset: number) => tick(startClock(), T0 + offset).h;

test('parseChange keeps a valid change and drops malformed ones', () => {
	const tab = {
		kind: 'tab',
		id: 't1',
		parentId: 's1',
		h: stamp(0),
		d: 'device-a',
		o: 'a0',
		value: {url: 'https://example.com/'},
	};
	assert.deepEqual(parseChange({...tab, extra: 1}), tab);

	const deleted = {
		kind: 'bookmark',
		id: 'b1',
		h: stamp(0),
		d: 'a',
		deleted: true,
	};
	assert.deepEqual(parseChange(deleted), deleted);

	for (const bad of [
		{...tab, kind: 'window'},
		{...tab, id: ''},
		{...tab, id: 'x'.repeat(101)},
		{...tab, parentId: undefined},
		{...tab, kind: 'session'},
		{...tab, h: 'yesterday'},
		{...tab, d: ''},
		{...tab, o: 'a00'},
		{...tab, value: undefined},
		{...deleted, value: {}},
		'change',
	]) {
		assert.equal(parseChange(bad), undefined, JSON.stringify(bad));
	}
});

test('the newest stamp wins whatever order changes arrive in', () => {
	const older: SyncChange = {
		kind: 'folder',
		id: 'f',
		h: stamp(1),
		d: 'b',
		value: 'Old',
	};
	const newer: SyncChange = {
		kind: 'folder',
		id: 'f',
		h: stamp(2),
		d: 'a',
		value: 'New',
	};
	const tie: SyncChange = {...newer, d: 'c', value: 'Tie'};
	for (const order of [
		[older, newer, tie],
		[tie, newer, older],
		[newer, tie, older],
	]) {
		const records = new Map<string, SyncChange>();
		mergeInto(records, order);
		assert.equal(records.get('folder:f')?.value, 'Tie');
	}
});

test('a tab is keyed under its session', () => {
	assert.notEqual(
		recordKey({kind: 'tab', id: 't', parentId: 's1'}),
		recordKey({kind: 'tab', id: 't', parentId: 's2'}),
	);
});

for (const [name, makeLog] of LOGS) {
	test(`the log refuses stamps far in the future and keeps the newer version (${name})`, () => {
		const log = makeLog();
		const change: SyncChange = {
			kind: 'column',
			id: 'c',
			h: stamp(5),
			d: 'a',
			value: 1,
		};
		assert.deepEqual(
			log.push(
				[
					change,
					{...change, h: stamp(1)},
					{...change, h: stamp(MAX_CLOCK_DRIFT_MS + 1)},
				],
				T0,
			),
			['applied', 'superseded', 'clock'],
		);
		assert.deepEqual(log.pull(0, 10), {
			resync: false,
			changes: [change],
			cursor: 1,
			more: false,
		});
	});
}

for (const [name, makeLog] of LOGS) {
	test(`a pull returns one change per record, in pages (${name})`, () => {
		const log = makeLog();
		for (let edit = 0; edit < 3; edit += 1) {
			log.push(
				['a', 'b', 'c'].map((id) => ({
					kind: 'folder',
					id,
					h: stamp(edit * 10),
					d: 'x',
					value: edit,
				})),
				T0,
			);
		}

		const first = log.pull(0, 2);
		assert.ok(!first.resync);
		assert.deepEqual(
			first.changes.map((change) => change.value),
			[2, 2],
		);
		assert.ok(first.more);
		const second = log.pull(first.cursor, 2);
		assert.ok(!second.resync);
		assert.equal(second.changes.length, 1);
		assert.ok(!second.more);
		assert.deepEqual(log.pull(second.cursor, 2), {
			resync: false,
			changes: [],
			cursor: 9,
			more: false,
		});
	});
}

for (const [name, makeLog] of LOGS) {
	test(`a device that missed a purged delete must resync, and its old edit cannot bring the record back (${name})`, () => {
		const log = makeLog();
		const created: SyncChange = {
			kind: 'session',
			id: 's',
			h: stamp(0),
			d: 'a',
			value: 'Work',
		};
		log.push([created], T0);
		const staleCursor = log.cursor;
		log.push(
			[{kind: 'session', id: 's', h: stamp(DAY), d: 'b', deleted: true}],
			T0 + DAY,
		);
		log.purge(T0 + 31 * DAY);

		assert.deepEqual(log.pull(staleCursor, 10), {resync: true});
		assert.deepEqual(pullAll(log), []);
		const offlineEdit = {
			...created,
			h: stamp(DAY / 2),
			value: 'Work (renamed offline)',
		};
		assert.deepEqual(log.push([offlineEdit], T0 + 31 * DAY), ['stale']);
		assert.deepEqual(pullAll(log), []);
	});
}

type Device = {
	id: string;
	clock: Clock;
	records: Map<string, SyncChange>;
	outbox: Map<string, SyncChange>;
	cursor: number;
};

function makeDevice(id: string): Device {
	return {
		id,
		clock: startClock(),
		records: new Map(),
		outbox: new Map(),
		cursor: 0,
	};
}

function write(
	device: Device,
	now: number,
	change: Omit<SyncChange, 'h' | 'd'>,
) {
	const next = tick(device.clock, now);
	device.clock = next.clock;
	const stamped = {...change, h: next.h, d: device.id};
	mergeInto(device.records, [stamped]);
	device.outbox.set(recordKey(stamped), stamped);
}

function receive(device: Device, changes: SyncChange[], now: number) {
	for (const change of changes) {
		device.clock = observe(device.clock, change.h, now);
	}

	mergeInto(device.records, changes);
}

/**
Syncs one device and adds each push result, and `resync` when it had to resync, to `outcomes`.
*/
function sync(
	device: Device,
	log: SyncLog,
	now: number,
	outcomes = new Set<string>(),
) {
	const pending = [...device.outbox.values()];
	device.outbox.clear();
	for (const [index, result] of log.push(pending, now).entries()) {
		outcomes.add(result);
		// The app would report a refused change; dropping it keeps the copy in line with the server.
		if (result === 'stale' || result === 'clock') {
			device.records.delete(recordKey(pending[index]));
		}
	}

	for (;;) {
		const response = log.pull(device.cursor, 4);
		if (response.resync) {
			outcomes.add('resync');
			device.records = new Map();
			device.cursor = 0;
			continue;
		}

		receive(device, response.changes, now);
		device.cursor = response.cursor;
		if (!response.more) {
			return;
		}
	}
}

const live = (records: Map<string, SyncChange>): Record<string, unknown> =>
	Object.fromEntries(
		[...records]
			.filter(([, change]) => !change.deleted)
			.map(([key, change]): [string, unknown] => [key, change.value]),
	);

for (const [name, makeLog] of LOGS) {
	test(`devices editing offline and syncing in any order end with the same library (${name})`, () => {
		const outcomes = new Set<string>();
		for (let seed = 1; seed <= 40; seed += 1) {
			const next = random(seed);
			const log = makeLog();
			const devices = ['a', 'b', 'c'].map((id) => makeDevice(id));
			const skew = [0, -90_000, 120_000];
			let now = T0;

			for (let step = 0; step < 300; step += 1) {
				now += Math.floor(next() * 16 * 60 * 60 * 1000);
				const index = Math.floor(next() * devices.length);
				const device = devices[index];
				const deviceNow = now + skew[index];
				const roll = next();
				const id = `s${Math.floor(next() * 12)}`;
				if (roll < 0.45) {
					write(device, deviceNow, {
						kind: 'session',
						id,
						value: `${device.id}${step}`,
					});
				} else if (roll < 0.6) {
					write(device, deviceNow, {kind: 'session', id, deleted: true});
				} else if (roll < 0.95) {
					// Device c is mostly offline, so it misses purged deletes and pushes old edits.
					if (device.id !== 'c' || next() < 0.1) {
						sync(device, log, now, outcomes);
					}
				} else {
					log.purge(now - 30 * DAY);
				}
			}

			for (const device of [...devices, ...devices]) {
				sync(device, log, now, outcomes);
			}

			const expected = live(
				new Map(pullAll(log).map((change) => [recordKey(change), change])),
			);
			for (const device of devices) {
				assert.deepEqual(
					live(device.records),
					expected,
					`seed ${seed}, device ${device.id}`,
				);
			}
		}

		assert.deepEqual(
			[...outcomes].toSorted(),
			['applied', 'resync', 'stale', 'superseded'],
			'the simulation reaches every path',
		);
	});
}
