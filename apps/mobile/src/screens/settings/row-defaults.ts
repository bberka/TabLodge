import type {LinkSettings} from '../../library/links';
import type {Preferences} from '../../settings/preferences';
import {ROWS, type Row} from './settings-index';

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
	[ROWS.messagePosition, {prefs: ['messagePosition']}],
	[ROWS.startupTab, {prefs: ['startupTab']}],
	[ROWS.toastDuration, {synced: ['toastDuration']}],
	[ROWS.compactSessions, {prefs: ['compactSessions']}],
	[ROWS.sessionIcons, {synced: ['showSessionFaviconPreviews']}],
	[ROWS.showSavedOn, {prefs: ['showSavedOn']}],
	[ROWS.expandSessions, {synced: ['expandSessionsByDefault']}],
	[ROWS.sortSessions, {synced: ['sessionSort']}],
	[ROWS.sessionName, {synced: ['sessionNameStyle']}],
	[ROWS.sessionNameTemplate, {synced: ['sessionNameTemplate']}],
	[ROWS.sessionNameFallback, {synced: ['sessionNameFallback']}],
	[ROWS.archiveSessions, {synced: ['autoArchiveDays']}],
	[ROWS.trashRetention, {synced: ['trashRetentionDays']}],
	[ROWS.sessionView, {prefs: ['sessionView']}],
	[ROWS.bookmarkView, {prefs: ['bookmarkView']}],
	[ROWS.sessionTap, {prefs: ['sessionTap']}],
	[ROWS.sessionMain, {prefs: ['sessionMain']}],
	[ROWS.sessionSwipeRight, {prefs: ['sessionSwipeRight']}],
	[ROWS.sessionSwipeLeft, {prefs: ['sessionSwipeLeft']}],
	[ROWS.linkSwipeRight, {prefs: ['linkSwipeRight']}],
	[ROWS.linkSwipeLeft, {prefs: ['linkSwipeLeft']}],
	[ROWS.tap, {prefs: ['tapAction']}],
	[ROWS.swipeRight, {prefs: ['swipeRight']}],
	[ROWS.swipeLeft, {prefs: ['swipeLeft']}],
	[ROWS.siteIcons, {synced: ['siteIcons']}],
	[ROWS.savePreview, {prefs: ['savePreview']}],
	[ROWS.afterShare, {prefs: ['afterShare']}],
	[ROWS.cleanTitles, {synced: ['cleanTitles']}],
	[ROWS.removeTracking, {synced: ['removeTrackingParameters']}],
	[ROWS.showUnder, {synced: ['urlDisplayMode']}],
	[ROWS.shortenAddresses, {synced: ['simplifyUrls']}],
	[ROWS.markInsecure, {synced: ['markInsecureLinks']}],
	[ROWS.markLocal, {synced: ['markLocalLinks']}],
	[ROWS.spacing, {synced: ['bookmarkDensity'], on: isCompact}],
	[ROWS.showAll, {synced: ['showAllBookmarks']}],
	[ROWS.sortBookmarks, {synced: ['bookmarkSort']}],
	[ROWS.newBookmarkPosition, {synced: ['newBookmarkPosition']}],
	[ROWS.openWith, {prefs: ['openWith']}],
	[ROWS.openApp, {prefs: ['openApp']}],
	[ROWS.privateOpenWith, {prefs: ['privateOpenWith']}],
	[ROWS.privateOpenApp, {prefs: ['privateOpenApp']}],
	[ROWS.privateLockMode, {prefs: ['privateLockMode']}],
	[ROWS.privateLockMinutes, {prefs: ['privateLockMinutes']}],
	[ROWS.showPrivateButton, {prefs: ['showPrivateButton']}],
]);

export function isCompact(value: unknown): boolean {
	return value === 'compact';
}

export type SettingValues = {prefs: Preferences; synced: LinkSettings};

function valuesOf(reset: Reset, values: SettingValues): unknown[] {
	return [
		...(reset.prefs ?? []).map((key) => values.prefs[key]),
		...(reset.synced ?? []).map((key) => values.synced[key]),
	];
}

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
