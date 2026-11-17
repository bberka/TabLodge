import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {SyncStatus} from '../../../../extension/src/shared/sync/client';
import {
	readCompat,
	releaseWithAll,
	UPDATE_GUIDE_URL,
	versionText,
} from '../../../../extension/src/shared/sync/compat';
import {openLink} from '../../platform/open-links';
import {useColors} from '../../ui/theme';

/**
The server's version and what does not work with it: the update a stopped sync needs (its message is in the status
line above), or the features this server lacks.
*/
export function ServerReport({status}: {status: SyncStatus}) {
	const colors = useColors();
	const {server, incompatible, missing} = readCompat(status);
	if (!server) {
		return null;
	}

	const release = releaseWithAll(missing);
	return (
		<View style={styles.report}>
			<Text style={{color: colors.muted}}>
				Server version: {versionText(server.version)}
			</Text>
			{missing.length > 0 && (
				<View style={styles.missing}>
					<Text style={{color: colors.text, fontWeight: '600'}}>
						Until the server is updated
						{release ? ` to ${release} or later` : ''}:
					</Text>
					{missing.map((feature) => (
						<Text key={feature.name} style={{color: colors.muted}}>
							{`• ${feature.missing}`}
						</Text>
					))}
				</View>
			)}
			{(missing.length > 0 || incompatible === 'server') && (
				<Pressable
					accessibilityRole="link"
					hitSlop={8}
					style={({pressed}) => [styles.link, pressed && {opacity: 0.6}]}
					onPress={() => {
						openLink(UPDATE_GUIDE_URL);
					}}
				>
					<Text style={{color: colors.accent, fontWeight: '600'}}>
						How to update the server
					</Text>
				</Pressable>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	report: {gap: 8},
	missing: {gap: 4},
	link: {alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center'},
});
