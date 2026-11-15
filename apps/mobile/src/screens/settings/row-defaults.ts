/*
What each setting goes back to, and whether it is there now. The reset drawer names the default, and a row shows a
marker while its value differs from it. The values are passed in, so this file needs no storage.
*/
import type {LinkSettings} from '../../library/links';
import type {Preferences} from '../../settings/preferences';
import {ROWS, type Row} from './settings-index';

/**
What puts a setting back to its default: the keys of this phone's own preferences, and of the extension settings that
travel with the library. `on` says whether a stored value reads as a switch being on, for a switch that is stored as
something else.
*/
export type Reset = {
	prefs?: Array<keyof Preferences>;
	synced?: Array<keyof LinkSettings>;
	on?: (value: unknown) => boolean;
};

export const RESETS = new Map<Row, Reset>([
	[ROWS.style, {prefs: ['look']}],
	[ROWS.floatingBar, {prefs: ['floatingBar']}],
	[ROWS.barSize, {prefs: ['barSize']}],
	[ROWS.barLabels, {prefs: ['barLabels']}],
	[ROWS.glassEffect, {prefs: ['glassEffect']}],
	[ROWS.theme, {prefs: ['theme']}],
	[ROWS.accent, {prefs: ['accent']}],
	[ROWS.compactSessions, {prefs: ['compactSessions']}],
	[ROWS.sessionIcons, {synced: ['showSessionFaviconPreviews']}],
	[ROWS.showSavedOn, {prefs: ['showSavedOn']}],
	[ROWS.expandSessions, {synced: ['expandSessionsByDefault']}],
	[ROWS.sortSessions, {synced: ['sessionSort']}],
	[ROWS.sessionTap, {prefs: ['sessionTap']}],
	[ROWS.sessionMain, {prefs: ['sessionMain']}],
	[ROWS.sessionSwipeRight, {prefs: ['sessionSwipeRight']}],
	[ROWS.sessionSwipeLeft, {prefs: ['sessionSwipeLeft']}],
	[ROWS.linkSwipeRight, {prefs: ['linkSwipeRight']}],
	[ROWS.linkSwipeLeft, {prefs: ['linkSwipeLeft']}],
	[ROWS.tap, {prefs: ['tapAction']}],
	[ROWS.swipeRight, {prefs: ['swipeRight']}],
	[ROWS.swipeLeft, {prefs: ['swipeLeft']}],
	[ROWS.cleanOnSave, {prefs: ['cleanOnSave']}],
	[ROWS.siteIcons, {prefs: ['siteIcons']}],
	[ROWS.savePreview, {prefs: ['savePreview']}],
	[ROWS.cleanTitles, {synced: ['cleanTitles']}],
	[ROWS.removeTracking, {synced: ['removeTrackingParameters']}],
	[ROWS.showUnder, {synced: ['urlDisplayMode']}],
	[ROWS.shortenAddresses, {synced: ['simplifyUrls']}],
	[ROWS.markInsecure, {synced: ['markInsecureLinks']}],
	[ROWS.markLocal, {synced: ['markLocalLinks']}],
	[ROWS.spacing, {synced: ['bookmarkDensity'], on: isCompact}],
	[ROWS.showAll, {synced: ['showAllBookmarks']}],
	[ROWS.openWith, {prefs: ['openWith']}],
	[ROWS.openApp, {prefs: ['openApp']}],
	[ROWS.privateOpenWith, {prefs: ['privateOpenWith']}],
	[ROWS.privateOpenApp, {prefs: ['privateOpenApp']}],
	[ROWS.privateLockMode, {prefs: ['privateLockMode']}],
	[ROWS.privateLockMinutes, {prefs: ['privateLockMinutes']}],
	[ROWS.showPrivateButton, {prefs: ['showPrivateButton']}],
]);

/**
The Spacing switch is on for compact spacing, which is how the library stores it.
*/
export function isCompact(value: unknown): boolean {
	return value === 'compact';
}

/**
The two sets of values a setting can live in: this phone's preferences and the library's extension settings.
*/
export type SettingValues = {prefs: Preferences; synced: LinkSettings};

function valuesOf(reset: Reset, values: SettingValues): unknown[] {
	return [
		...(reset.prefs ?? []).map((key) => values.prefs[key]),
		...(reset.synced ?? []).map((key) => values.synced[key]),
	];
}

/**
Whether a setting's current value differs from its default. A setting that cannot be reset is never changed.
*/
export function isChanged(
	row: Row,
	current: SettingValues,
	defaults: SettingValues,
): boolean {
	const reset = RESETS.get(row);
	if (!reset) {
		return false;
	}

	const now = valuesOf(reset, current);
	const wanted = valuesOf(reset, defaults);
	return now.some((value, index) => value !== wanted[index]);
}

/**
What the drawer's action says: the default by name when the row's choices have it, "On" or "Off" for a switch, and
otherwise just "default". The name comes from the same choices the row lets you pick from, so it cannot drift from
what the row shows.
*/
export function resetLabel(
	row: Row,
	defaults: SettingValues,
	choices?: ReadonlyArray<{id: string; name: string}>,
): string {
	const reset = RESETS.get(row);
	const [value] = reset ? valuesOf(reset, defaults) : [];
	const isSwitch = reset?.on !== undefined || typeof value === 'boolean';
	const name = isSwitch
		? (reset?.on?.(value) ?? value)
			? 'On'
			: 'Off'
		: choices?.find((choice) => choice.id === String(value))?.name;
	return name ? `Reset to ${name}` : 'Reset to default';
}
