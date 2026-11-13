import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {SyncError, type SyncStatus} from '../../../src/shared/sync/client';
import {
	clearLibrary,
	connectServer,
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
	Field,
	Header,
	Icon,
	type IconName,
	Segmented,
	Switch,
} from '../ui';
import {BookmarkBehaviourCard, SyncedSettingsCard} from './behaviour-settings';
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
	const [url, setUrl] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect'>();
	const [error, setError] = useState('');

	const connect = async () => {
		setBusy('connect');
		setError('');
		try {
			await connectServer(url, token);
			setToken('');
		} catch (error_) {
			setError(
				error_ instanceof SyncError
					? error_.message
					: 'Could not reach the server.',
			);
		} finally {
			await refreshStatus();
			setBusy(undefined);
		}
	};

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
							{id: 'material', name: 'Android'},
							{id: 'ios', name: 'iOS'},
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
							<Field
								label="Server address"
								icon="globe-outline"
								value={url}
								placeholder="https://tablodge.example.com"
								autoCapitalize="none"
								autoCorrect={false}
								keyboardType="url"
								onChangeText={setUrl}
								onClear={() => {
									setUrl('');
								}}
							/>
							<Field
								secureTextEntry
								label="Token"
								icon="key-outline"
								value={token}
								autoCapitalize="none"
								autoCorrect={false}
								error={error || undefined}
								onChangeText={setToken}
							/>
							<Button
								label="Connect"
								icon="link"
								loading={busy === 'connect'}
								disabled={busy !== undefined || !url || !token}
								onPress={() => void connect()}
							/>
							{isSampleData() && (
								<Text style={{color: colors.warn}}>
									Sample data is removed when you connect, so it never reaches
									your server.
								</Text>
							)}
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
