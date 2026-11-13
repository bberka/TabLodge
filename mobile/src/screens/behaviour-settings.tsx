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
import {Card, Chips, Segmented, Switch} from '../ui';

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
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const colors = useColors();
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

function Group({label, children}: {label: string; children: React.ReactNode}) {
	const colors = useColors();
	return (
		<View style={styles.group}>
			<Text style={{color: colors.muted}}>{label}</Text>
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
		<Card>
			<Heading>Bookmarks</Heading>
			<Text style={{color: colors.muted}}>
				Choose what a tap and a swipe do. Screen reader users find every action
				in the actions menu of a bookmark.
			</Text>
			<Group label="Tap a bookmark">
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
			<Group label="Swipe right">
				<Chips
					items={actions}
					selected={prefs.swipeRight}
					onSelect={(id) => {
						setPreferences({swipeRight: id as RowAction});
					}}
				/>
			</Group>
			<Group label="Swipe left">
				<Chips
					items={actions}
					selected={prefs.swipeLeft}
					onSelect={(id) => {
						setPreferences({swipeLeft: id as RowAction});
					}}
				/>
			</Group>
			<Toggle
				label="Clean links when saving"
				hint="Remove tracking parameters such as utm_source"
				value={prefs.cleanOnSave}
				onChange={(cleanOnSave) => {
					setPreferences({cleanOnSave});
				}}
			/>
		</Card>
	);
}

/**
The extension settings that follow you between devices, so changing one here changes it in the browser too.
*/
export function SyncedSettingsCard() {
	const colors = useColors();
	const settings = useLinkSettings(true);
	return (
		<Card>
			<Heading>Same as your extension</Heading>
			<Text style={{color: colors.muted}}>
				These sync with the browser extension.
			</Text>
			<Toggle
				label="Clean page titles"
				hint="Remove counters such as (3) from titles"
				value={settings.cleanTitles}
				onChange={(value) => {
					void setSyncedSetting('cleanTitles', value);
				}}
			/>
			<Toggle
				label="Remove tracking parameters"
				hint="When opening links. Saved links stay as they are"
				value={settings.removeTrackingParameters}
				onChange={(value) => {
					void setSyncedSetting('removeTrackingParameters', value);
				}}
			/>
			<Group label="Show under a title">
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
				label="Shorten addresses"
				hint="Hide https:// and www."
				value={settings.simplifyUrls}
				onChange={(value) => {
					void setSyncedSetting('simplifyUrls', value);
				}}
			/>
			<Toggle
				label="Mark links that are not secure"
				hint="An open lock next to http:// links"
				value={settings.markInsecureLinks}
				onChange={(value) => {
					void setSyncedSetting('markInsecureLinks', value);
				}}
			/>
			<Toggle
				label="Mark local links too"
				hint="Addresses on this device or home network"
				value={settings.markLocalLinks}
				onChange={(value) => {
					void setSyncedSetting('markLocalLinks', value);
				}}
			/>
			<Group label="Bookmark spacing">
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
			<Group label="Sort sessions">
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
		</Card>
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
