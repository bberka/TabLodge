import {useState} from 'react';
import {ScrollView, useColorScheme, StyleSheet, Text, View} from 'react-native';
import type {SyncStatus} from '../../../extension/src/shared/sync/client';
import {
	clearLibrary,
	isSampleData,
	loadSampleData,
	refreshStatus,
	syncClient,
	useLibrary,
	useSyncStatus,
} from '../library-store';
import {useBarSpace} from '../tab-bar';
import {type Colors, useColors} from '../theme';
import {setPreferences, usePreferences} from '../preferences';
import {Button, Empty, Field, Header, Icon, type IconName} from '../ui';
import {systemAccent} from '../../modules/open-links';
import {ACCENTS} from '../../../extension/src/shared/accent-colors';
import {APP_ACCENT} from '../accent';
import {ColorPicker, type LeadingChoice} from '../color-picker';
import {BottomSheet} from '../bottom-sheet';
import {SelectRow, ValueRow} from './select-row';
import {DeviceNameField} from './device-name-field';
import {
	BookmarkBehaviourCard,
	SessionSettingsCard,
	SyncedSettingsCard,
	Toggle,
} from './behaviour-settings';
import {SettingsCard, SettingsQuery} from './settings-card';
import {normalizeQuery, ROWS, SECTIONS, sectionVisible} from './settings-index';
import {PrivateCard} from './private-settings';

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

export function SettingsScreen({onConnect}: {onConnect: () => void}) {
	const colors = useColors();
	const space = useBarSpace();
	const status = useSyncStatus();
	const prefs = usePreferences();
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
	const [query, setQuery] = useState('');
	const needle = normalizeQuery(query);
	const noMatch =
		needle !== '' &&
		Object.values(SECTIONS).every(
			(section) => !sectionVisible(section, needle),
		);
	const [busy, setBusy] = useState<'sync' | 'disconnect'>();

	const syncNow = async () => {
		setBusy('sync');
		try {
			await syncClient.syncNow();
		} catch {
			// The status line shows why.
		} finally {
			await refreshStatus();
			setBusy(undefined);
		}
	};

	const disconnect = async () => {
		setBusy('disconnect');
		await syncClient.disconnect();
		await refreshStatus();
		setBusy(undefined);
	};

	const state = describe(status, colors);
	return (
		<ScrollView
			contentContainerStyle={[styles.screen, {paddingBottom: space + 8}]}
			keyboardShouldPersistTaps="handled"
		>
			<Header title="Settings" />
			<View style={styles.search}>
				<Field
					label="Search settings"
					icon="search"
					placeholder="Swipe, sync, private, icons"
					value={query}
					onChangeText={setQuery}
					onClear={() => {
						setQuery('');
					}}
				/>
			</View>
			<SettingsQuery value={needle}>
				<View style={styles.cards}>
					<SettingsCard section={SECTIONS.appearance}>
						<Text
							accessibilityRole="header"
							style={[styles.heading, {color: colors.text}]}
						>
							Appearance
						</Text>
						<SelectRow
							row={ROWS.theme}
							value={prefs.theme}
							choices={[
								{id: 'system', name: 'System', icon: 'phone-portrait-outline'},
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
							onPress={() => {
								setPickingAccent(true);
							}}
						/>
						<SelectRow
							row={ROWS.style}
							value={prefs.look}
							choices={[
								{
									id: 'material',
									name: 'Android',
									hint: 'Follows your phone by default',
								},
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
					</SettingsCard>
					<SessionSettingsCard />
					<BookmarkBehaviourCard />
					<SyncedSettingsCard />
					<PrivateCard />
					<SettingsCard section={SECTIONS.sync}>
						<Text
							accessibilityRole="header"
							style={[styles.heading, {color: colors.text}]}
						>
							Sync
						</Text>
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
								<Toggle
									row={ROWS.syncSettings}
									value={prefs.syncSettings}
									onChange={(syncSettings) => {
										setPreferences({syncSettings});
									}}
								/>
								<DeviceNameField />
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
									onPress={() => void disconnect()}
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
						<SettingsCard section={SECTIONS.development}>
							<Text
								accessibilityRole="header"
								style={[styles.heading, {color: colors.text}]}
							>
								Development
							</Text>
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
								onPress={() => void loadSampleData()}
							/>
							<Button
								label="Clear library"
								kind="danger"
								icon="trash-outline"
								disabled={status.connected}
								onPress={() => void clearLibrary()}
							/>
						</SettingsCard>
					)}
					{noMatch && (
						<Empty icon="search" title="No setting matches">
							Try another word, such as swipe, sync, or private.
						</Empty>
					)}
				</View>
			</SettingsQuery>
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
	);
}

const ACCENT_NAMES = new Map<string, string>(
	ACCENTS.map((accent) => [accent.id, accent.label]),
);

const styles = StyleSheet.create({
	accentSheet: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	screen: {paddingBottom: 24},
	search: {paddingHorizontal: 16, paddingBottom: 12},
	cards: {paddingHorizontal: 16, gap: 16},
	heading: {fontSize: 18, fontWeight: '600'},
	state: {flexDirection: 'row', alignItems: 'center', gap: 10},
	stateText: {flex: 1},
	switchRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
	switchText: {flex: 1},
});
