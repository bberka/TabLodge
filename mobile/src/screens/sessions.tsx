import {useState} from 'react';
import {
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import type {Session} from '../../../src/app/types';
import {hostOf} from '../library';
import {useLibrary} from '../library-store';
import {useBarSpace} from '../tab-bar';
import {TARGET, useColors} from '../theme';
import {openAll} from '../open-links';
import {Avatar, Card, Empty, Header, Icon, IconButton} from '../ui';

/**
Sessions saved in the browser extension, read only: a phone browser cannot create them.
*/
export function SessionsScreen() {
	const colors = useColors();
	const space = useBarSpace();
	const store = useLibrary();
	const [open, setOpen] = useState<string | undefined>();
	const [pressing, setPressing] = useState<string | undefined>();

	if (store.groups.length === 0) {
		return (
			<View style={styles.screen}>
				<Header title="Sessions" />
				<Empty icon="albums-outline" title="No sessions yet">
					Sessions saved in the TabLodge extension appear here once this phone
					is synced with your server. Saving a session needs a desktop browser.
				</Empty>
			</View>
		);
	}

	const sections = store.folders
		.map((folder) => ({
			id: folder.id,
			name: folder.name,
			sessions: store.groups.filter(
				(session) => session.folderId === folder.id,
			),
		}))
		.filter((section) => section.sessions.length > 0);
	const known = new Set(store.folders.map((folder) => folder.id));
	const loose = store.groups.filter((session) => !known.has(session.folderId));
	if (loose.length > 0) {
		sections.push({id: 'loose', name: 'Other', sessions: loose});
	}

	const renderSession = (session: Session) => {
		const expanded = open === session.id;
		const count = `${session.tabs.length} ${session.tabs.length === 1 ? 'tab' : 'tabs'}`;
		return (
			<Card key={session.id} flush>
				<View
					style={[
						styles.headRow,
						{
							backgroundColor:
								pressing === session.id ? colors.pressed : 'transparent',
						},
					]}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{expanded}}
						accessibilityLabel={`${session.name}, ${count}`}
						android_ripple={{color: colors.pressed}}
						style={styles.sessionHead}
						onPressIn={() => {
							setPressing(session.id);
						}}
						onPressOut={() => {
							setPressing(undefined);
						}}
						onPress={() => {
							setOpen(expanded ? undefined : session.id);
						}}
					>
						<View style={styles.texts}>
							<Text style={[styles.name, {color: colors.text}]}>
								{session.name}
							</Text>
							<Text style={{color: colors.muted}}>{count}</Text>
						</View>
						<Icon
							name={expanded ? 'chevron-up' : 'chevron-down'}
							color={colors.muted}
						/>
					</Pressable>
					<IconButton
						icon="albums-outline"
						label={`Open all ${count} in ${session.name}`}
						color={colors.accent}
						onPress={() => {
							openAll(
								session.tabs.map((tab) => tab.url),
								session.name,
							);
						}}
					/>
				</View>
				{expanded &&
					session.tabs.map((tab) => (
						<Pressable
							key={tab.id}
							accessibilityRole="link"
							accessibilityLabel={`${tab.title || hostOf(tab.url)}, ${hostOf(tab.url)}`}
							accessibilityHint="Opens the link"
							android_ripple={{color: colors.pressed}}
							style={({pressed}) => [
								styles.tab,
								{backgroundColor: pressed ? colors.pressed : 'transparent'},
							]}
							onPress={() => {
								void Linking.openURL(tab.url);
							}}
						>
							<Avatar host={hostOf(tab.url)} size={32} />
							<View style={styles.texts}>
								<Text numberOfLines={2} style={{color: colors.text}}>
									{tab.title || tab.url}
								</Text>
								<Text
									numberOfLines={1}
									style={{color: colors.muted, fontSize: 13}}
								>
									{hostOf(tab.url)}
								</Text>
							</View>
							<Icon name="open-outline" size={18} color={colors.muted} />
						</Pressable>
					))}
			</Card>
		);
	};

	return (
		<ScrollView
			contentContainerStyle={[styles.list, {paddingBottom: space + 8}]}
		>
			<Header
				title="Sessions"
				subtitle={`${store.groups.length} from your browser, read only`}
			/>
			{sections.map((section) => (
				<View key={section.id} style={styles.section}>
					<Text
						accessibilityRole="header"
						style={[styles.folder, {color: colors.muted}]}
					>
						{section.name}
					</Text>
					{section.sessions.map((session) => renderSession(session))}
				</View>
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	list: {paddingBottom: 24, gap: 8},
	section: {gap: 8, paddingHorizontal: 16, paddingTop: 8},
	folder: {
		fontSize: 13,
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	headRow: {flexDirection: 'row', alignItems: 'center', paddingRight: 8},
	sessionHead: {
		flex: 1,
		minHeight: TARGET + 24,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	texts: {flex: 1, gap: 2},
	name: {fontSize: 16, fontWeight: '600'},
	tab: {
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
});
