import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {
	CHROMIUM_ONLY_PERMISSIONS,
	FIREFOX_MIN_VERSION,
	GECKO_ID,
	manifestForTarget,
} from '../scripts/manifest-targets';

type Manifest = {
	background: {service_worker: string};
	side_panel: {default_path: string};
	permissions: string[];
	optional_permissions: string[];
} & Record<string, unknown>;
type FirefoxManifest = {
	background: unknown;
	sidebar_action: {default_panel: string};
	incognito: string;
	permissions: string[];
	optional_permissions: string[];
	browser_specific_settings: {gecko: unknown};
} & Record<string, unknown>;

const source = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '..', 'extension', 'manifest.json'),
		'utf8',
	),
) as Manifest;
const firefoxManifest = () =>
	manifestForTarget(source, 'firefox') as FirefoxManifest;

test('the Chromium manifest is the source manifest, unchanged', () => {
	assert.deepEqual(manifestForTarget(source, 'chrome'), source);
});

test('the Firefox manifest runs the worker as an event page and registers the side panel as the sidebar', () => {
	const manifest = firefoxManifest();
	assert.deepEqual(manifest.background, {
		scripts: [source.background.service_worker],
	});
	assert.equal(
		manifest.sidebar_action.default_panel,
		source.side_panel.default_path,
	);
	assert.equal(manifest.side_panel, undefined);
	assert.equal(manifest.minimum_chrome_version, undefined);
	// Firefox has no "split" private-window mode, so the add-on stays out of private windows.
	assert.equal(manifest.incognito, 'not_allowed');
	assert.deepEqual(manifest.browser_specific_settings.gecko, {
		id: GECKO_ID,
		strict_min_version: FIREFOX_MIN_VERSION,
		data_collection_permissions: {required: ['none']},
	});
});

test('the Firefox manifest drops only the permissions Firefox does not know', () => {
	const manifest = firefoxManifest();
	const dropped = source.permissions.filter(
		(entry) => !manifest.permissions.includes(entry),
	);
	assert.deepEqual(dropped.toSorted(), CHROMIUM_ONLY_PERMISSIONS.toSorted());
	assert.deepEqual(manifest.optional_permissions, source.optional_permissions);
});

test('the Firefox manifest keeps the pages, commands and new-tab override of the source', () => {
	const manifest = firefoxManifest();
	for (const key of [
		'action',
		'commands',
		'chrome_url_overrides',
		'options_page',
		'icons',
		'version',
	]) {
		assert.deepEqual(manifest[key], source[key], key);
	}
});
