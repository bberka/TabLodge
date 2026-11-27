import assert from 'node:assert/strict';
import {strToU8, zipSync} from 'fflate';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {
	base64ToBytes,
	type SavedThumb,
} from '../../extension/src/shared/image-store';
import {picture} from '../../extension/tests/image-fixtures';
import {looksEncrypted} from '../../extension/src/shared/crypto-envelope';
import {
	backupImageFile,
	buildFullBackup,
	protectFullBackup,
	readFullBackup,
	readProtectedFullBackup,
} from '../../extension/src/shared/full-backup';
import {normalizeStore} from '../../extension/src/shared/library-normalize';
import {addBookmark} from '../src/library/board-edits';
import {createLibraryCore} from '../src/library/library-core';
import {addSession} from '../src/library/session-edits';
import {emptyStore} from '../src/library/store-shape';
import {buildBackup, readBackup} from '../src/transfer/backup';
import type {PageCopy} from '../../extension/src/shared/page-copy';
import {
	dropSafetyCopy,
	keepSafetyCopy,
	readSafetyCopy,
	replaceLibrary,
	runBackupRestore,
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

const {failWrite, holds, memory} = await import('./support/memory-storage');
const NOW = 1_700_000_000_000;

beforeEach(() => {
	memory.clear();
	failWrite.clear();
	holds.read.clear();
	holds.write.clear();
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
			copies: 0,
			images: 0,
		});
		assert.equal(contents.snapshots, null);
		assert.equal(contents.trash, null);
		assert.equal(contents.preferences, null);
		const restored = normalizeStore(contents.state as Record<string, unknown>);
		assert.deepEqual(idsOf(restored), idsOf(store));
	});

	test('bookmark notes come back from a backup on the phone and in the extension', async () => {
		const store = addBookmark(
			phoneLibrary(),
			{
				url: 'https://noted.example/',
				title: 'Noted',
				columnId: '',
				notes: 'Kept in the backup',
			},
			'noted',
			1,
		);
		const file = await buildBackup(store, 'TabLodge');
		const onPhone = await readBackup(file.bytes);
		assert.ok(onPhone.ok);
		const note = (bookmarks: Array<{id: string; notes?: string}>) =>
			bookmarks.find((entry) => entry.id === 'noted')?.notes;
		assert.equal(note(onPhone.store.bookmarks), 'Kept in the backup');
		const contents = readFullBackup(file.bytes);
		assert.ok(contents);
		assert.equal(
			note(normalizeStore(contents.state as Record<string, unknown>).bookmarks),
			'Kept in the backup',
		);
	});

	test('bookmark tags and removed kinds come back from a backup on the phone and in the extension', async () => {
		const store = addBookmark(
			phoneLibrary(),
			{
				url: 'https://www.imdb.com/title/tt0111161/',
				title: 'Tagged',
				columnId: '',
				tags: ['classic'],
				hiddenKinds: ['movie'],
			},
			'tagged',
			1,
		);
		const file = await buildBackup(store, 'TabLodge');
		const onPhone = await readBackup(file.bytes);
		assert.ok(onPhone.ok);
		const tags = (
			bookmarks: Array<{id: string; tags?: string[]; hiddenKinds?: string[]}>,
		) => {
			const entry = bookmarks.find((bookmark) => bookmark.id === 'tagged');
			return [entry?.tags, entry?.hiddenKinds];
		};

		assert.deepEqual(tags(onPhone.store.bookmarks), [['classic'], ['movie']]);
		const contents = readFullBackup(file.bytes);
		assert.ok(contents);
		assert.deepEqual(
			tags(normalizeStore(contents.state as Record<string, unknown>).bookmarks),
			[['classic'], ['movie']],
		);
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

	test('page copies travel in the ZIP and come back for checking on restore', async () => {
		const copy: PageCopy = {
			v: 1,
			url: 'https://a.example/',
			title: 'A',
			savedAt: 1,
			blocks: [{type: 'paragraph', text: 'Kept'}],
		};
		const file = await buildBackup(
			phoneLibrary(1, 1, 1),
			'TabLodge',
			undefined,
			'regular',
			[copy],
		);
		const contents = readFullBackup(file.bytes)!;
		assert.deepEqual(contents.copies, [copy]);
		const restored = await readBackup(file.bytes);
		assert.ok(restored.ok);
		assert.deepEqual(restored.copies, [copy]);
		assert.equal(restored.counts.copies, 1);
	});

	test('thumbnails travel in the ZIP, and an extension backup gives the phone thumbnails without the picture files', async () => {
		const {data, ...thumb} = picture();
		const file = await buildBackup(
			phoneLibrary(1, 1, 1),
			'TabLodge',
			undefined,
			'regular',
			[],
			[thumb as SavedThumb],
		);
		const own = await readBackup(file.bytes);
		assert.ok(own.ok);
		assert.deepEqual(own.images, [thumb]);
		assert.equal(own.counts.images, 1);

		const fromExtension = buildFullBackup(
			{
				state: phoneLibrary(1, 1, 1),
				preferences: null,
				snapshots: null,
				trash: null,
				images: [thumb],
				imageFiles: {
					[backupImageFile({url: thumb.url, type: 'image/png'})]:
						base64ToBytes(data),
				},
			},
			{appVersion: '1'},
		);
		const read = await readBackup(fromExtension.bytes);
		assert.ok(read.ok);
		assert.deepEqual(read.images, [thumb], 'no original is read on the phone');
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
			settings: {
				sessionSort: 'oldest',
				excludedOrigins: ['skip.example'],
			} as never,
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
	}, 30_000);

	test('a backup with more sessions than the extension once held keeps every one of them', async () => {
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
		assert.equal(result.counts.sessions, 1001);
		assert.equal(result.skipped, 0);
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
			settings: {sessionSort: 'oldest'} as never,
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

	test('runBackupRestore reports partial restore when a step after library replacement fails', async () => {
		const failedBefore = await runBackupRestore({
			keepSafety: async () => undefined,
			async replace() {
				throw new Error('disk full');
			},
			afterReplace: async () => undefined,
		});
		assert.deepEqual(failedBefore, {status: 'failed'});

		const partial = await runBackupRestore({
			keepSafety: async () => undefined,
			replace: async () => undefined,
			async afterReplace() {
				throw new Error('thumbnail write failed');
			},
		});
		assert.deepEqual(partial, {
			status: 'partial',
			detail: 'thumbnail write failed',
		});

		const ok = await runBackupRestore({
			keepSafety: async () => undefined,
			replace: async () => undefined,
			afterReplace: async () => undefined,
		});
		assert.deepEqual(ok, {status: 'ok'});
	});

	test('createLibraryCore.write restores the previous library in memory when storage write fails', async () => {
		const core = createLibraryCore('tablodge.library');
		const original = phoneLibrary(2, 1, 1);
		const backup = phoneLibrary(1, 1, 0);
		core.load(original);
		const seen: Array<ReturnType<typeof phoneLibrary>> = [];
		const stop = core.subscribe(() => {
			seen.push(core.store);
		});

		failWrite.add('tablodge.library');
		const outcome = await runBackupRestore({
			keepSafety: async () => undefined,
			replace: async () =>
				core.mutate(async () =>
					core.write(replaceLibrary(core.store, backup, NOW + 1)),
				),
			afterReplace: async () => undefined,
		});
		stop();

		assert.deepEqual(outcome, {status: 'failed'});
		assert.equal(core.store, original);
		assert.equal(seen.at(-1), original);
	});

	test('loadLibrary resolves whenLibraryLoaded to false on read failure and true for an empty library', async () => {
		vi.stubGlobal('__DEV__', false);
		try {
			vi.resetModules();
			const failedRead = Promise.reject(new Error('read failed'));
			failedRead.catch(() => undefined);
			holds.read.set('tablodge.library', failedRead);
			const failingStore = await import('../src/library/library-store');
			await assert.rejects(failingStore.loadLibrary(), /read failed/);
			assert.equal(await failingStore.whenLibraryLoaded(), false);

			vi.resetModules();
			const emptyLibraryStore = await import('../src/library/library-store');
			await emptyLibraryStore.loadLibrary();
			assert.equal(await emptyLibraryStore.whenLibraryLoaded(), true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
