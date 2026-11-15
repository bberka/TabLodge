import Constants from 'expo-constants';
import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {openLink} from '../../platform/open-links';
import {checkAndOfferUpdate} from '../../update/app-update';
import {useColors} from '../../ui/theme';

const REPOSITORY = 'https://github.com/bberka/TabLodge';
const WEBSITE = 'https://tablodge.bbay.dev';

const LINKS = [
	{label: 'Source code', href: REPOSITORY},
	{label: 'Report an issue', href: `${REPOSITORY}/issues`},
	{label: 'Help', href: WEBSITE},
];

/**
The end of Settings: what the app keeps and where, its version, and where to read the code, report a problem, or get
help.
*/
export function SettingsFooter() {
	const colors = useColors();
	const version = Constants.expoConfig?.version ?? '';
	const [busy, setBusy] = useState<string | undefined>();
	return (
		<View style={styles.footer}>
			<Text style={[styles.note, {color: colors.muted}]}>
				TabLodge keeps your bookmarks and sessions on this phone and syncs them
				only with the server you connect. It never reads the pages you save.
			</Text>
			<Text style={{color: colors.muted}}>TabLodge v{version}</Text>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Check for updates"
				accessibilityState={{
					disabled: busy !== undefined,
					busy: busy !== undefined,
				}}
				disabled={busy !== undefined}
				hitSlop={8}
				style={({pressed}) => [styles.update, pressed && {opacity: 0.6}]}
				onPress={() => {
					void checkAndOfferUpdate(setBusy).catch(() => {
						setBusy(undefined);
					});
				}}
			>
				<Text style={[styles.link, {color: colors.accent}]}>
					{busy ?? 'Check for updates'}
				</Text>
			</Pressable>
			<View style={styles.links}>
				{LINKS.map((link, index) => (
					<View key={link.label} style={styles.item}>
						{index > 0 && <Text style={{color: colors.muted}}>·</Text>}
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={link.label}
							hitSlop={8}
							style={({pressed}) => pressed && {opacity: 0.6}}
							onPress={() => {
								openLink(link.href);
							}}
						>
							<Text style={[styles.link, {color: colors.accent}]}>
								{link.label}
							</Text>
						</Pressable>
					</View>
				))}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	footer: {gap: 8, paddingHorizontal: 20, paddingTop: 20},
	note: {fontSize: 13, lineHeight: 19},
	update: {alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center'},
	links: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
	item: {flexDirection: 'row', alignItems: 'center', gap: 8},
	link: {fontSize: 14, fontWeight: '600'},
});
