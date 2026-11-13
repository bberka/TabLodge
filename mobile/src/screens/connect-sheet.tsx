import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SyncError} from '../../../src/shared/sync/client';
import {BottomSheet} from '../bottom-sheet';
import {connectServer, isSampleData, refreshStatus} from '../library-store';
import {useColors} from '../theme';
import {Button, Field} from '../ui';

/**
The drawer for entering the server address and token. It is a drawer so the keyboard lifts it: on Android the
screen no longer resizes for the keyboard, and fields low in a scrolling list ended up hidden behind it.
*/
export function ConnectSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	const [url, setUrl] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const connect = async () => {
		setBusy(true);
		setError('');
		try {
			await connectServer(url, token);
			setToken('');
			onClose();
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

	return (
		<BottomSheet
			visible={visible}
			label="Connect to a server"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Connect to your server
				</Text>
				<Text style={{color: colors.muted}}>
					Use the server you run yourself. Bookmarks and sessions stay the same
					on every device you connect.
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
					loading={busy}
					disabled={busy || !url || !token}
					onPress={() => void connect()}
				/>
				{isSampleData() && (
					<Text style={{color: colors.warn}}>
						Sample data is removed when you connect, so it never reaches your
						server.
					</Text>
				)}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
});
