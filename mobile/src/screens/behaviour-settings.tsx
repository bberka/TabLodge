import {StyleSheet, Text, View} from 'react-native';
import {setSyncedSetting} from '../library-store';
import {
	ROW_ACTIONS,
	SESSION_ACTIONS,
	setPreferences,
	usePreferences,
} from '../preferences';
import {rowActionLook, sessionActionLook} from '../row-actions';
import {useColors} from '../theme';
import {useLinkSettings} from '../use-link-settings';
import {Switch} from '../ui';
import {SettingsCard, useRowVisible} from './settings-card';
import {SelectRow} from './select-row';
import {type Row, ROWS, SECTIONS} from './settings-index';

/**
The swipe choices, each with the icon and color it has when it appears under a row.
*/
function useActionChoices() {
	const colors = useColors();
	return ROW_ACTIONS.map((id) => {
		const look = rowActionLook(id, colors);
		return {id, name: look.label, glyph: look.icon, tint: look.color};
	});
}

function useSessionActionChoices() {
	const colors = useColors();
	return SESSION_ACTIONS.map((id) => {
		const look = sessionActionLook(id, colors);
		return {id, name: look.label, glyph: look.icon, tint: look.color};
	});
}

function Heading({children}: {children: string}) {
	const colors = useColors();
	return (
		<Text
			accessibilityRole="header"
			style={[styles.heading, {color: colors.text}]}
		>
			{children}
		</Text>
	);
}

export function Toggle({
	row: {label, hint},
	value,
	onChange,
}: {
	row: Row;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const colors = useColors();
	const visible = useRowVisible({label, hint});
	if (!visible) {
		return null;
	}

	return (
		<View accessible={false} style={styles.switchRow}>
			<View style={styles.switchText}>
				<Text style={{color: colors.text, fontSize: 16}}>{label}</Text>
				{hint && <Text style={{color: colors.muted}}>{hint}</Text>}
			</View>
			<Switch
				label={label}
				hint={hint}
				value={value}
				onValueChange={onChange}
			/>
		</View>
	);
}

export function Group({row, children}: {row: Row; children: React.ReactNode}) {
	const colors = useColors();
	const visible = useRowVisible(row);
	if (!visible) {
		return null;
	}

	return (
		<View style={styles.group}>
			<Text style={{color: colors.muted}}>{row.label}</Text>
			{children}
		</View>
	);
}

/**
What tapping and swiping a bookmark do, and how links are cleaned when saved. These stay on this phone.
*/
export function BookmarkBehaviourCard() {
	const prefs = usePreferences();
	const settings = useLinkSettings(true);
	const actions = useActionChoices();
	return (
		<SettingsCard section={SECTIONS.bookmarks}>
			<Heading>Bookmarks</Heading>
			<SelectRow
				row={ROWS.tap}
				value={prefs.tapAction}
				choices={[
					{id: 'open', name: 'Open it', icon: 'open-outline'},
					{id: 'edit', name: 'Edit it', icon: 'create-outline'},
				]}
				onChange={(tapAction) => {
					setPreferences({tapAction});
				}}
			/>
			<SelectRow
				row={ROWS.swipeRight}
				value={prefs.swipeRight}
				choices={actions}
				onChange={(swipeRight) => {
					setPreferences({swipeRight});
				}}
			/>
			<SelectRow
				row={ROWS.swipeLeft}
				value={prefs.swipeLeft}
				choices={actions}
				onChange={(swipeLeft) => {
					setPreferences({swipeLeft});
				}}
			/>
			<SelectRow
				row={ROWS.showUnder}
				value={settings.urlDisplayMode}
				choices={[
					{id: 'full', name: 'Full address', icon: 'link-outline'},
					{id: 'domain', name: 'Site name', icon: 'globe-outline'},
					{
						id: 'url-only',
						name: 'Address instead of title',
						icon: 'text-outline',
					},
					{id: 'none', name: 'Nothing', icon: 'eye-off-outline'},
				]}
				onChange={(value) => {
					void setSyncedSetting('urlDisplayMode', value);
				}}
			/>
			<Toggle
				row={ROWS.spacing}
				value={settings.bookmarkDensity === 'compact'}
				onChange={(value) => {
					void setSyncedSetting(
						'bookmarkDensity',
						value ? 'compact' : 'comfortable',
					);
				}}
			/>
			<Toggle
				row={ROWS.siteIcons}
				value={prefs.siteIcons}
				onChange={(siteIcons) => {
					setPreferences({siteIcons});
				}}
			/>
		</SettingsCard>
	);
}

/**
How session cards look. The tab icons and expanded-by-default switches are the extension's own settings, so they
change there too; the other two are this app's and sync with its look.
*/
export function SessionSettingsCard() {
	const prefs = usePreferences();
	const settings = useLinkSettings(true);
	const sessionActions = useSessionActionChoices();
	return (
		<SettingsCard section={SECTIONS.sessions}>
			<Heading>Sessions</Heading>
			<SelectRow
				row={ROWS.sortSessions}
				value={settings.sessionSort}
				choices={[
					{id: 'newest', name: 'Newest first', icon: 'arrow-down-outline'},
					{id: 'oldest', name: 'Oldest first', icon: 'arrow-up-outline'},
					{id: 'opened', name: 'Last opened', icon: 'time-outline'},
					{id: 'name', name: 'Name', icon: 'text-outline'},
					{id: 'tabs', name: 'Most tabs', icon: 'albums-outline'},
					{id: 'custom', name: 'Your order', icon: 'reorder-three-outline'},
				]}
				onChange={(value) => {
					void setSyncedSetting('sessionSort', value);
				}}
			/>
			<SelectRow
				row={ROWS.sessionTap}
				value={prefs.sessionTap}
				choices={[
					{id: 'expand', name: 'Show its tabs', icon: 'chevron-down'},
					{id: 'open', name: 'Open all tabs', icon: 'albums-outline'},
				]}
				onChange={(sessionTap) => {
					setPreferences({sessionTap});
				}}
			/>
			<SelectRow
				row={ROWS.sessionSwipeRight}
				value={prefs.sessionSwipeRight}
				choices={sessionActions}
				onChange={(sessionSwipeRight) => {
					setPreferences({sessionSwipeRight});
				}}
			/>
			<SelectRow
				row={ROWS.sessionSwipeLeft}
				value={prefs.sessionSwipeLeft}
				choices={sessionActions}
				onChange={(sessionSwipeLeft) => {
					setPreferences({sessionSwipeLeft});
				}}
			/>
			<Toggle
				row={ROWS.compactSessions}
				value={prefs.compactSessions}
				onChange={(compactSessions) => {
					setPreferences({compactSessions});
				}}
			/>
			<Toggle
				row={ROWS.sessionIcons}
				value={settings.showSessionFaviconPreviews}
				onChange={(value) => {
					void setSyncedSetting('showSessionFaviconPreviews', value);
				}}
			/>
			<Toggle
				row={ROWS.showSavedOn}
				value={prefs.showSavedOn}
				onChange={(showSavedOn) => {
					setPreferences({showSavedOn});
				}}
			/>
			<Toggle
				row={ROWS.expandSessions}
				value={settings.expandSessionsByDefault}
				onChange={(value) => {
					void setSyncedSetting('expandSessionsByDefault', value);
				}}
			/>
		</SettingsCard>
	);
}

/**
The extension settings that follow you between devices, so changing one here changes it in the browser too.
*/
export function SyncedSettingsCard() {
	const settings = useLinkSettings(true);
	return (
		<SettingsCard section={SECTIONS.extension}>
			<Heading>Links and titles</Heading>
			<Toggle
				row={ROWS.cleanTitles}
				value={settings.cleanTitles}
				onChange={(value) => {
					void setSyncedSetting('cleanTitles', value);
				}}
			/>
			<Toggle
				row={ROWS.removeTracking}
				value={settings.removeTrackingParameters}
				onChange={(value) => {
					void setSyncedSetting('removeTrackingParameters', value);
				}}
			/>
			<Toggle
				row={ROWS.shortenAddresses}
				value={settings.simplifyUrls}
				onChange={(value) => {
					void setSyncedSetting('simplifyUrls', value);
				}}
			/>
			<Toggle
				row={ROWS.markInsecure}
				value={settings.markInsecureLinks}
				onChange={(value) => {
					void setSyncedSetting('markInsecureLinks', value);
				}}
			/>
			<Toggle
				row={ROWS.markLocal}
				value={settings.markLocalLinks}
				onChange={(value) => {
					void setSyncedSetting('markLocalLinks', value);
				}}
			/>
			<Toggle
				row={ROWS.cleanOnSave}
				value={usePreferences().cleanOnSave}
				onChange={(cleanOnSave) => {
					setPreferences({cleanOnSave});
				}}
			/>
		</SettingsCard>
	);
}

const styles = StyleSheet.create({
	heading: {fontSize: 18, fontWeight: '700'},
	group: {gap: 8},
	switchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
	},
	switchText: {flex: 1},
});
