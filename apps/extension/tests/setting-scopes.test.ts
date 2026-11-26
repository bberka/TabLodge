import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';
import {
	ANDROID_PREFERENCES,
	EXTENSION_STORAGE,
	keysScoped,
	LIBRARY_SETTINGS,
} from '../src/shared/setting-scopes';
import {assemble, splitLibrary} from '../src/shared/sync/library-records';
import type {Settings, Store} from '../src/shared/types';

const RULE =
	'Every setting has a scope in src/shared/setting-scopes.ts (all, platform, or device) with its reason, and docs/PRIVACY.md lists the device ones under "What stays on each device".';

const store = (settings: Record<string, unknown>): Store => ({
	schemaVersion: 10,
	groups: [],
	folders: [],
	bookmarkColumns: [],
	bookmarks: [],
	settings: settings as Settings,
	updatedAt: 0,
});

const HOLDER = 'heldSettings';
const settingKeys = Object.keys(DEFAULT_SETTINGS).filter(
	(key) => key !== HOLDER,
);

test('every setting has a scope and a reason, and every scope is for a setting', () => {
	for (const key of settingKeys) {
		assert.ok(
			Object.hasOwn(LIBRARY_SETTINGS, key),
			`The setting "${key}" has no scope. ${RULE}`,
		);
	}

	for (const [key, [, reason]] of Object.entries({
		...LIBRARY_SETTINGS,
		...EXTENSION_STORAGE,
		...ANDROID_PREFERENCES,
	})) {
		assert.ok(reason.length > 10, `"${key}" needs a reason. ${RULE}`);
	}

	for (const key of Object.keys(LIBRARY_SETTINGS)) {
		assert.ok(
			settingKeys.includes(key),
			`setting-scopes.ts scopes "${key}", which is no setting in the library.`,
		);
	}
});

test('a library setting reaches another device unless it is scoped to the device', () => {
	const probe = (key: string) => ({probe: key});
	const sent = store({
		...DEFAULT_SETTINGS,
		...Object.fromEntries(settingKeys.map((key) => [key, probe(key)])),
	});
	const arrived = assemble(
		splitLibrary(sent).values(),
		store({...DEFAULT_SETTINGS}),
	).settings as unknown as Record<string, unknown>;

	for (const key of settingKeys) {
		const device =
			LIBRARY_SETTINGS[key as keyof typeof LIBRARY_SETTINGS][0] === 'device';
		const synced = JSON.stringify(arrived[key]) === JSON.stringify(probe(key));
		assert.equal(
			synced,
			!device,
			device
				? `The setting "${key}" is scoped to the device but reaches another one.`
				: `The setting "${key}" does not sync. ${RULE}`,
		);
	}
});

test('every setting scoped to the device is named in docs/PRIVACY.md', () => {
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
	for (const key of [
		...keysScoped(LIBRARY_SETTINGS, 'device'),
		...keysScoped(EXTENSION_STORAGE, 'device'),
		...keysScoped(ANDROID_PREFERENCES, 'device'),
	]) {
		assert.ok(
			listed.includes(`\`${key}\``),
			`"${key}" stays on the device but docs/PRIVACY.md does not list it. ${RULE}`,
		);
	}
});

const DATA_KEYS = new Set([
	'tablodge.state',
	'tablodge.state.premigration',
	'tablodge.state.preupgrade',
	'tablodge.migration',
	'tablodge.session.',
	'tablodge.bookmarks.',
	'tablodge.sidx.',
	'tablodge.bmchunk.',
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
	'tablodge.sendprivate.cleanup',
	'tablodge.sendprivate.entry.',
	'tablodge.sendprivate.key',
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

test('every storage key in the extension is data or a scoped setting', () => {
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
			DATA_KEYS.has(key) || Object.hasOwn(EXTENSION_STORAGE, key),
			`The storage key "${key}" is neither data (DATA_KEYS in this test) nor scoped in setting-scopes.ts. A setting belongs in the library's settings so it syncs. ${RULE}`,
		);
	}
});

test('the phone reads exactly the library settings scoped to all devices', () => {
	const text = sourceFiles(
		join(import.meta.dirname, '..', '..', 'mobile', 'src'),
	)
		.map((file) => readFileSync(file, 'utf8'))
		.join('\n');
	const read = settingKeys.filter((key) => {
		const direct = new RegExp(
			String.raw`settings\.${key}\b|Settings\['${key}'\]`,
		);
		return (
			direct.test(text) ||
			(!Object.hasOwn(ANDROID_PREFERENCES, key) && text.includes(`'${key}'`))
		);
	});
	assert.ok(read.includes('removeTrackingParameters'), 'the scan finds reads');
	const shared = keysScoped(LIBRARY_SETTINGS, 'all');
	for (const key of read) {
		if (key === 'mobileApp') {
			continue;
		}

		assert.ok(
			shared.includes(key as (typeof shared)[number]),
			`The phone reads the library setting "${key}", so its scope is all, not ${LIBRARY_SETTINGS[key as keyof typeof LIBRARY_SETTINGS][0]}.`,
		);
	}

	for (const key of shared) {
		assert.ok(
			read.includes(key),
			`"${key}" is scoped to all devices but the phone never reads it: scope it platform, or add it to the app.`,
		);
	}
});

test('the appearance and backup settings have the platform scope, and the glass effect stays on the device', () => {
	const registries: Array<[string, Record<string, readonly [string, string]>]> =
		[
			['EXTENSION_STORAGE', EXTENSION_STORAGE],
			['ANDROID_PREFERENCES', ANDROID_PREFERENCES],
			['LIBRARY_SETTINGS', LIBRARY_SETTINGS],
		];
	const platform: Array<[string, string]> = [
		['EXTENSION_STORAGE', 'uiTheme'],
		['EXTENSION_STORAGE', 'uiAccent'],
		['ANDROID_PREFERENCES', 'look'],
		['ANDROID_PREFERENCES', 'theme'],
		['ANDROID_PREFERENCES', 'accent'],
		['ANDROID_PREFERENCES', 'floatingBar'],
		['ANDROID_PREFERENCES', 'barSize'],
		['ANDROID_PREFERENCES', 'barLabels'],
		['LIBRARY_SETTINGS', 'snapshotsEnabled'],
		['LIBRARY_SETTINGS', 'snapshotIntervalMinutes'],
		['LIBRARY_SETTINGS', 'snapshotKeep'],
		['LIBRARY_SETTINGS', 'autoBackup'],
		['LIBRARY_SETTINGS', 'autoBackupKeep'],
	];
	for (const [name, key] of platform) {
		const registry = registries.find(([n]) => n === name)?.[1];
		assert.equal(
			registry?.[key]?.[0],
			'platform',
			`"${key}" syncs to every device of one kind, so its scope is platform.`,
		);
	}

	assert.equal(ANDROID_PREFERENCES.glassEffect[0], 'device');
	assert.equal(LIBRARY_SETTINGS.autoBackupToDownloads[0], 'device');
});
