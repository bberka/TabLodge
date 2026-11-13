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
import {columnGlyph} from '../column-icons';
import {ALL_SESSIONS_ID, hostOf, sessionFolders, sessionsIn} from '../library';
import {useLibrary} from '../library-store';
import {useBarSpace} from '../tab-bar';
import {TARGET, useColors} from '../theme';
import {linkToOpen} from '../links';
import {openAll} from '../open-links';
import {PrivateSwitch} from '../private-switch';
import {useLinkSettings} from '../use-link-settings';
import {useView} from '../view';
import {Avatar, Card, Chips, Empty, Header, Icon, IconButton} from '../ui';

const folderGlyph = (folder: {id: string; name: string; icon?: string}) => {
	if (folder.id === ALL_SESSIONS_ID) {
		return 'albums-outline';
	}

	return folder.name.toLocaleLowerCase() === 'archived'
		? 'archive-outline'
		: columnGlyph(folder.icon);
};

/**
Sessions from the browser extension, and ones saved here from a shared list of links. A phone browser cannot list its own tabs, so there is no capture here.
*/
export function SessionsScreen() {
	const colors = useColors();
	const space = useBarSpace();
	const store = useLibrary();
	const links = useLinkSettings();
	const view = useView();
	const [open, setOpen] = useState<string | undefined>();
	const [picked, setPicked] = useState(ALL_SESSIONS_ID);
	const [pressing, setPressing] = useState<string | undefined>();

	if (store.groups.length === 0) {
		return (
			<View style={styles.screen}>
				<Header title="Sessions" right={<PrivateSwitch />} />
				<Empty icon="albums-outline" title="No sessions yet">
					Sessions saved in the TabLodge extension appear here once this phone
					is synced with your server. To save one from here, share several links
					from your browser to TabLodge.
				</Empty>
			</View>
		);
	}

	const folders = sessionFolders(store);
	const folderId = folders.some((folder) => folder.id === picked)
		? picked
		: ALL_SESSIONS_ID;
	const shown = sessionsIn(store, folderId, links.sessionSort);

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
								session.tabs.map((tab) => linkToOpen(tab.url, links)),
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
								void Linking.openURL(linkToOpen(tab.url, links));
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
				subtitle={`${folders[0]?.count ?? 0} ${view === 'private' ? 'in the private library, read only' : 'saved'}`}
				right={<PrivateSwitch />}
			/>
			<View style={styles.filters}>
				<Chips
					items={folders.map((folder) => ({
						...folder,
						glyph: folderGlyph(folder),
					}))}
					selected={folderId}
					onSelect={setPicked}
				/>
			</View>
			<View style={styles.section}>
				{shown.length === 0 && (
					<Text style={{color: colors.muted}}>Nothing in this folder.</Text>
				)}
				{shown.map((session) => renderSession(session))}
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	list: {paddingBottom: 24, gap: 8},
	section: {gap: 8, paddingHorizontal: 16, paddingTop: 8},
	filters: {paddingHorizontal: 16, paddingTop: 4},
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
