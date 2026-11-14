import {Alert, StyleSheet, Text} from 'react-native';
import {PrivateSwitch} from '../private-switch';
import {setPreferences, usePreferences} from '../preferences';
import {lockPrivate, usePrivateStatus} from '../private-library';
import {useColors} from '../theme';
import {Button} from '../ui';
import {SettingsCard} from './settings-card';
import {Toggle} from './behaviour-settings';
import {ROWS, SECTIONS} from './settings-index';

/**
What this phone keeps of the private windows' library, and a way to forget it.
*/
export function PrivateCard() {
	const colors = useColors();
	const status = usePrivateStatus();
	const prefs = usePreferences();
	return (
		<SettingsCard section={SECTIONS.private}>
			<Text
				accessibilityRole="header"
				style={[styles.heading, {color: colors.text}]}
			>
				Private library
			</Text>
			<Text style={{color: colors.muted}}>
				{status.connected
					? (status.error ?? 'Open, and read only here.')
					: 'Read the private windows’ library from your server.'}
			</Text>
			<PrivateSwitch button />
			<Toggle
				row={ROWS.showPrivateButton}
				value={prefs.showPrivateButton}
				onChange={(showPrivateButton) => {
					setPreferences({showPrivateButton});
				}}
			/>
			{status.connected && (
				<Button
					label="Forget on this phone"
					icon="eye-off-outline"
					kind="plain"
					onPress={() => {
						Alert.alert(
							'Forget the private library?',
							'This removes its key and its copy from this phone. Your server keeps it, and you can open it again with the PIN or password.',
							[
								{text: 'Cancel', style: 'cancel'},
								{
									text: 'Forget',
									style: 'destructive',
									onPress() {
										void lockPrivate();
									},
								},
							],
						);
					}}
				/>
			)}
		</SettingsCard>
	);
}

const styles = StyleSheet.create({
	heading: {fontSize: 18, fontWeight: '700'},
});
