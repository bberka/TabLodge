import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {SyncError} from '../../../src/shared/sync/client';
import {refreshStatus, syncClient, useSyncStatus} from '../library-store';
import {useColors} from '../theme';
import {Button, Field} from '../ui';

function describe(phase: string, pending: number, error: string | null) {
	if (error) {
		return error;
	}

	if (phase === 'syncing') {
		return 'Syncing…';
	}

	if (phase === 'offline') {
		return 'Offline. Changes are kept and sent when the server is reachable.';
	}

	return pending > 0 ? `${pending} changes waiting to be sent.` : 'Up to date.';
}

export function SettingsScreen() {
	const colors = useColors();
	const status = useSyncStatus();
	const [url, setUrl] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const connect = async () => {
		setBusy(true);
		setError('');
		try {
			await syncClient.connect(url, token);
			setToken('');
		} catch (error_) {
			setError(
				error_ instanceof SyncError
					? error_.message
					: 'Could not reach the server.',
			);
		} finally {
			await refreshStatus();
			setBusy(false);
		}
	};

	const disconnect = async () => {
		setBusy(true);
		await syncClient.disconnect();
		await refreshStatus();
		setBusy(false);
	};

	return (
		<ScrollView
			contentContainerStyle={styles.screen}
			keyboardShouldPersistTaps="handled"
		>
			<Text
				accessibilityRole="header"
				style={[styles.heading, {color: colors.text}]}
			>
				Sync
			</Text>
			{status.connected ? (
				<View style={styles.group}>
					<Text style={{color: colors.text}}>Connected to {status.url}</Text>
					<Text accessibilityLiveRegion="polite" style={{color: colors.muted}}>
						{describe(status.phase, status.pending, status.error)}
					</Text>
					<Button
						label="Sync now"
						disabled={busy}
						onPress={() => {
							setBusy(true);
							void syncClient
								.syncNow()
								.catch(() => undefined)
								.then(refreshStatus)
								.finally(() => {
									setBusy(false);
								});
						}}
					/>
					<Button
						label="Disconnect"
						kind="danger"
						disabled={busy}
						onPress={() => void disconnect()}
					/>
				</View>
			) : (
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>
						Connect to the server you run yourself. Bookmarks and sessions stay
						the same on every device you connect. See the self hosting guide for
						how to set one up.
					</Text>
					<Field
						label="Server address"
						value={url}
						placeholder="https://tablodge.example.com"
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						onChangeText={setUrl}
					/>
					<Field
						secureTextEntry
						label="Token"
						value={token}
						autoCapitalize="none"
						autoCorrect={false}
						onChangeText={setToken}
					/>
					{error.length > 0 && (
						<Text
							accessibilityLiveRegion="polite"
							style={{color: colors.danger}}
						>
							{error}
						</Text>
					)}
					<Button
						label={busy ? 'Connecting…' : 'Connect'}
						disabled={busy || !url || !token}
						onPress={() => void connect()}
					/>
				</View>
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {padding: 16, gap: 14},
	heading: {fontSize: 20, fontWeight: '600'},
	group: {gap: 12},
});
