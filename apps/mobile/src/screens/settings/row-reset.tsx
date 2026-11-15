import {useState} from 'react';
import {resetSyncedSettings} from '../../library/library-store';
import type {LinkSettings} from '../../library/links';
import {
	defaults,
	type Preferences,
	setPreferences,
} from '../../settings/preferences';
import {ActionSheet} from '../../ui/action-sheet';
import {confirm} from '../../ui/dialog';
import {ROWS, type Row} from './settings-index';

/**
What puts a setting back to its default: the keys of this phone's own preferences, and of the extension settings that
travel with the library.
*/
export type Reset = {
	prefs?: Array<keyof Preferences>;
	synced?: Array<keyof LinkSettings>;
};

const RESETS = new Map<Row, Reset>([
	[ROWS.style, {prefs: ['look']}],
	[ROWS.floatingBar, {prefs: ['floatingBar']}],
	[ROWS.barSize, {prefs: ['barSize']}],
	[ROWS.barLabels, {prefs: ['barLabels']}],
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
	[ROWS.spacing, {synced: ['bookmarkDensity']}],
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
Whether a setting can be put back to its default from the list.
*/
export const canReset = (row: Row): boolean => RESETS.has(row);

/**
Puts these settings back to their defaults. Extension settings go through the library, so they sync.
*/
export function resetRows(rows: readonly Row[]): void {
	const prefs = new Set<keyof Preferences>();
	const synced = new Set<keyof LinkSettings>();
	for (const row of rows) {
		for (const key of RESETS.get(row)?.prefs ?? []) {
			prefs.add(key);
		}

		for (const key of RESETS.get(row)?.synced ?? []) {
			synced.add(key);
		}
	}

	if (prefs.size > 0) {
		setPreferences(
			Object.fromEntries([...prefs].map((key) => [key, defaults[key]])),
		);
	}

	if (synced.size > 0) {
		void resetSyncedSettings([...synced]);
	}
}

/**
Holding a setting opens a drawer with one action, putting it back to its default. Spread `onLongPress` on the row and
render `sheet` beside it.
*/
export function useRowReset(row: Row) {
	const [open, setOpen] = useState(false);
	const resettable = canReset(row);
	return {
		onLongPress: resettable
			? () => {
					setOpen(true);
				}
			: undefined,
		sheet: resettable ? (
			<ActionSheet
				visible={open}
				title={row.label}
				actions={[
					{
						icon: 'refresh-outline',
						label: 'Reset to default',
						onPress() {
							resetRows([row]);
						},
					},
				]}
				onClose={() => {
					setOpen(false);
				}}
			/>
		) : undefined,
	};
}

/**
Asks before putting every setting of a section back to its default.
*/
export function confirmResetSection(title: string, rows: readonly Row[]): void {
	confirm(
		`Reset ${title}?`,
		'These settings go back to their defaults.',
		{label: 'Reset', destructive: true},
		() => {
			resetRows(rows);
		},
	);
}
