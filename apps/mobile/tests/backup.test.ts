/*
The phone's full backup against the extension's own full-backup code, both ways, with and without a password. The
password wrap runs the native module's stand-in (tests/support/fake-crypto.ts), so what these tests cannot show is that
the Kotlin module writes and reads the same bytes; that needs a device.
*/
import assert from 'node:assert/strict';
import {strToU8, zipSync} from 'fflate';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {looksEncrypted} from '../../extension/src/shared/crypto-envelope';
import {
	buildFullBackup,
	protectFullBackup,
	readFullBackup,
	readProtectedFullBackup,
} from '../../extension/src/shared/full-backup';
import {normalizeStore} from '../../extension/src/shared/library-normalize';
import {addBookmark, addSession, emptyStore} from '../src/library/library';
import {buildBackup, readBackup} from '../src/transfer/backup';
import {
	dropSafetyCopy,
	keepSafetyCopy,
	readSafetyCopy,
	replaceLibrary,
} from '../src/transfer/restore';

vi.mock('expo-constants', () => ({default: {expoConfig: {version: '9.9.9'}}}));
vi.mock('expo-crypto', () => ({
	randomUUID: () => globalThis.crypto.randomUUID(),
}));
vi.mock(
	'../modules/tablodge-crypto',
	async () => import('./support/fake-crypto'),
);
vi.mock(
	'../src/platform/storage',
	async () => import('./support/memory-storage'),
);
vi.mock(
	'../src/settings/preferences',
	async () => import('./support/fake-preferences'),
);

const {memory} = await import('./support/memory-storage');
const NOW = 1_700_000_000_000;

beforeEach(() => {
	memory.clear();
});

function phoneLibrary(sessions = 3, perSession = 4, bookmarks = 5) {
	let store = emptyStore(NOW);
	for (let index = 0; index < sessions; index += 1) {
		store = addSession(
			store,
			{
				name: `Session ${index}`,
				urls: Array.from(
					{length: perSession},
					(_, tab) => `https://s${index}.example/${tab}`,
				),
			},
			`session-${index}`,
			[],
			NOW + index,
		);
	}

	for (let index = 0; index < bookmarks; index += 1) {
		store = addBookmark(
			store,
			{
				url: `https://b${index}.example/`,
				title: `Bookmark ${index}`,
				columnId: '',
			},
			`bookmark-${index}`,
			NOW + index,
		);
	}

	return store;
}

const idsOf = (store: ReturnType<typeof emptyStore>) => ({
	sessions: store.groups.map((group) => group.id).toSorted(),
	tabs: store.groups
		.flatMap((group) => group.tabs.map((tab) => tab.id))
		.toSorted(),
	bookmarks: store.bookmarks.map((bookmark) => bookmark.id).toSorted(),
});

describe('a backup the phone makes, read by the extension', () => {
	test('a plain ZIP is read by the extension’s own reader, with empty snapshots and trash', async () => {
		const store = phoneLibrary();
		const file = await buildBackup(store, 'TabLodge');
		assert.match(file.filename, /^tablodge-full-\d{4}-\d{2}-\d{2}\.zip$/);
		assert.equal(file.mime, 'application/zip');
		const contents = readFullBackup(file.bytes);
		assert.ok(contents);
		assert.equal(contents.manifest.appVersion, '9.9.9');
		assert.deepEqual(contents.counts, {
			sessions: 3,
			links: 12,
			folders: 1,
			columns: 1,
			bookmarks: 5,
			snapshots: 0,
			trash: 0,
		});
		assert.equal(contents.snapshots, null);
		assert.equal(contents.trash, null);
		assert.equal(contents.preferences, null);
		// What the extension's restore keeps: its own normalizer returns every session, tab, and bookmark.
		const restored = normalizeStore(contents.state as Record<string, unknown>);
		assert.deepEqual(idsOf(restored), idsOf(store));
	});

	test('a password gives a .zip.enc the extension opens with that password, and not with another', async () => {
		const store = phoneLibrary();
		const file = await buildBackup(store, 'TabLodge', 'correct horse battery');
		assert.match(file.filename, /\.zip\.enc$/);
		assert.ok(looksEncrypted(file.bytes));
		await assert.rejects(
			readProtectedFullBackup(file.bytes, 'wrong password here'),
			/wrong|changed/i,
		);
		const contents = await readProtectedFullBackup(
			file.bytes,
			'correct horse battery',
		);
		assert.ok(contents);
		assert.deepEqual(
			idsOf(normalizeStore(contents.state as Record<string, unknown>)),
			idsOf(store),
		);
	});

	test('the private library’s file says so in its name', async () => {
		const file = await buildBackup(
			phoneLibrary(1, 1, 1),
			'TabLodge',
			undefined,
			'private',
		);
		assert.match(file.filename, /^tablodge-private-full-/);
	});

	test('the phone’s own settings travel in the library settings the extension keeps as an unread entry', async () => {
		const file = await buildBackup(phoneLibrary(1, 1, 1), 'TabLodge');
		const contents = readFullBackup(file.bytes)!;
		assert.deepEqual(
			(contents.state as {settings: {mobileApp: unknown}}).settings.mobileApp,
			{look: 'material'},
		);
		const restored = await readBackup(file.bytes);
		assert.ok(restored.ok);
		assert.deepEqual(restored.phoneSettings, {look: 'material'});
	});
});

describe('a backup the extension makes, read by the phone', () => {
	const extensionParts = () => ({
		state: {
			...phoneLibrary(2, 3, 4),
			settings: {copyFormat: 'url', excludedOrigins: ['skip.example']} as never,
		},
		preferences: {uiTheme: 'dark', uiAccent: 'rose'},
		snapshots: {
			version: 1,
			history: [
				{
					id: 'snap',
					at: 5,
					reason: 'interval',
					windows: [
						{
							focused: true,
							state: 'normal',
							groups: [],
							tabs: [
								{url: 'https://snap.example/', title: 'Snap', columnId: ''},
							],
						},
					],
				},
			],
		},
		trash: {
			version: 1,
			items: [
				{
					id: 'gone',
					kind: 'bookmark',
					deletedAt: 1,
					label: 'Gone',
					origin: '',
					count: 1,
					data: {},
				},
			],
		},
	});

	test('a plain ZIP restores: the library comes through, the extension-only parts are ignored, and there are no phone settings', async () => {
		const parts = extensionParts();
		const {bytes} = buildFullBackup(parts, {appVersion: '1.2.3'});
		const result = await readBackup(bytes);
		assert.ok(result.ok);
		assert.deepEqual(idsOf(result.store), idsOf(parts.state));
		assert.equal(result.phoneSettings, undefined);
		assert.equal(result.counts.sessions, 2);
		assert.equal(result.counts.links, 6);
		assert.equal(result.counts.bookmarks, 4);
	});

	test('a password-protected ZIP asks for its password, refuses a wrong one, and opens with the right one', async () => {
		const parts = extensionParts();
		const {bytes} = buildFullBackup(parts, {appVersion: '1.2.3'});
		const locked = await protectFullBackup(bytes, {
			kind: 'password',
			value: 'correct horse battery',
		});
		assert.equal((await readBackup(locked)).ok, false);
		const missing = await readBackup(locked);
		assert.ok(!missing.ok);
		assert.strictEqual(missing.reason, 'password');
		const wrong = await readBackup(locked, 'nope nope nope');
		assert.ok(!wrong.ok);
		assert.strictEqual(wrong.reason, 'wrong');
		const result = await readBackup(locked, 'correct horse battery');
		assert.ok(result.ok);
		assert.deepEqual(idsOf(result.store), idsOf(parts.state));
	});

	test('a PIN-protected ZIP opens with the PIN', async () => {
		const {bytes} = buildFullBackup(extensionParts(), {appVersion: '1'});
		const locked = await protectFullBackup(bytes, {
			kind: 'pin',
			value: '482913',
		});
		const result = await readBackup(locked, '482913');
		assert.ok(result.ok);
	});

	test('a backup missing its optional parts, or with junk in the library, still restores what is valid', async () => {
		const zip = zipSync({
			'manifest.json': strToU8(
				JSON.stringify({format: 'tablodge-full-backup', version: 1}),
			),
			'data.json': strToU8(
				JSON.stringify({
					groups: [null, 7],
					folders: [],
					bookmarkColumns: [],
					bookmarks: [
						null,
						5,
						{url: 'javascript:alert(1)'},
						{url: 'https://ok.example/', title: 'Ok', columnId: ''},
					],
				}),
			),
		});
		const result = await readBackup(zip);
		assert.ok(result.ok);
		assert.deepEqual(
			result.store.bookmarks.map((bookmark) => bookmark.url),
			['https://ok.example/'],
		);
		assert.equal(result.counts.bookmarks, 1);
		// The file listed 2 bad sessions and 4 bookmarks of which 3 are unusable.
		assert.equal(result.skipped, 5);
	});

	test('files that are not backups, damaged ones, and newer ones are refused with a message', async () => {
		const text = await readBackup(strToU8('{"groups":[]}'));
		assert.ok(!text.ok);
		assert.strictEqual(text.reason, 'damaged');
		const other = await readBackup(
			zipSync({'manifest.json': strToU8('{"format":"x"}')}),
		);
		assert.ok(!other.ok);
		const newer = await readBackup(
			zipSync({
				'manifest.json': strToU8(
					'{"format":"tablodge-full-backup","version":2}',
				),
				'data.json': strToU8('{}'),
			}),
		);
		assert.ok(!newer.ok);
		assert.match(newer.message, /newer/);
		const {bytes} = buildFullBackup(extensionParts(), {appVersion: '1'});
		const cut = await readBackup(bytes.slice(0, -40));
		assert.ok(!cut.ok);
		assert.strictEqual(cut.reason, 'damaged');
		const locked = await protectFullBackup(bytes, {
			kind: 'password',
			value: 'correct horse battery',
		});
		const hurt = locked.slice();
		hurt[40] = hurt[40] === 0 ? 1 : 0;
		const changed = await readBackup(hurt, 'correct horse battery');
		assert.ok(!changed.ok);
		assert.strictEqual(changed.reason, 'wrong');
	});
});

describe('large libraries', () => {
	test('a library of thousands of links makes a backup, round trips, and does so in seconds, with and without a password', async () => {
		const store = phoneLibrary(900, 12, 20_000);
		const started = performance.now();
		const plain = await buildBackup(store, 'TabLodge');
		const built = performance.now() - started;
		const result = await readBackup(plain.bytes);
		const read = performance.now() - started - built;
		assert.ok(result.ok);
		assert.equal(result.counts.links, 10_800);
		assert.equal(result.skipped, 0);
		assert.equal(result.counts.bookmarks, 20_000);
		const locked = await buildBackup(
			store,
			'TabLodge',
			'correct horse battery',
		);
		const reopened = await readBackup(locked.bytes, 'correct horse battery');
		assert.ok(reopened.ok);
		assert.equal(reopened.counts.bookmarks, 20_000);
		assert.ok(built < 10_000);
		assert.ok(read < 10_000);
	});

	test('more sessions than the extension holds are reported as left out, not silently dropped', async () => {
		const {bytes} = buildFullBackup(
			{
				state: phoneLibrary(1001, 1, 0),
				preferences: null,
				snapshots: null,
				trash: null,
			},
			{appVersion: '1'},
		);
		const result = await readBackup(bytes);
		assert.ok(result.ok);
		assert.equal(result.counts.sessions, 1000);
		assert.equal(result.skipped, 2);
	});

	test('a backup that would unpack to more than the limit is refused, not read', async () => {
		const huge = zipSync({
			'manifest.json': strToU8('{"format":"tablodge-full-backup","version":1}'),
			'data.json': new Uint8Array(61 * 1024 * 1024).fill(32),
		});
		const result = await readBackup(huge);
		assert.ok(!result.ok);
		assert.match(result.message, /too large/);
	});
});

describe('restoring replaces the library, with a safety copy first', () => {
	test('the backup’s items replace the library’s, its settings stay, and the safety copy brings it all back', async () => {
		const current = {
			...phoneLibrary(2, 2, 2),
			settings: {copyFormat: 'url'} as never,
		};
		const backup = phoneLibrary(1, 1, 1);
		await keepSafetyCopy('regular', current, NOW, {look: 'ios'});
		const next = replaceLibrary(current, backup, NOW + 1);
		assert.deepEqual(idsOf(next), idsOf(backup));
		assert.deepEqual(next.settings, current.settings);

		const copy = await readSafetyCopy('regular');
		assert.ok(copy);
		assert.deepEqual(copy.store, current);
		assert.deepEqual(copy.preferences, {look: 'ios'});
		assert.equal(await readSafetyCopy('private'), undefined);
		await dropSafetyCopy('regular');
		assert.equal(await readSafetyCopy('regular'), undefined);
	});
});
