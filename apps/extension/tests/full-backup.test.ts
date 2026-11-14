import assert from 'node:assert/strict';
import {strToU8, unzipSync, zipSync} from 'fflate';
import {test} from 'vite-plus/test';
import {
	FullBackupError,
	buildFullBackup,
	countFullBackup,
	fullBackupFilename,
	looksLikeZip,
	protectFullBackup,
	protectedFullBackupFilename,
	readFullBackup,
	readProtectedFullBackup,
	type FullBackupParts,
} from '../src/app/full-backup';
import {looksEncrypted} from '../src/shared/crypto-envelope';

const parts: FullBackupParts = {
	state: {
		groups: [
			{
				id: 'g1',
				tabs: [{url: 'https://a.example/'}, {url: 'https://b.example/'}],
			},
		],
		folders: [{id: 'f1'}],
		bookmarkColumns: [{id: 'c1'}, {id: 'c2'}],
		bookmarks: [{id: 'b1'}],
		settings: {excludedOrigins: ['example.org']},
	},
	preferences: {uiTheme: 'dark'},
	snapshots: {version: 1, history: [{id: 's1'}, {id: 's2'}]},
	trash: {version: 1, items: [{id: 't1'}]},
};

test('a full backup round-trips through the ZIP', () => {
	const {bytes, manifest} = buildFullBackup(parts, {
		appVersion: '1.2.3',
		now: new Date('2026-03-04T05:06:07Z'),
	});
	assert.equal(looksLikeZip(bytes), true);
	assert.equal(manifest.format, 'tablodge-full-backup');
	assert.equal(manifest.version, 1);
	assert.equal(manifest.createdAt, '2026-03-04T05:06:07.000Z');
	assert.deepEqual(manifest.counts, {
		sessions: 1,
		links: 2,
		folders: 1,
		columns: 2,
		bookmarks: 1,
		snapshots: 2,
		trash: 1,
	});
	const read = readFullBackup(bytes);
	assert.ok(read);
	assert.equal(read.manifest.appVersion, '1.2.3');
	assert.deepEqual(read.state, parts.state);
	assert.deepEqual(read.preferences, parts.preferences);
	assert.deepEqual(read.snapshots, parts.snapshots);
	assert.deepEqual(read.trash, parts.trash);
	assert.deepEqual(read.counts, countFullBackup(parts));
});

test('the ZIP holds exactly the five files and the file name is dated', () => {
	const {bytes} = buildFullBackup(parts, {appVersion: '1'});
	const names = Object.keys(unzipSync(bytes)).toSorted();
	assert.deepEqual(names, [
		'data.json',
		'manifest.json',
		'preferences.json',
		'snapshots.json',
		'trash.json',
	]);
	assert.equal(
		fullBackupFilename('TabLodge', new Date(2026, 2, 4)),
		'tablodge-full-2026-03-04.zip',
	);
});

test('files that are not a TabLodge full backup are not claimed', () => {
	assert.equal(readFullBackup(strToU8('{"groups":[]}')), null);
	const other = zipSync({
		'manifest.json': strToU8('{"format":"something-else"}'),
	});
	assert.equal(readFullBackup(other), null);
	const noManifest = zipSync({'data.json': strToU8('{}')});
	assert.equal(readFullBackup(noManifest), null);
});

test('a newer format version, missing data and damaged files are rejected with a message', () => {
	const manifest = (version: number) =>
		strToU8(JSON.stringify({format: 'tablodge-full-backup', version}));
	assert.throws(
		() =>
			readFullBackup(
				zipSync({'manifest.json': manifest(2), 'data.json': strToU8('{}')}),
			),
		/newer TabLodge version/,
	);
	assert.throws(
		() => readFullBackup(zipSync({'manifest.json': manifest(1)})),
		FullBackupError,
	);
	assert.throws(
		() =>
			readFullBackup(
				zipSync({'manifest.json': manifest(1), 'data.json': strToU8('{oops')}),
			),
		/damaged/,
	);
	const {bytes} = buildFullBackup(parts, {appVersion: '1'});
	assert.throws(() => readFullBackup(bytes.slice(0, -40)), FullBackupError);
});

test('optional files may be missing', () => {
	const bytes = zipSync({
		'manifest.json': strToU8(
			JSON.stringify({format: 'tablodge-full-backup', version: 1}),
		),
		'data.json': strToU8('{"groups":[]}'),
	});
	const read = readFullBackup(bytes);
	assert.ok(read);
	assert.equal(read.preferences, undefined);
	assert.equal(read.counts.snapshots, 0);
});

test('a protected full backup is not a ZIP and reads back with the credential', async () => {
	const {bytes} = buildFullBackup(parts, {appVersion: '1.2.3'});
	const protectedBytes = await protectFullBackup(bytes, {
		kind: 'password',
		value: 'correct horse battery',
	});
	assert.equal(looksLikeZip(protectedBytes), false);
	assert.equal(looksEncrypted(protectedBytes), true);
	const text = new TextDecoder('latin1').decode(protectedBytes);
	for (const readable of ['example', 'manifest', 'tablodge', 'uiTheme']) {
		assert.equal(text.includes(readable), false, readable);
	}

	const read = await readProtectedFullBackup(
		protectedBytes,
		'correct horse battery',
	);
	assert.ok(read);
	assert.deepEqual(read.state, parts.state);
	assert.deepEqual(read.counts, countFullBackup(parts));
});

test('a wrong credential reads nothing from a protected backup', async () => {
	const {bytes} = buildFullBackup(parts, {appVersion: '1.2.3'});
	const protectedBytes = await protectFullBackup(bytes, {
		kind: 'pin',
		value: '2468',
	});
	await assert.rejects(
		readProtectedFullBackup(protectedBytes, '1357'),
		(error) => error instanceof FullBackupError && /wrong/i.test(error.message),
	);
});

test('a protected file that holds something else is not a full backup', async () => {
	const other = await protectFullBackup(strToU8('just text'), {
		kind: 'pin',
		value: '2468',
	});
	assert.equal(await readProtectedFullBackup(other, '2468'), null);
});

test('the protected file name keeps the date and says it is encrypted', () => {
	assert.equal(
		protectedFullBackupFilename('TabLodge', new Date(2026, 2, 4)),
		'tablodge-full-2026-03-04.zip.enc',
	);
});

test('a backup made while the locked area existed restores without it, even when locked.json is damaged', () => {
	const {bytes} = buildFullBackup(parts, {appVersion: '1'});
	const files = unzipSync(bytes);
	for (const locked of [
		strToU8(JSON.stringify({version: 1, kind: 'pin', envelope: 'VExFTg=='})),
		strToU8('{oops'),
	]) {
		const older = zipSync({...files, 'locked.json': locked});
		const read = readFullBackup(older);
		assert.ok(read);
		assert.equal('locked' in read, false);
		assert.deepEqual(read.state, parts.state);
		assert.deepEqual(read.counts, countFullBackup(parts));
	}
});
