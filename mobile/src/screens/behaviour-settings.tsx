import {StyleSheet, Text, View} from 'react-native';
import {setSyncedSetting} from '../library-store';
import {
	ROW_ACTIONS,
	type RowAction,
	setPreferences,
	usePreferences,
} from '../preferences';
import {rowActionLook} from '../row-actions';
import {useColors} from '../theme';
import {useLinkSettings} from '../use-link-settings';
import {Chips, Segmented, Switch} from '../ui';
import {SettingsCard, useRowVisible} from './settings-card';
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
		<View style={styles.switchRow}>
			<View style={styles.switchText}>
				<Text style={{color: colors.text, fontSize: 16}}>{label}</Text>
				{hint && <Text style={{color: colors.muted}}>{hint}</Text>}
			</View>
			<Switch label={label} value={value} onValueChange={onChange} />
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
	const colors = useColors();
	const prefs = usePreferences();
	const actions = useActionChoices();
	return (
		<SettingsCard section={SECTIONS.bookmarks}>
			<Heading>Bookmarks</Heading>
			<Text style={{color: colors.muted}}>
				Choose what a tap and a swipe do. Screen reader users find every action
				in the actions menu of a bookmark.
			</Text>
			<Group row={ROWS.tap}>
				<Segmented
					label="Tap a bookmark"
					items={[
						{id: 'open', name: 'Open it', icon: 'open-outline'},
						{id: 'edit', name: 'Edit it', icon: 'create-outline'},
					]}
					selected={prefs.tapAction}
					onSelect={(tapAction) => {
						setPreferences({tapAction});
					}}
				/>
			</Group>
			<Group row={ROWS.swipeRight}>
				<Chips
					items={actions}
					selected={prefs.swipeRight}
					onSelect={(id) => {
						setPreferences({swipeRight: id as RowAction});
					}}
				/>
			</Group>
			<Group row={ROWS.swipeLeft}>
				<Chips
					items={actions}
					selected={prefs.swipeLeft}
					onSelect={(id) => {
						setPreferences({swipeLeft: id as RowAction});
					}}
				/>
			</Group>
			<Toggle
				row={ROWS.cleanOnSave}
				value={prefs.cleanOnSave}
				onChange={(cleanOnSave) => {
					setPreferences({cleanOnSave});
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
	const colors = useColors();
	const prefs = usePreferences();
	const settings = useLinkSettings(true);
	return (
		<SettingsCard section={SECTIONS.sessions}>
			<Heading>Sessions</Heading>
			<Text style={{color: colors.muted}}>
				Fewer details make the list shorter. Links under a tab's title follow
				Show under a title, below.
			</Text>
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
	const colors = useColors();
	const settings = useLinkSettings(true);
	return (
		<SettingsCard section={SECTIONS.extension}>
			<Heading>Same as your extension</Heading>
			<Text style={{color: colors.muted}}>
				These sync with the browser extension.
			</Text>
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
			<Group row={ROWS.showUnder}>
				<Segmented
					label="Show under a title"
					items={[
						{id: 'full', name: 'Address', icon: 'link-outline'},
						{id: 'domain', name: 'Site', icon: 'globe-outline'},
						{id: 'url-only', name: 'Only', icon: 'text-outline'},
						{id: 'none', name: 'None', icon: 'eye-off-outline'},
					]}
					selected={settings.urlDisplayMode}
					onSelect={(value) => {
						void setSyncedSetting('urlDisplayMode', value);
					}}
				/>
			</Group>
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
			<Group row={ROWS.spacing}>
				<Segmented
					label="Bookmark spacing"
					items={[
						{
							id: 'comfortable',
							name: 'Comfortable',
							icon: 'reorder-two-outline',
						},
						{id: 'compact', name: 'Compact', icon: 'reorder-four-outline'},
					]}
					selected={settings.bookmarkDensity}
					onSelect={(value) => {
						void setSyncedSetting('bookmarkDensity', value);
					}}
				/>
			</Group>
			<Group row={ROWS.sortSessions}>
				<Chips
					items={[
						{id: 'newest', name: 'Newest', glyph: 'arrow-down-outline'},
						{id: 'oldest', name: 'Oldest', glyph: 'arrow-up-outline'},
						{id: 'opened', name: 'Last opened', glyph: 'time-outline'},
						{id: 'name', name: 'Name', glyph: 'text-outline'},
						{id: 'tabs', name: 'Most tabs', glyph: 'albums-outline'},
						{id: 'custom', name: 'Your order', glyph: 'reorder-three-outline'},
					]}
					selected={settings.sessionSort}
					onSelect={(value) => {
						void setSyncedSetting(
							'sessionSort',
							value as typeof settings.sessionSort,
						);
					}}
				/>
			</Group>
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
