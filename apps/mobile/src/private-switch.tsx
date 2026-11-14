import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from './bottom-sheet';
import {confirm, notify} from './dialog';
import {usePreferences} from './preferences';
import {isPrivateOpen, lockPrivate, openPrivate} from './private-library';
import {useSyncStatus} from './library-store';
import {useColors} from './theme';
import {Button, Field, IconButton} from './ui';
import {setView, useView} from './view';

const NOT_CONNECTED =
	'Connect to your sync server in Settings first. The private library is read from the same server.';
const UNAVAILABLE =
	'This server has no private library. Turn on Sync private windows in the extension, or update the server.';

/**
Asks before locking the private library: its key and its copy leave this phone, so opening it again needs the PIN or
password and the server.
*/
export function askToLock(): void {
	confirm(
		'Lock the private library?',
		'This removes its key and its copy from this phone. Your server keeps it, and you can open it again with the PIN or password.',
		{label: 'Lock now', destructive: true},
		() => void lockPrivate(),
	);
}

/**
Flips between the regular library and the private windows' library. The private one asks for its PIN or password the
first time, when it has one. As a header icon (the default) it appears only when the person turned the button on in
Settings, and only while a server is connected, or while the private library is open, so there is always a way back;
with `button` it is a labeled button that is always there, for Settings.
*/
export function PrivateSwitch({button = false}: {button?: boolean}) {
	const colors = useColors();
	const view = useView();
	const {showPrivateButton} = usePreferences();
	const {connected} = useSyncStatus();
	const [asking, setAsking] = useState(false);
	const [secret, setSecret] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);

	const enter = async (credential?: string) => {
		setBusy(true);
		const result = await openPrivate(credential);
		setBusy(false);
		if (result.ok) {
			setAsking(false);
			setSecret('');
			setProblem(undefined);
			setView('private');
			return;
		}

		switch (result.reason) {
			case 'credential': {
				setAsking(true);
				break;
			}

			case 'wrong': {
				setProblem('That PIN or password is wrong.');
				break;
			}

			case 'not-connected': {
				notify('Not connected', NOT_CONNECTED);
				break;
			}

			case 'unavailable': {
				notify('No private library', UNAVAILABLE);
				break;
			}

			default: {
				notify('Could not open it', result.message ?? 'Try again.');
			}
		}
	};

	const priv = view === 'private';
	const toggle = () => {
		if (priv) {
			setView('regular');
		} else if (isPrivateOpen()) {
			setView('private');
		} else {
			void enter();
		}
	};

	const visible = button || priv || (showPrivateButton && connected);
	return (
		<>
			{visible &&
				(button ? (
					<Button
						label={
							priv ? 'Back to your regular library' : 'Open the private library'
						}
						icon={priv ? 'arrow-back-outline' : 'glasses-outline'}
						onPress={toggle}
					/>
				) : (
					<>
						{priv && (
							<IconButton
								icon="lock-closed-outline"
								label="Lock now"
								onPress={askToLock}
							/>
						)}
						<IconButton
							icon={priv ? 'glasses' : 'glasses-outline'}
							label={
								priv ? 'Back to your regular library' : 'Show private library'
							}
							color={priv ? colors.accent : undefined}
							onPress={toggle}
						/>
					</>
				))}
			<BottomSheet
				visible={asking}
				label="Unlock private library"
				onClose={() => {
					setAsking(false);
					setSecret('');
					setProblem(undefined);
				}}
			>
				<View style={styles.body}>
					<Text
						accessibilityRole="header"
						style={[styles.title, {color: colors.text}]}
					>
						Private library
					</Text>
					<Text style={{color: colors.muted}}>
						It is protected on your server. Enter the PIN or password you set
						for private windows in the extension. This phone keeps the key in
						its secure storage, so it asks only once.
					</Text>
					<Field
						secureTextEntry
						label="PIN or password"
						icon="lock-closed-outline"
						value={secret}
						autoCapitalize="none"
						autoCorrect={false}
						error={problem}
						onChangeText={(text) => {
							setSecret(text);
							setProblem(undefined);
						}}
					/>
					<Button
						label="Unlock"
						icon="lock-open-outline"
						disabled={secret.length === 0}
						loading={busy}
						onPress={() => void enter(secret)}
					/>
				</View>
			</BottomSheet>
		</>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
});
