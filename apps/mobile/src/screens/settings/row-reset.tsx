import {useState} from 'react';
import {resetSyncedSettings} from '../../library/library-store';
import {DEFAULTS, type LinkSettings} from '../../library/links';
import {useLinkSettings} from '../../library/use-link-settings';
import {
	defaults,
	type Preferences,
	setPreferences,
	usePreferences,
} from '../../settings/preferences';
import {ActionSheet} from '../../ui/action-sheet';
import {confirm} from '../../ui/dialog';
import {
	isChanged,
	RESETS,
	resetLabel,
	type SettingValues,
} from './row-defaults';
import type {Row} from './settings-index';

const DEFAULT_VALUES: SettingValues = {prefs: defaults, synced: DEFAULTS};

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
Holding a setting opens a drawer with one action, putting it back to its default, named when the row's `choices` have
it. Spread `onLongPress` and the accessibility props on the row and render `sheet` beside it. `changed` is true while
the setting differs from its default, for the row's marker.
*/
export function useRowReset(
	row: Row,
	choices?: ReadonlyArray<{id: string; name: string}>,
) {
	const [open, setOpen] = useState(false);
	const prefs = usePreferences();
	const synced = useLinkSettings(true);
	const resettable = canReset(row);
	const label = resetLabel(row, DEFAULT_VALUES, choices);
	return {
		changed: isChanged(row, {prefs, synced}, DEFAULT_VALUES),
		onLongPress: resettable
			? () => {
					setOpen(true);
				}
			: undefined,
		// The same drawer for TalkBack and switch users, who cannot hold a row.
		accessibilityActions: resettable ? [{name: 'reset', label}] : undefined,
		onAccessibilityAction: resettable
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
						label,
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
		'These settings go back to their defaults. To reset one setting, hold it.',
		{label: 'Reset', destructive: true},
		() => {
			resetRows(rows);
		},
	);
}
