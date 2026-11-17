import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
	problemBanner,
	readCompat,
} from '../../../extension/src/shared/sync/compat';
import {useSyncStatus} from '../library/library-store';
import {TARGET, useColors, useShape} from './theme';
import {Icon} from './widgets';

/**
Shown at the top of Bookmarks and Sessions while the connected sync server and the app do not match: sync stopped over
another protocol, or the server lacks features. It has no close button; it goes away once the server or the app is
updated. Tapping it opens Settings, where Sync has the details.
*/
export function SyncProblemBanner({
	onOpenSettings,
}: {
	onOpenSettings: () => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const status = useSyncStatus();
	const banner = status.connected
		? problemBanner(readCompat(status))
		: undefined;
	if (!banner) {
		return null;
	}

	const tone = banner.stopped ? colors.danger : colors.accent;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${banner.title}. ${banner.detail}`}
			accessibilityHint="Opens Settings"
			style={({pressed}) => [
				styles.banner,
				{
					borderColor: tone,
					borderRadius: shape.cardRadius,
					backgroundColor: pressed ? colors.pressed : colors.surface,
				},
			]}
			onPress={onOpenSettings}
		>
			<Icon
				name={banner.stopped ? 'alert-circle' : 'cloud-upload-outline'}
				color={tone}
			/>
			<View style={styles.text}>
				<Text style={[styles.title, {color: colors.text}]}>{banner.title}</Text>
				<Text style={{color: colors.muted}}>{banner.detail}</Text>
				<Text style={[styles.title, {color: colors.accent}]}>
					Open Settings
				</Text>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	banner: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 12,
		minHeight: TARGET,
		padding: 14,
		borderWidth: 1,
		// The same inset as the search row and chips below it.
		marginHorizontal: 16,
	},
	text: {flex: 1, gap: 4},
	title: {fontWeight: '600'},
});
