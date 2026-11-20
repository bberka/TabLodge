/*
The guard that keeps every setting syncing (#397). A setting stays on one device only when
src/shared/local-settings.ts lists it with a reason and docs/PRIVACY.md lists it too. Without this, a new setting, or
one cut out of sync on the way, would silently stay behind in one browser.
*/
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';
import {
	ANDROID_LOCAL_PREFERENCES,
	EXTENSION_DEVICE_STORAGE,
	EXTENSION_LOCAL_SETTINGS,
} from '../src/shared/local-settings';
import {assemble, splitLibrary} from '../src/shared/sync/library-records';
import type {Settings, Store} from '../src/shared/types';

const RULE =
	'Every setting syncs unless src/shared/local-settings.ts lists it with the reason it stays on the device, and docs/PRIVACY.md lists it under "What stays on each device".';

const store = (settings: Record<string, unknown>): Store => ({
	schemaVersion: 10,
	groups: [],
	folders: [],
	bookmarkColumns: [],
	bookmarks: [],
	settings: settings as Settings,
	updatedAt: 0,
});

// Holds the settings of a newer version; it travels as them, never as itself.
const HOLDER = 'heldSettings';

test('every setting in the library reaches another device, unless it is listed as local with a reason', () => {
	const keys = Object.keys(DEFAULT_SETTINGS).filter((key) => key !== HOLDER);
	// A value no device has, so only sync can put it there.
	const probe = (key: string) => ({probe: key});
	const sent = store({
		...DEFAULT_SETTINGS,
		...Object.fromEntries(keys.map((key) => [key, probe(key)])),
	});
	const arrived = assemble(
		splitLibrary(sent).values(),
		store({...DEFAULT_SETTINGS}),
	).settings as unknown as Record<string, unknown>;

	for (const key of keys) {
		const local = Object.hasOwn(EXTENSION_LOCAL_SETTINGS, key);
		const synced = JSON.stringify(arrived[key]) === JSON.stringify(probe(key));
		assert.ok(
			synced || local,
			`The setting "${key}" does not sync and is not listed as local. ${RULE}`,
		);
		assert.ok(
			!(synced && local),
			`The setting "${key}" is listed as local in local-settings.ts but syncs. Take it off the list.`,
		);
	}
});

test('every listed local setting has a reason and is named in docs/PRIVACY.md', () => {
	const privacy = readFileSync(
		join(import.meta.dirname, '..', '..', '..', 'docs', 'PRIVACY.md'),
		'utf8',
	);
	const section = privacy.split('## What stays on each device', 2)[1];
	assert.ok(
		section,
		'docs/PRIVACY.md has a "What stays on each device" section',
	);
	const listed = section.split('\n## ', 1)[0];
	for (const [key, reason] of Object.entries({
		...EXTENSION_LOCAL_SETTINGS,
		...EXTENSION_DEVICE_STORAGE,
		...ANDROID_LOCAL_PREFERENCES,
	})) {
		assert.ok(reason.length > 10, `"${key}" needs a reason. ${RULE}`);
		assert.ok(
			listed.includes(`\`${key}\``),
			`"${key}" stays on the device but docs/PRIVACY.md does not list it. ${RULE}`,
		);
	}
});

/*
Stored keys that hold data rather than settings: the library, recovery copies, caches, and sync bookkeeping. A new
setting that takes a storage key of its own instead of a field in the library's settings does not sync, so it must be
listed in local-settings.ts; a new key for data goes here.
*/
const DATA_KEYS = new Set([
	'tablodge.state',
	'tablodge.state.premigration',
	'tablodge.migration',
	'tablodge.session.',
	'tablodge.bookmarks.',
	'tablodge.snapshots',
	'tablodge.snapshots.live',
	'tablodge.snapshots.meta',
	'tablodge.backups',
	'tablodge.trash',
	'tablodge.undo',
	'tablodge.copies',
	'tablodge.copy.',
	'tablodge.siteIcons',
	'tablodge.siteIcons.missing',
	'tablodge.sync.state',
	'tablodge.sync.status',
	'tablodge.sync.nudge',
	'tablodge.private.',
	'tablodge.private.focus',
	'tablodge.privatelock.active',
	'tablodge.privatelock.attempts',
	'tablodge.privatelock.key',
	'tablodge.privatelock.windows',
	'tablodge.locked',
	'tablodge.locked.attempts',
	'tablodge.locked.flag',
	'tablodge.locked.key',
]);

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) {
			return sourceFiles(path);
		}

		return /\.tsx?$/.test(name) ? [path] : [];
	});
}

test('every storage key in the extension is data or a setting listed as local', () => {
	const root = join(import.meta.dirname, '..');
	const found = new Set<string>();
	for (const file of [
		...sourceFiles(join(root, 'src')),
		...sourceFiles(join(root, 'shell')),
	]) {
		for (const match of readFileSync(file, 'utf8').matchAll(
			/'(tablodge\.[\w\-.]+|uiTheme|uiAccent)'/g,
		)) {
			found.add(match[1]);
		}
	}

	assert.ok(found.has('tablodge.state'), 'the scan finds storage keys');
	for (const key of found) {
		assert.ok(
			DATA_KEYS.has(key) || Object.hasOwn(EXTENSION_DEVICE_STORAGE, key),
			`The storage key "${key}" is neither data (DATA_KEYS in this test) nor listed in local-settings.ts. A setting belongs in the library's settings so it syncs. ${RULE}`,
		);
	}
});
