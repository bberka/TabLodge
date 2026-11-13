import {Alert, StyleSheet, Text} from 'react-native';
import {lockPrivate, usePrivateStatus} from '../private-library';
import {useColors} from '../theme';
import {Button, Card} from '../ui';

/**
What this phone keeps of the private windows' library, and a way to forget it.
*/
export function PrivateCard() {
	const colors = useColors();
	const status = usePrivateStatus();
	return (
		<Card>
			<Text
				accessibilityRole="header"
				style={[styles.heading, {color: colors.text}]}
			>
				Private library
			</Text>
			<Text style={{color: colors.muted}}>
				{status.connected
					? (status.error ??
						'Open. It is read only here, and every private bookmark and session is opened in your browser like any other.')
					: 'Use the eye button on Bookmarks or Sessions to read the private windows’ library from your server. If it has a PIN or password, you enter it once.'}
			</Text>
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
		</Card>
	);
}

const styles = StyleSheet.create({
	heading: {fontSize: 18, fontWeight: '700'},
});
