import {use, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {SESSION_NAME_TEMPLATE_MAX} from '../../../../extension/src/shared/library-normalize';
import {setSyncedSetting} from '../../library/library-store';
import {
	LINK_ACTIONS,
	type ListView,
	ROW_ACTIONS,
	SESSION_ACTIONS,
	setPreferences,
	usePreferences,
} from '../../settings/preferences';
import {
	linkActionLook,
	rowActionLook,
	sessionActionLook,
} from '../../library/row-actions';
import {useColors} from '../../ui/theme';
import {useLinkSettings} from '../../library/use-link-settings';
import {Field, type IconName, Switch} from '../../ui/widgets';
import {useRowReset} from './row-reset';
import {SettingsCard, SettingsQuery, useRowVisible} from './settings-card';
import {RowLabel, SelectRow} from './select-row';
import {type Row, ROWS, SECTIONS} from './settings-index';

const VIEW_CHOICES: Array<{id: ListView; name: string; icon: IconName}> = [
	{id: 'chips', name: 'Chips', icon: 'swap-horizontal-outline'},
	{id: 'list', name: 'List', icon: 'list-outline'},
];

/**
The swipe choices, each with the icon and color it has when it appears under a row.
*/
function useActionChoices() {
	const colors = useColors();
	return ROW_ACTIONS.map((id) => {
		const look = rowActionLook(id, colors);
		return {
			id,
			name: look.label,
			icon: look.icon,
			color: look.color,
		};
	});
}

function useSessionActionChoices() {
	const colors = useColors();
	return SESSION_ACTIONS.map((id) => {
		const look = sessionActionLook(id, colors);
		return {
			id,
			name: look.label,
			icon: look.icon,
			color: look.color,
		};
	});
}

function useLinkActionChoices() {
	const colors = useColors();
	return LINK_ACTIONS.map((id) => {
		const look = linkActionLook(id, colors);
		return {id, name: look.label, icon: look.icon, color: look.color};
	});
}

export function Toggle({
	row,
	value,
	onChange,
}: {
	row: Row;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const {label, hint} = row;
	const isVisible = useRowVisible(row);
	const reset = useRowReset(row);
	if (!isVisible) {
		return null;
	}

	return (
		<View accessible={false} style={styles.switchRow}>
			<Pressable
				accessible={false}
				style={styles.switchText}
				onLongPress={reset.onLongPress}
			>
				<RowLabel label={label} changed={reset.changed} hint={hint} />
			</Pressable>
			{reset.sheet}
			<Switch
				label={label}
				hint={hint}
				value={value}
				accessibilityActions={reset.accessibilityActions}
				onAccessibilityAction={reset.onAccessibilityAction}
				onValueChange={onChange}
			/>
		</View>
	);
}

export function Group({row, children}: {row: Row; children: React.ReactNode}) {
	const colors = useColors();
	const isVisible = useRowVisible(row);
	if (!isVisible) {
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
What tapping and swiping a bookmark do, and how links are cleaned when saved.
*/
export function BookmarkBehaviourCard() {
	const prefs = usePreferences();
	const settings = useLinkSettings(true);
	const actions = useActionChoices();
	return (
		<SettingsCard
			section={SECTIONS.bookmarks}
			icon="bookmark-outline"
			description="How taps, swipes, and the list behave."
		>
			<SelectRow
				row={ROWS.bookmarkView}
				value={prefs.bookmarkView}
				choices={VIEW_CHOICES}
				onChange={(bookmarkView) => {
					setPreferences({bookmarkView});
				}}
			/>
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
				row={ROWS.showAll}
				value={settings.showAllBookmarks}
				onChange={(value) => {
					void setSyncedSetting('showAllBookmarks', value);
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
			<SelectRow
				row={ROWS.siteIcons}
				value={prefs.siteIcons}
				choices={[
					{
						id: 'server',
						name: 'Through my server',
						hint: 'Your server fetches them, so sites never see this phone',
						icon: 'cloud-outline',
					},
					{
						id: 'direct',
						name: 'From the sites too',
						hint: 'Without a server, this phone asks each site',
						icon: 'globe-outline',
					},
					{
						id: 'off',
						name: 'Off',
						hint: 'Letter tiles',
						icon: 'text-outline',
					},
				]}
				onChange={(siteIcons) => {
					setPreferences({siteIcons});
				}}
			/>
			<Toggle
				row={ROWS.savePreview}
				value={prefs.savePreview}
				onChange={(savePreview) => {
					setPreferences({savePreview});
				}}
			/>
		</SettingsCard>
	);
}

const NAME_CHOICES: Array<{
	id: 'title' | 'datetime' | 'date-title' | 'custom';
	name: string;
}> = [
	{id: 'title', name: 'First link title'},
	{id: 'datetime', name: 'Date and time'},
	{id: 'date-title', name: 'Date and first link'},
	{id: 'custom', name: 'Custom'},
];

const ARCHIVE_CHOICES = [
	{id: '0', name: 'Never'},
	{id: '7', name: '1 week'},
	{id: '30', name: '30 days'},
	{id: '90', name: '90 days'},
	{id: '365', name: '1 year'},
];

/**
The archive choices, with the browser's own number of days when it set one the list lacks.
*/
const archiveChoices = (days: number) =>
	ARCHIVE_CHOICES.some((choice) => choice.id === String(days))
		? ARCHIVE_CHOICES
		: [...ARCHIVE_CHOICES, {id: String(days), name: `${days} days`}];

/**
The custom session name, saved when the field loses focus so sync does not send every keystroke.
*/
function NameTemplateField({template}: {template: string}) {
	const [draft, setDraft] = useState(template);
	const visible = useRowVisible(ROWS.sessionNameTemplate);
	if (!visible) {
		return null;
	}

	const commit = () => {
		const next = draft.trim().slice(0, SESSION_NAME_TEMPLATE_MAX);
		setDraft(next);
		if (next !== '' && next !== template) {
			void setSyncedSetting('sessionNameTemplate', next);
		}
	};

	return (
		<Field
			label={ROWS.sessionNameTemplate.label}
			icon="text-outline"
			value={draft}
			placeholder="{date} · {title}"
			maxLength={SESSION_NAME_TEMPLATE_MAX}
			returnKeyType="done"
			onChangeText={setDraft}
			onBlur={commit}
			onSubmitEditing={commit}
		/>
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
	const linkChoices = useLinkActionChoices();
	// A search shows the name rows even when the style hides them, so "template" still finds its field.
	const searching = use(SettingsQuery) !== '';
	return (
		<SettingsCard
			section={SECTIONS.sessions}
			icon="albums-outline"
			description="How saved sessions look and act."
		>
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
				row={ROWS.sessionName}
				value={settings.sessionNameStyle}
				choices={[...NAME_CHOICES, {id: 'ask', name: 'Ask each time'}]}
				onChange={(value) => {
					void setSyncedSetting('sessionNameStyle', value);
				}}
			/>
			{(searching || settings.sessionNameStyle === 'ask') && (
				<SelectRow
					row={ROWS.sessionNameFallback}
					value={settings.sessionNameFallback}
					choices={NAME_CHOICES}
					onChange={(value) => {
						void setSyncedSetting('sessionNameFallback', value);
					}}
				/>
			)}
			{(searching ||
				settings.sessionNameStyle === 'custom' ||
				(settings.sessionNameStyle === 'ask' &&
					settings.sessionNameFallback === 'custom')) && (
				<NameTemplateField
					key={settings.sessionNameTemplate}
					template={settings.sessionNameTemplate}
				/>
			)}
			<SelectRow
				row={ROWS.archiveSessions}
				value={String(settings.autoArchiveDays)}
				choices={archiveChoices(settings.autoArchiveDays)}
				onChange={(value) => {
					void setSyncedSetting('autoArchiveDays', Number(value));
				}}
			/>
			<SelectRow
				row={ROWS.sessionMain}
				value={prefs.sessionMain}
				choices={sessionActions.filter((choice) => choice.id !== 'none')}
				onChange={(sessionMain) => {
					setPreferences({sessionMain});
				}}
			/>
			<SelectRow
				row={ROWS.sessionView}
				value={prefs.sessionView}
				choices={VIEW_CHOICES}
				onChange={(sessionView) => {
					setPreferences({sessionView});
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
			<SelectRow
				row={ROWS.linkSwipeRight}
				value={prefs.linkSwipeRight}
				choices={linkChoices}
				onChange={(linkSwipeRight) => {
					setPreferences({linkSwipeRight});
				}}
			/>
			<SelectRow
				row={ROWS.linkSwipeLeft}
				value={prefs.linkSwipeLeft}
				choices={linkChoices}
				onChange={(linkSwipeLeft) => {
					setPreferences({linkSwipeLeft});
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
		<SettingsCard
			section={SECTIONS.extension}
			icon="link-outline"
			description="Shared with the extension, so a change here reaches your browser."
		>
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
