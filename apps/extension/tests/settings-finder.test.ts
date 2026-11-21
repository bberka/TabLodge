import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {fieldEntryId, finderSettings} from '../src/app/settings-finder';
import {SETTING_WORDS, settingsFieldGroups} from '../src/app/settings-fields';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';
import {
	buildFinderIndex,
	flattenSections,
	searchFinder,
} from '../src/shared/global-search';

const environment = {
	appName: 'TabLodge',
	firefox: false,
	sidePanel: true,
	privateWindows: true,
};
const entries = finderSettings(environment);
const index = buildFinderIndex({
	groups: [],
	folders: [],
	bookmarks: [],
	columns: [],
	tabs: [],
	commands: [],
	settings: entries,
});
const settingIds = (query: string) =>
	flattenSections(searchFinder(query, index))
		.filter((item) => item.kind === 'setting')
		.map((item) => item.id);

/**
Settings in the library that have no row of their own on the Settings page, with where they are found instead. A new
setting is a row in `settingsFieldGroups`, which the finder lists by itself; one that really has no row is added here
with its reason, and the test checks the section it names exists.
*/
const NOT_A_ROW: Partial<Record<keyof typeof DEFAULT_SETTINGS, string>> = {
	excludedOrigins: 'Excluded websites',
	// Only the Android app reads it; the extension keeps it for sync.
	mobileApp: '',
	// The sync client's own bookkeeping, not something a person sets.
	heldSettings: '',
};

test('every setting has a finder entry, or says where else it is found', () => {
	const fields = new Set(
		settingsFieldGroups(environment).flatMap((group) =>
			group.fields.map((field) => field.name),
		),
	);
	const titles = new Set(entries.map((entry) => entry.title));
	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		if (fields.has(key as never)) {
			assert.ok(
				entries.some((entry) => entry.id === fieldEntryId(key)),
				`${key} has a field but no finder entry`,
			);
		} else if (Object.hasOwn(NOT_A_ROW, key)) {
			const section = NOT_A_ROW[key as keyof typeof NOT_A_ROW]!;
			assert.ok(
				section === '' || titles.has(section),
				`${key}: no Settings section named ${section}`,
			);
		} else {
			assert.fail(
				`${key} has no row in settingsFieldGroups (src/app/settings-fields.ts) and is not in NOT_A_ROW`,
			);
		}
	}
});

test('each field is found by its own name', () => {
	for (const group of settingsFieldGroups(environment)) {
		for (const field of group.fields) {
			assert.ok(
				settingIds(field.label).includes(`setting:${fieldEntryId(field.name)}`),
				`"${field.label}" does not find ${field.name}`,
			);
		}
	}
});

test('words are given only for fields that exist', () => {
	const fields = new Set(
		settingsFieldGroups(environment).flatMap((group) =>
			group.fields.map((field) => field.name),
		),
	);
	for (const name of Object.keys(SETTING_WORDS)) {
		assert.ok(fields.has(name as never), `${name} is not a settings field`);
	}
});

test('obvious synonyms find the field, whichever section it sits in', () => {
	const found = (query: string, name: string) =>
		assert.ok(
			settingIds(query).includes(`setting:${fieldEntryId(name)}`),
			`"${query}" does not find ${name}`,
		);
	found('tracking parameters', 'removeTrackingParameters');
	found('quotes', 'contextMenuSelectionEnabled');
	found('site icons', 'siteIcons');
	found('link previews', 'linkPreviews');
	found('header buttons', 'showTrashBinButton');
	found('sort', 'sessionSort');
	found('archive', 'autoArchiveDays');
	found('paste', 'pasteLinkToBookmark');
	found('browser star', 'browserBookmarkAction');
	found('unloading', 'unloadRestoredTabs');
	found('split', 'saveSplitTabs');
	found('session name', 'sessionNameStyle');
});

test('rows that cannot exist in Firefox are left out of its finder', () => {
	const firefox = new Set(
		finderSettings({...environment, firefox: true}).map((entry) => entry.id),
	);
	for (const name of [
		'newTabEnabled',
		'newTabFallback',
		'newTabFallbackUrl',
		'restoreSplitTabs',
	]) {
		assert.ok(!firefox.has(fieldEntryId(name)), name);
		assert.ok(
			entries.some((entry) => entry.id === fieldEntryId(name)),
			`${name} is missing from the Chromium finder`,
		);
	}
});
