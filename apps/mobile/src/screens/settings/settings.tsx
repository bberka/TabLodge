import {useEffect, useState} from 'react';
import {ScrollView, useColorScheme, StyleSheet, Text, View} from 'react-native';
import {confirm, showDialog} from '../../ui/dialog';
import {GlassTarget} from '../../ui/glass';
import {trackScroll} from '../../ui/scroll-state';
import type {SyncStatus} from '../../../../extension/src/shared/sync/client';
import {
	clearLibrary,
	disconnectServer,
	isSampleData,
	loadSampleData,
	refreshStatus,
	syncClient,
	useLibrary,
	useSyncStatus,
	resetSyncedSettings,
	setSyncedSetting,
} from '../../library/library-store';
import {useLinkSettings} from '../../library/use-link-settings';
import {useRoomBelow} from '../../ui/keyboard';
import {useBarSpace} from '../../ui/tab-bar';
import {type Colors, useColors} from '../../ui/theme';
import {
	resetPreferences,
	resolveLook,
	setPreferences,
	usePreferences,
} from '../../settings/preferences';
import {applyPrivateSyncSetting} from '../../private/private-library';
import {
	FloatingActions,
	ROOM_FOR_BUTTONS,
	SearchDock,
	useSearch,
} from '../../ui/floating-actions';
import {Button, Empty, Header, Icon, type IconName} from '../../ui/widgets';
import {systemAccent} from '../../../modules/open-links';
import {ACCENTS} from '../../../../extension/src/shared/accent-colors';
import {APP_ACCENT} from '../../ui/accent';
import {ColorPicker, type LeadingChoice} from '../../ui/color-picker';
import {BottomSheet} from '../../ui/bottom-sheet';
import {resultCount} from '../../library/search-count';
import {takeJump, usePendingJump} from '../../library/jump';
import {useSettledText} from '../../ui/search-count';
import {SHARE_MODE_CHOICES} from '../../../../extension/src/shared/choice-copy';
import {DataCard} from './data-settings';
import {TrashCard} from './trash-settings';
import {ExcludedCard} from './excluded-settings';
import {SettingsFooter} from './settings-footer';
import {OpenLinksCard} from './open-links-settings';
import {asChoices, SelectRow, ValueRow} from './select-row';
import {DeviceNameField} from './device-name-field';
import {SharedPagesButton} from './shared-pages-settings';
import {
	BookmarkBehaviourCard,
	SessionSettingsCard,
	SyncedSettingsCard,
	Toggle,
} from './behaviour-settings';
import {SettingsCard, SettingsQuery} from './settings-card';
import {
	matchCount,
	normalizeQuery,
	ROWS,
	SECTIONS,
	sectionVisible,
} from './settings-index';
import {PrivateCard} from './private-settings';
import {AboutCard} from './about-settings';
import {ServerReport} from './server-report';

function describe(
	status: SyncStatus,
	colors: Colors,
): {icon: IconName; color: string; text: string} {
	if (status.error) {
		return {icon: 'alert-circle', color: colors.danger, text: status.error};
	}

	switch (status.phase) {
		case 'syncing': {
			return {icon: 'sync', color: colors.accent, text: 'Syncing…'};
		}

		case 'offline': {
			return {
				icon: 'cloud-offline-outline',
				color: colors.warn,
				text: 'Offline. Changes are kept and sent when the server is reachable.',
			};
		}

		default: {
			return status.pending > 0
				? {
						icon: 'cloud-upload-outline',
						color: colors.warn,
						text: `${status.pending} changes waiting to be sent.`,
					}
				: {icon: 'cloud-done-outline', color: colors.ok, text: 'Up to date.'};
		}
	}
}

const LOOK_NAMES = {
	material: 'the Android look',
	ios: 'the iOS look',
};

function restoreDefaults(syncing: boolean): void {
	const phone = () => {
		resetPreferences();
	};

	const everything = () => {
		resetPreferences();
		void resetSyncedSettings();
	};

	if (!syncing) {
		confirm(
			'Restore default settings?',
			'Every setting goes back to its default. Your bookmarks, sessions and server connection stay.',
			{label: 'Restore', destructive: true},
			everything,
		);
		return;
	}

	showDialog(
		'Restore default settings?',
		"Phone only resets this phone's settings. Phone and shared also resets the settings shared with the extension, such as how addresses show and how sessions sort, on every synced device.",
		[
			{label: 'Cancel', kind: 'cancel'},
			{label: 'Phone only', run: phone},
			{label: 'Phone and shared', kind: 'destructive', run: everything},
		],
	);
}

export function SettingsScreen({onConnect}: {onConnect: () => void}) {
	const colors = useColors();
	const space = useRoomBelow(useBarSpace());
	const status = useSyncStatus();
	const prefs = usePreferences();
	const links = useLinkSettings(true);
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	const [pickingAccent, setPickingAccent] = useState(false);
	const accentChoices: LeadingChoice[] = [
		{
			id: 'system',
			label: 'System color',
			icon: 'phone-portrait-outline',
			hex: systemAccent()?.[scheme] ?? APP_ACCENT,
		},
		{
			id: 'default',
			label: 'TabLodge',
			icon: 'layers-outline',
			hex: APP_ACCENT,
		},
	];
	const chosen = accentChoices.find((choice) => choice.id === prefs.accent);
	const accentName =
		chosen?.label ?? ACCENT_NAMES.get(prefs.accent) ?? 'Custom';
	const accentSwatch =
		chosen?.hex ??
		ACCENTS.find((accent) => accent.id === prefs.accent)?.hex ??
		prefs.accent;
	useLibrary();
	const search = useSearch();
	const pending = usePendingJump();
	useEffect(() => {
		const jump = takeJump('settings');
		if (!jump) {
			return;
		}

		search.show();
		search.setQuery(jump.query);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `search` is new on every render; only a jump matters
	}, [pending]);
	const needle = normalizeQuery(search.query);
	const isNoMatch =
		needle !== '' &&
		Object.values(SECTIONS).every(
			(section) => !sectionVisible(section, needle),
		);
	const searchCount = useSettledText(
		needle !== '',
		resultCount(matchCount(needle)),
	);
	const [busy, setBusy] = useState<'sync' | 'disconnect'>();

	const syncNow = async () => {
		setBusy('sync');
		try {
			await syncClient.syncNow();
		} catch {
		} finally {
			await refreshStatus();
			setBusy(undefined);
		}
	};

	const confirmDisconnect = () => {
		confirm(
			'Disconnect from the server?',
			'This phone stops syncing and forgets the server address and token. Your bookmarks and sessions stay on the phone, and the server keeps its copy.',
			{label: 'Disconnect', destructive: true},
			() => void disconnect(),
		);
	};

	const disconnect = async () => {
		setBusy('disconnect');
		await disconnectServer();
		await refreshStatus();
		setBusy(undefined);
	};

	const state = describe(status, colors);
	return (
		<View style={styles.root}>
			<GlassTarget>
				<ScrollView
					contentContainerStyle={[
						styles.screen,
						{paddingBottom: space + 8 + ROOM_FOR_BUTTONS},
					]}
					keyboardShouldPersistTaps="handled"
					scrollEventThrottle={16}
					onScroll={trackScroll}
				>
					<Header
						title="Settings"
						live={searchCount !== undefined}
						subtitle={searchCount}
					/>
					<SettingsQuery value={needle}>
						<View style={styles.cards}>
							<SettingsCard
								section={SECTIONS.appearance}
								icon="color-palette-outline"
								description="Theme, accent color, and how the app looks."
							>
								<SelectRow
									row={ROWS.theme}
									value={prefs.theme}
									choices={[
										{
											id: 'system',
											name: 'System',
											icon: 'phone-portrait-outline',
										},
										{id: 'light', name: 'Light', icon: 'sunny-outline'},
										{id: 'dark', name: 'Dark', icon: 'moon-outline'},
									]}
									onChange={(theme) => {
										setPreferences({theme});
									}}
								/>
								<ValueRow
									row={ROWS.accent}
									value={accentName}
									swatch={accentSwatch}
									choices={accentChoices.map(({id, label}) => ({
										id,
										name: label,
									}))}
									onPress={() => {
										setPickingAccent(true);
									}}
								/>
								<SelectRow
									row={ROWS.style}
									value={prefs.look}
									choices={[
										{
											id: 'auto',
											name: 'Automatic',
											hint: `Matches your phone: ${LOOK_NAMES[resolveLook('auto')]} here`,
										},
										{id: 'material', name: 'Android look'},
										{id: 'ios', name: 'iOS look'},
									]}
									onChange={(look) => {
										setPreferences({look});
									}}
								/>
								<Toggle
									row={ROWS.floatingBar}
									value={prefs.floatingBar}
									onChange={(floatingBar) => {
										setPreferences({floatingBar});
									}}
								/>
								{prefs.floatingBar && (
									<SelectRow
										row={ROWS.barSize}
										value={prefs.barSize}
										choices={[
											{id: 'full', name: 'Full width'},
											{
												id: 'scroll',
												name: 'Small while scrolling',
												hint: 'Shrinks when you scroll down, grows when you scroll up',
											},
											{
												id: 'compact',
												name: 'Always small',
												hint: 'A narrow bar with icons only',
											},
										]}
										onChange={(barSize) => {
											setPreferences({barSize});
										}}
									/>
								)}
								{resolveLook(prefs.look) === 'ios' && (
									<Toggle
										row={ROWS.glassEffect}
										value={prefs.glassEffect}
										onChange={(glassEffect) => {
											setPreferences({glassEffect});
										}}
									/>
								)}
								<SelectRow
									row={ROWS.messagePosition}
									value={prefs.messagePosition}
									choices={[
										{id: 'top', name: 'Top', icon: 'arrow-up-outline'},
										{id: 'bottom', name: 'Bottom', icon: 'arrow-down-outline'},
									]}
									onChange={(messagePosition) => {
										setPreferences({messagePosition});
									}}
								/>
								<SelectRow
									row={ROWS.toastDuration}
									value={links.toastDuration}
									choices={[
										{id: 'default', name: 'A few seconds'},
										{id: 'longer', name: 'Longer'},
										{
											id: 'dismiss',
											name: 'Until dismissed',
											hint: 'Tap a message to close it',
										},
									]}
									onChange={(value) => {
										void setSyncedSetting('toastDuration', value);
									}}
								/>
								<SelectRow
									row={ROWS.barLabels}
									value={prefs.barLabels}
									choices={[
										{
											id: 'active',
											name: 'Open tab only',
											hint: 'Its name shows under its icon',
										},
										{id: 'always', name: 'All tabs'},
										{id: 'never', name: 'None', hint: 'Icons only'},
									]}
									onChange={(barLabels) => {
										setPreferences({barLabels});
									}}
								/>
							</SettingsCard>
							<SessionSettingsCard />
							<BookmarkBehaviourCard />
							<SyncedSettingsCard />
							<OpenLinksCard />
							<DataCard />
							<TrashCard />
							<ExcludedCard />
							<PrivateCard />
							<SettingsCard
								section={SECTIONS.sync}
								icon="sync-outline"
								description="Keep this phone in step with your server."
							>
								{status.connected ? (
									<>
										<Text style={{color: colors.text}}>
											Connected to {status.url}
										</Text>
										<View
											accessible
											accessibilityLiveRegion="polite"
											style={styles.state}
										>
											<Icon name={state.icon} color={state.color} />
											<Text style={[styles.stateText, {color: colors.text}]}>
												{state.text}
											</Text>
										</View>
										<ServerReport status={status} />
										<Toggle
											row={ROWS.syncSettings}
											value={prefs.syncSettings}
											onChange={(syncSettings) => {
												setPreferences({syncSettings});
											}}
										/>
										<Toggle
											row={ROWS.syncPrivate}
											value={prefs.syncPrivate}
											onChange={(syncPrivate) => {
												setPreferences({syncPrivate});
												void applyPrivateSyncSetting();
											}}
										/>
										<Toggle
											row={ROWS.backgroundSync}
											value={prefs.backgroundSync}
											onChange={(backgroundSync) => {
												setPreferences({backgroundSync});
											}}
										/>
										<DeviceNameField />
										<SelectRow
											row={ROWS.defaultShareMode}
											value={links.defaultShareMode}
											choices={asChoices(SHARE_MODE_CHOICES)}
											onChange={(value) => {
												void setSyncedSetting('defaultShareMode', value);
											}}
										/>
										<SharedPagesButton />
										<Button
											label="Sync now"
											icon="sync"
											loading={busy === 'sync'}
											disabled={busy !== undefined}
											onPress={() => void syncNow()}
										/>
										<Button
											label="Disconnect"
											kind="danger"
											icon="log-out-outline"
											loading={busy === 'disconnect'}
											disabled={busy !== undefined}
											onPress={confirmDisconnect}
										/>
									</>
								) : (
									<>
										<Text style={{color: colors.muted}}>
											Keep bookmarks and sessions the same on every device.
										</Text>
										<Button
											label="Connect to a server"
											icon="link"
											onPress={onConnect}
										/>
									</>
								)}
							</SettingsCard>
							{__DEV__ && (
								<SettingsCard
									section={SECTIONS.development}
									icon="construct-outline"
									description="Only in development builds."
								>
									<Text style={{color: colors.muted}}>
										{status.connected
											? 'Sample data is off while a server is connected, so it cannot reach it.'
											: isSampleData()
												? 'The library holds sample data.'
												: 'Load the same sample sessions and bookmarks as the extension dev build.'}
									</Text>
									<Button
										label="Load sample data"
										icon="flask-outline"
										disabled={status.connected}
										onPress={() => {
											confirm(
												'Load sample data?',
												'The sample sessions and bookmarks replace everything in the library.',
												{label: 'Load', destructive: true},
												() => void loadSampleData(),
											);
										}}
									/>
									<Button
										label="Clear library"
										kind="danger"
										icon="trash-outline"
										disabled={status.connected}
										onPress={() => {
											confirm(
												'Clear the library?',
												'Every session and bookmark on this phone is deleted.',
												{label: 'Clear', destructive: true},
												() => void clearLibrary(),
											);
										}}
									/>
								</SettingsCard>
							)}
							<SettingsCard
								section={SECTIONS.restore}
								icon="refresh-outline"
								description="Puts settings back the way they were at install. Your library is not touched. While syncing, you choose whether the settings shared with the extension reset too."
							>
								<Button
									label="Restore default settings"
									kind="danger"
									icon="refresh-outline"
									onPress={() => {
										restoreDefaults(status.connected);
									}}
								/>
							</SettingsCard>
							<AboutCard />
							{isNoMatch && (
								<Empty icon="search" title="No setting matches">
									Try another word, such as swipe, sync, or private.
								</Empty>
							)}
						</View>
					</SettingsQuery>
					{needle === '' && <SettingsFooter />}
					<BottomSheet
						visible={pickingAccent}
						label="Accent color"
						onClose={() => {
							setPickingAccent(false);
						}}
					>
						<View style={styles.accentSheet}>
							<Text
								accessibilityRole="header"
								style={[styles.heading, {color: colors.text}]}
							>
								Accent color
							</Text>
							<ColorPicker
								keepSelected
								selected={prefs.accent}
								leading={accentChoices}
								onSelect={(accent) => {
									setPreferences({accent});
								}}
							/>
							<Button
								label="Done"
								icon="checkmark"
								onPress={() => {
									setPickingAccent(false);
								}}
							/>
						</View>
					</BottomSheet>
				</ScrollView>
			</GlassTarget>
			{!search.open && (
				<FloatingActions
					bottom={space}
					searchLabel="Search settings"
					onSearch={search.show}
				/>
			)}
			{search.open && (
				<SearchDock
					label="Search settings"
					placeholder="Swipe, sync, private, icons"
					bottom={space}
					query={search.query}
					onChange={search.setQuery}
					onClose={search.close}
				/>
			)}
		</View>
	);
}

const ACCENT_NAMES = new Map<string, string>(
	ACCENTS.map((accent) => [accent.id, accent.label]),
);

const styles = StyleSheet.create({
	accentSheet: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	screen: {paddingBottom: 24},
	root: {flex: 1},
	cards: {paddingHorizontal: 16, gap: 16},
	heading: {fontSize: 18, fontWeight: '600'},
	state: {flexDirection: 'row', alignItems: 'center', gap: 10},
	stateText: {flex: 1},
	switchRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
	switchText: {flex: 1},
});
