import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {SyncStatus} from '../../../src/shared/sync/client';
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
import {
	Button,
	Card,
	Header,
	Icon,
	type IconName,
	Segmented,
	Switch,
} from '../ui';
import {
	BookmarkBehaviourCard,
	SyncedSettingsCard,
	Toggle,
} from './behaviour-settings';
import {ConnectSheet} from './connect-sheet';
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

export function SettingsScreen() {
	const colors = useColors();
	const space = useBarSpace();
	const status = useSyncStatus();
	const prefs = usePreferences();
	useLibrary();
	const [connecting, setConnecting] = useState(false);
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
			<View style={styles.cards}>
				<Card>
					<Text
						accessibilityRole="header"
						style={[styles.heading, {color: colors.text}]}
					>
						Appearance
					</Text>
					<Text style={{color: colors.muted}}>
						Make the app look like Android or like iOS. It follows your phone by
						default.
					</Text>
					<Segmented
						label="Style"
						items={[
							{id: 'material', name: 'Android', icon: 'logo-android'},
							{id: 'ios', name: 'iOS', icon: 'logo-apple'},
						]}
						selected={prefs.look}
						onSelect={(look) => {
							setPreferences({look});
						}}
					/>
					<View style={styles.switchRow}>
						<View style={styles.switchText}>
							<Text style={{color: colors.text, fontSize: 16}}>
								Floating tab bar
							</Text>
							<Text style={{color: colors.muted}}>
								A rounded bar above the content
							</Text>
						</View>
						<Switch
							label="Floating tab bar"
							value={prefs.floatingBar}
							onValueChange={(floatingBar) => {
								setPreferences({floatingBar});
							}}
						/>
					</View>
				</Card>
				<Card>
					<Toggle
						label="Sync app settings"
						hint="Look, tab bar, tap and swipe actions follow your other phones when sync is on. Turning it on sends this phone's settings."
						value={prefs.syncSettings}
						onChange={(syncSettings) => {
							setPreferences({syncSettings});
						}}
					/>
				</Card>
				<BookmarkBehaviourCard />
				<SyncedSettingsCard />
				<PrivateCard />
				<Card>
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
								Connect to the server you run yourself. Bookmarks and sessions
								stay the same on every device you connect.
							</Text>
							<Button
								label="Connect to a server"
								icon="link"
								onPress={() => {
									setConnecting(true);
								}}
							/>
						</>
					)}
				</Card>
				{__DEV__ && (
					<Card>
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
					</Card>
				)}
			</View>
			<ConnectSheet
				visible={connecting}
				onClose={() => {
					setConnecting(false);
				}}
			/>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {paddingBottom: 24},
	cards: {paddingHorizontal: 16, gap: 16},
	heading: {fontSize: 18, fontWeight: '600'},
	state: {flexDirection: 'row', alignItems: 'center', gap: 10},
	stateText: {flex: 1},
	switchRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
	switchText: {flex: 1},
});
