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
import {TARGET, useColors} from '../theme';
import {Empty} from '../ui';

/**
Sessions saved in the browser extension, read only: a phone browser cannot create them.
*/
export function SessionsScreen() {
	const colors = useColors();
	const store = useLibrary();
	const [open, setOpen] = useState<string | undefined>();

	if (store.groups.length === 0) {
		return (
			<Empty>
				No sessions yet. Sessions saved in the TabLodge extension appear here
				once this phone is synced with your server.
			</Empty>
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
		return (
			<View
				key={session.id}
				style={[styles.session, {borderColor: colors.border}]}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityState={{expanded}}
					accessibilityLabel={`${session.name}, ${session.tabs.length} tabs`}
					style={styles.sessionHead}
					onPress={() => {
						setOpen(expanded ? undefined : session.id);
					}}
				>
					<Text style={[styles.name, {color: colors.text}]}>
						{session.name}
					</Text>
					<Text style={{color: colors.muted}}>
						{session.tabs.length} {session.tabs.length === 1 ? 'tab' : 'tabs'}
					</Text>
				</Pressable>
				{expanded &&
					session.tabs.map((tab) => (
						<Pressable
							key={tab.id}
							accessibilityRole="link"
							accessibilityLabel={`${tab.title || hostOf(tab.url)}, ${hostOf(tab.url)}`}
							accessibilityHint="Opens the link"
							style={styles.tab}
							onPress={() => {
								void Linking.openURL(tab.url);
							}}
						>
							<Text numberOfLines={2} style={{color: colors.text}}>
								{tab.title || tab.url}
							</Text>
							<Text numberOfLines={1} style={{color: colors.muted}}>
								{hostOf(tab.url)}
							</Text>
						</Pressable>
					))}
			</View>
		);
	};

	return (
		<ScrollView contentContainerStyle={styles.screen}>
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
	screen: {padding: 16, gap: 18},
	section: {gap: 6},
	folder: {fontSize: 13, fontWeight: '600', textTransform: 'uppercase'},
	session: {borderBottomWidth: StyleSheet.hairlineWidth},
	sessionHead: {
		minHeight: TARGET + 8,
		justifyContent: 'center',
		paddingVertical: 8,
	},
	name: {fontSize: 16, fontWeight: '500'},
	tab: {minHeight: TARGET, paddingVertical: 8, paddingLeft: 16, gap: 2},
});
