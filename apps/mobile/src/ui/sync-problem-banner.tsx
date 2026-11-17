import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
	dismissKey,
	problemBanner,
	readCompat,
} from '../../../extension/src/shared/sync/compat';
import {useSyncStatus} from '../library/library-store';
import {dismissSyncBanner, useSyncDismissed} from '../library/sync-dismissed';
import {TARGET, useColors, useShape} from './theme';
import {Icon} from './widgets';

/**
Shown at the top of Bookmarks and Sessions while the connected sync server and the app do not match: sync stopped over
another protocol, or the server lacks features. A stopped sync has no Dismiss and goes away once the server or the app
is updated. Missing features can be dismissed on this phone until the server version or the list changes. Settings ›
Sync has the details either way.
*/
export function SyncProblemBanner({
	onOpenSettings,
}: {
	onOpenSettings: () => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const status = useSyncStatus();
	const dismissed = useSyncDismissed();
	const compat = status.connected ? readCompat(status) : undefined;
	const banner = compat && dismissed && problemBanner(compat, dismissed.value);
	if (!compat || !banner) {
		return null;
	}

	const key = dismissKey(compat);
	const tone = banner.stopped ? colors.danger : colors.accent;
	const action = (label: string, onPress: () => void, hint: string) => (
		<Pressable
			accessibilityRole="button"
			accessibilityHint={hint}
			style={({pressed}) => [
				styles.action,
				{
					borderRadius: shape.cardRadius,
					backgroundColor: pressed ? colors.pressed : undefined,
				},
			]}
			onPress={onPress}
		>
			<Text style={[styles.title, {color: colors.accent}]}>{label}</Text>
		</Pressable>
	);
	return (
		<View
			style={[
				styles.banner,
				{
					borderColor: tone,
					borderRadius: shape.cardRadius,
					backgroundColor: colors.surface,
				},
			]}
		>
			<View style={styles.body}>
				<Icon
					name={banner.stopped ? 'alert-circle' : 'cloud-upload-outline'}
					color={tone}
				/>
				<View accessible style={styles.text}>
					<Text style={[styles.title, {color: colors.text}]}>
						{banner.title}
					</Text>
					<Text style={{color: colors.muted}}>{banner.detail}</Text>
				</View>
			</View>
			<View style={styles.actions}>
				{action('Open Settings', onOpenSettings, 'Sync has the details')}
				{key === undefined
					? null
					: action(
							'Dismiss',
							() => {
								dismissSyncBanner(key);
							},
							'Shows again when the server changes',
						)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	banner: {
		gap: 4,
		paddingTop: 14,
		paddingHorizontal: 14,
		paddingBottom: 4,
		borderWidth: 1,
		// The same inset as the search row and chips below it.
		marginHorizontal: 16,
	},
	body: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
	text: {flex: 1, gap: 4},
	title: {fontWeight: '600'},
	// Lined up under the text, past the icon.
	actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginLeft: 24},
	action: {
		minHeight: TARGET,
		justifyContent: 'center',
		paddingHorizontal: 10,
	},
});
