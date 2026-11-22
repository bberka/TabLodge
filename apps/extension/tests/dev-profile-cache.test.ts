import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {
	clearServiceWorkerCache,
	serviceWorkerCachePath,
} from '../scripts/browser/dev-profile-cache.ts';

test('a dev profile keeps its storage but loses the cached service worker', async () => {
	const userDataDir = await mkdtemp(join(tmpdir(), 'tablodge-dev-profile-'));
	try {
		const cachedScript = join(
			serviceWorkerCachePath(userDataDir),
			'ScriptCache',
			'index',
		);
		const storedState = join(
			userDataDir,
			'Default',
			'Local Extension Settings',
			'state',
		);
		const cookie = join(userDataDir, 'Default', 'Cookies');
		await mkdir(join(cachedScript, '..'), {recursive: true});
		await mkdir(join(storedState, '..'), {recursive: true});
		await writeFile(cachedScript, 'stale worker');
		await writeFile(storedState, 'library');
		await writeFile(cookie, 'session');

		await clearServiceWorkerCache(userDataDir);

		assert.equal(existsSync(serviceWorkerCachePath(userDataDir)), false);
		assert.equal(existsSync(storedState), true);
		assert.equal(existsSync(cookie), true);
	} finally {
		await rm(userDataDir, {recursive: true, force: true});
	}
});

test('clearing a profile that was never used does nothing', async () => {
	const userDataDir = await mkdtemp(join(tmpdir(), 'tablodge-dev-profile-'));
	try {
		await clearServiceWorkerCache(userDataDir);
		assert.equal(existsSync(serviceWorkerCachePath(userDataDir)), false);
	} finally {
		await rm(userDataDir, {recursive: true, force: true});
	}
});
