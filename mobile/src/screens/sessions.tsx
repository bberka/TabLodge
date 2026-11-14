import {memo, useCallback, useMemo, useState} from 'react';
import {
	FlatList,
	useColorScheme,
	Linking,
	Pressable,
	ScrollView,
	Share,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import type {Session} from '../../../src/app/types';
import {columnGlyph, columnTint, useChipLook} from '../column-icons';
import {
	ALL_SESSIONS_ID,
	archiveSession,
	hostOf,
	markSessionOpened,
	moveSession,
	removeSession,
	removeSessionTab,
	renameSession,
	restoreSession,
	sessionFolders,
	sessionLinks,
	sessionsIn,
} from '../library';
import {edit, useLibrary} from '../library-store';
import {ActionSheet, type SheetAction} from '../action-sheet';
import {showSnack} from '../snackbar';
import {sessionActionLook} from '../row-actions';
import {SwipeRow} from '../swipe-row';
import {type SessionAction, usePreferences} from '../preferences';
import {linkToOpen, rowText} from '../links';
import {openAll} from '../open-links';
import {PrivateSwitch} from '../private-switch';
import {useBarSpace} from '../tab-bar';
import {soften, TARGET, useColors} from '../theme';
import {useLinkSettings} from '../use-link-settings';
import {useView} from '../view';
import {Button, Card, Chips, Empty, Field, Header, Icon} from '../ui';
import {SiteIcon} from '../site-icon';
import {FolderSheet, RenameSheet} from './session-sheets';
import {SessionColorSheet} from './session-color-sheet';

const PREVIEW_TABS = 4;

// The actions a screen reader offers on a session card, besides the ones a swipe can also run.
const SESSION_MENU: ReadonlyArray<readonly [string, string]> = [
	['expand', 'Show or hide tabs'],
	['open', 'Open all tabs'],
	['color', 'Change color'],
	['rename', 'Rename'],
	['move', 'Move to folder'],
	['archive', 'Archive'],
	['share', 'Share links'],
	['delete', 'Delete'],
	['more', 'More actions'],
];

const shortDate = (time: number) =>
	new Date(time).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	});

const matches = (session: Session, needle: string) =>
	[
		session.name,
		session.description,
		...session.tabs.flatMap((tab) => [tab.title, tab.url]),
	].some((text) => text.toLocaleLowerCase().includes(needle));

/**
A row of small site badges that overlap, as a glance at what a session holds.
*/
function TabPreview({session}: {session: Session}) {
	const colors = useColors();
	const shown = session.tabs.slice(0, PREVIEW_TABS);
	const more = session.tabs.length - shown.length;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={styles.preview}
		>
			{shown.map((tab, index) => (
				<View
					key={tab.id}
					style={[
						styles.badge,
						{
							borderColor: colors.surface,
							marginLeft: index === 0 ? 0 : -6,
						},
					]}
				>
					<SiteIcon host={hostOf(tab.url)} size={22} />
				</View>
			))}
			{more > 0 && (
				<Text style={[styles.more, {color: colors.muted}]}>+{more}</Text>
			)}
		</View>
	);
}

function SessionCardView({
	session,
	folderName,
	tint: folderTint,
	expanded,
	onToggle,
	onAct,
	onRemoveTab,
	onMenu,
}: {
	session: Session;
	folderName: string;
	tint: string;
	expanded: boolean;
	onToggle: (id: string) => void;
	/**
	Runs a session action; missing where the library is read only, which allows only opening and sharing.
	*/
	onAct: (action: SessionAction, session: Session) => void;
	onRemoveTab?: (session: Session, tabId: string) => void;
	onMenu: (session: Session) => void;
}) {
	const colors = useColors();
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	const tint = columnTint(session.color, scheme) ?? folderTint;
	const links = useLinkSettings();
	const prefs = usePreferences();
	const compact = prefs.compactSessions;
	const swipe = (action: SessionAction) =>
		action === 'none'
			? undefined
			: {
					...sessionActionLook(action, colors),
					onTrigger() {
						onAct(action, session);
					},
				};
	const count = `${session.tabs.length} ${session.tabs.length === 1 ? 'tab' : 'tabs'}`;
	return (
		<SwipeRow
			radius={16}
			left={swipe(prefs.sessionSwipeRight)}
			right={swipe(prefs.sessionSwipeLeft)}
		>
			<Card flush>
				<View style={styles.head}>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{expanded}}
						accessibilityLabel={`${session.name}, ${count}, ${folderName}${session.deviceName ? `, saved on ${session.deviceName}` : ''}`}
						android_ripple={{color: colors.pressed}}
						style={styles.headMain}
						accessibilityActions={SESSION_MENU.map(([name, label]) => ({
							name,
							label,
						}))}
						onAccessibilityAction={(event) => {
							const name = event.nativeEvent.actionName;
							if (name === 'expand') {
								onToggle(session.id);
							} else if (name === 'more') {
								onMenu(session);
							} else {
								onAct(name as SessionAction, session);
							}
						}}
						onLongPress={() => {
							onMenu(session);
						}}
						onPress={() => {
							if (prefs.sessionTap === 'open') {
								onAct('open', session);
							} else {
								onToggle(session.id);
							}
						}}
					>
						<View style={[styles.tile, {backgroundColor: soften(tint)}]}>
							<Icon name="albums" size={22} color={tint} />
						</View>
						<View style={styles.texts}>
							<Text
								numberOfLines={2}
								style={[styles.name, {color: colors.text}]}
							>
								{session.name}
							</Text>
							<Text numberOfLines={1} style={{color: colors.muted}}>
								{count} · {folderName} · {shortDate(session.updatedAt)}
							</Text>
							{session.deviceName &&
								prefs.showSavedOn &&
								!prefs.compactSessions && (
									<Text numberOfLines={1} style={{color: colors.muted}}>
										Saved on {session.deviceName}
									</Text>
								)}
							{links.showSessionFaviconPreviews && !prefs.compactSessions && (
								<TabPreview session={session} />
							)}
						</View>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{expanded}}
						accessibilityLabel={
							expanded
								? `Hide tabs in ${session.name}`
								: `Show tabs in ${session.name}`
						}
						android_ripple={{color: colors.pressed, radius: 22}}
						style={styles.round}
						onPress={() => {
							onToggle(session.id);
						}}
					>
						<Icon
							name={expanded ? 'chevron-up' : 'chevron-down'}
							color={colors.muted}
						/>
					</Pressable>
				</View>
				{expanded && (
					<View style={[styles.tabs, {borderColor: colors.border}]}>
						{session.tabs.map((tab) => {
							const text = rowText(
								{title: tab.title || tab.url, url: tab.url},
								links,
							);
							return (
								<Pressable
									key={tab.id}
									accessibilityRole="link"
									accessibilityLabel={`${text.main}${text.sub ? `, ${text.sub}` : ''}`}
									accessibilityHint="Opens the link"
									android_ripple={{color: colors.pressed}}
									style={({pressed}) => [
										styles.tab,
										compact && styles.tabCompact,
										{backgroundColor: pressed ? colors.pressed : 'transparent'},
									]}
									accessibilityActions={
										onRemoveTab
											? [{name: 'remove', label: 'Remove from session'}]
											: undefined
									}
									onAccessibilityAction={() => {
										onRemoveTab?.(session, tab.id);
									}}
									onLongPress={
										onRemoveTab
											? () => {
													onRemoveTab(session, tab.id);
												}
											: undefined
									}
									onPress={() => {
										void Linking.openURL(linkToOpen(tab.url, links));
									}}
								>
									<SiteIcon host={hostOf(tab.url)} size={compact ? 24 : 32} />
									<View style={styles.texts}>
										<Text
											numberOfLines={compact ? 1 : 2}
											style={{color: colors.text}}
										>
											{text.main}
										</Text>
										{text.sub !== undefined && !compact && (
											<Text
												numberOfLines={1}
												style={{color: colors.muted, fontSize: 13}}
											>
												{text.sub}
											</Text>
										)}
									</View>
									{tab.pinned && (
										<Icon name="pin" size={15} color={colors.muted} />
									)}
									<Icon name="open-outline" size={18} color={colors.muted} />
								</Pressable>
							);
						})}
						<View style={styles.footer}>
							<View style={styles.footerButton}>
								<Button
									kind="plain"
									label={`Open all ${session.tabs.length}`}
									icon="albums-outline"
									onPress={() => {
										onAct('open', session);
									}}
								/>
							</View>
							<View style={styles.footerButton}>
								<Button
									kind="plain"
									label="Change color"
									icon="color-palette-outline"
									onPress={() => {
										onAct('color', session);
									}}
								/>
							</View>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`More actions for ${session.name}`}
								android_ripple={{color: colors.pressed, radius: 22}}
								style={styles.round}
								onPress={() => {
									onMenu(session);
								}}
							>
								<Icon name="ellipsis-horizontal" color={colors.muted} />
							</Pressable>
						</View>
					</View>
				)}
			</Card>
		</SwipeRow>
	);
}

// Cards re-draw only when their own session, folder, or expanded state changes, not on every keystroke in the search.
const SessionCard = memo(SessionCardView);

/**
Sessions from the browser extension, and ones saved here from a shared list of links. A phone browser cannot list its
own tabs, so there is no capture here.
*/
export function SessionsScreen({onConnect}: {onConnect: () => void}) {
	const colors = useColors();
	const space = useBarSpace();
	const store = useLibrary();
	const links = useLinkSettings();
	const view = useView();
	const chipLook = useChipLook();
	const [picked, setPicked] = useState(ALL_SESSIONS_ID);
	const [query, setQuery] = useState('');
	// The sessions whose state was flipped from the default: opened when the default is collapsed, closed when it is
	// expanded.
	const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
	const expandAll = links.expandSessionsByDefault;
	const [coloringId, setColoringId] = useState<string>();
	const coloring = store.groups.find((session) => session.id === coloringId);
	const [renamingId, setRenamingId] = useState<string>();
	const renaming = store.groups.find((session) => session.id === renamingId);
	const [movingId, setMovingId] = useState<string>();
	const moving = store.groups.find((session) => session.id === movingId);
	const [menuId, setMenuId] = useState<string>();
	const menuFor = store.groups.find((session) => session.id === menuId);
	const readOnly = view === 'private';
	const colorsNow = useColors();

	const folders = useMemo(() => sessionFolders(store), [store]);
	const folderId = folders.some((folder) => folder.id === picked)
		? picked
		: ALL_SESSIONS_ID;
	const needle = query.trim().toLocaleLowerCase();
	const shown = useMemo(() => {
		const inFolder = sessionsIn(store, folderId, links.sessionSort);
		return needle ? inFolder.filter((s) => matches(s, needle)) : inFolder;
	}, [store, folderId, links.sessionSort, needle]);
	const look = useCallback(
		(folder: {id: string; name: string; icon?: string; count: number}) => {
			if (folder.id === ALL_SESSIONS_ID) {
				return {
					...folder,
					glyph: 'albums-outline' as const,
					tint: colors.accent,
				};
			}

			return folder.name.toLocaleLowerCase() === 'archived'
				? {...folder, glyph: 'archive-outline' as const, tint: colors.muted}
				: {...chipLook(folder), glyph: columnGlyph(folder.icon)};
		},
		[chipLook, colors.accent, colors.muted],
	);
	// The name and color of each session's folder, worked out once per library change, not per card per render.
	const folderInfo = useMemo(
		() =>
			new Map(
				store.folders.map((folder) => [
					folder.id,
					{name: folder.name, tint: look({...folder, count: 0}).tint},
				]),
			),
		[store.folders, look],
	);
	const otherTint = useMemo(
		() => look({id: 'other', name: 'Other', count: 0}).tint,
		[look],
	);
	const act = useCallback(
		(action: SessionAction, session: Session) => {
			const changes = new Set<SessionAction>([
				'color',
				'rename',
				'move',
				'archive',
				'delete',
			]);
			if (readOnly && changes.has(action)) {
				showSnack('The private library cannot be changed here');
				return;
			}

			switch (action) {
				case 'open': {
					openAll(
						session.tabs.map((tab) => linkToOpen(tab.url, links)),
						session.name,
					);
					if (!readOnly) {
						void edit((current) =>
							markSessionOpened(current, session.id, Date.now()),
						);
					}

					break;
				}

				case 'color': {
					setColoringId(session.id);
					break;
				}

				case 'rename': {
					setRenamingId(session.id);
					break;
				}

				case 'move': {
					setMovingId(session.id);
					break;
				}

				case 'archive': {
					void edit((current) =>
						archiveSession(current, session.id, Date.now()),
					);
					showSnack(`Archived ${session.name}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								moveSession(current, session.id, session.folderId, Date.now()),
							);
						},
					});
					break;
				}

				case 'share': {
					void Share.share({message: sessionLinks(session)});
					break;
				}

				case 'delete': {
					void edit((current) =>
						removeSession(current, session.id, Date.now()),
					);
					showSnack(`Deleted ${session.name}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								restoreSession(current, session, Date.now()),
							);
						},
					});
					break;
				}

				default:
			}
		},
		[links, readOnly],
	);
	const removeTab = useCallback((session: Session, tabId: string) => {
		if (
			session.tabs.every((candidate) => candidate.id !== tabId) ||
			session.tabs.length < 2
		) {
			showSnack('A session keeps at least one tab. Delete the session instead');
			return;
		}

		void edit((current) =>
			removeSessionTab(current, session.id, tabId, Date.now()),
		);
		showSnack('Removed from the session', {
			label: 'Undo',
			run() {
				void edit((current) =>
					restoreSession(
						current.groups.some((group) => group.id === session.id)
							? removeSession(current, session.id, Date.now())
							: current,
						session,
						Date.now(),
					),
				);
			},
		});
	}, []);
	const openMenu = useCallback((session: Session) => {
		setMenuId(session.id);
	}, []);
	const menu: SheetAction[] = menuFor
		? (readOnly
				? (['open', 'share'] as const)
				: ([
						'open',
						'color',
						'rename',
						'move',
						'archive',
						'share',
						'delete',
					] as const)
			).map((action) => {
				const actionLook = sessionActionLook(action, colorsNow);
				return {
					icon: actionLook.icon,
					label: actionLook.label,
					onPress() {
						act(action, menuFor);
					},
				};
			})
		: [];
	const toggle = useCallback((id: string) => {
		setFlipped((current) => {
			const next = new Set(current);
			if (!next.delete(id)) {
				next.add(id);
			}

			return next;
		});
	}, []);

	if (store.groups.length === 0) {
		return (
			<View style={styles.screen}>
				<Header title="Sessions" right={<PrivateSwitch />} />
				<Empty
					icon="albums-outline"
					title="No sessions yet"
					action={
						<Button
							label="Connect to your server"
							icon="sync-outline"
							onPress={onConnect}
						/>
					}
				>
					Sessions saved in the TabLodge extension appear here once this phone
					is synced with your server. To save one from here, share several links
					from your browser to TabLodge.
				</Empty>
			</View>
		);
	}

	const subtitle = `${folders[0]?.count ?? 0} ${view === 'private' ? 'in the private library, read only' : 'saved'}`;
	return (
		<>
			<FlatList
				removeClippedSubviews
				data={shown}
				extraData={[flipped, expandAll]}
				keyExtractor={(session) => session.id}
				contentContainerStyle={[styles.list, {paddingBottom: space + 8}]}
				keyboardShouldPersistTaps="handled"
				// Long libraries draw only what is on screen, and a little around it.
				initialNumToRender={6}
				windowSize={7}
				maxToRenderPerBatch={6}
				ListHeaderComponent={
					<View>
						<Header
							title="Sessions"
							subtitle={subtitle}
							right={<PrivateSwitch />}
						/>
						<View style={styles.pad}>
							<Field
								label="Search sessions"
								icon="search"
								placeholder="Session name, tab title or address"
								value={query}
								onChangeText={setQuery}
								onClear={() => {
									setQuery('');
								}}
							/>
							<ScrollView horizontal showsHorizontalScrollIndicator={false}>
								<Chips
									items={folders.map((folder) => look(folder))}
									selected={folderId}
									onSelect={setPicked}
								/>
							</ScrollView>
						</View>
					</View>
				}
				ListEmptyComponent={
					<Empty
						icon={needle ? 'search' : 'albums-outline'}
						title={needle ? 'No match' : 'Nothing here'}
					>
						{needle
							? 'No session or tab matches that search.'
							: 'This folder has no sessions.'}
					</Empty>
				}
				ItemSeparatorComponent={Gap}
				renderItem={({item}) => (
					<View style={styles.cardRow}>
						<SessionCard
							session={item}
							folderName={folderInfo.get(item.folderId)?.name ?? 'Other'}
							tint={folderInfo.get(item.folderId)?.tint ?? otherTint}
							expanded={expandAll !== flipped.has(item.id)}
							onToggle={toggle}
							onAct={act}
							onMenu={openMenu}
							onRemoveTab={readOnly ? undefined : removeTab}
						/>
					</View>
				)}
			/>
			<ActionSheet
				visible={menuFor !== undefined}
				title={menuFor?.name ?? 'Session'}
				actions={menu}
				onClose={() => {
					setMenuId(undefined);
				}}
			/>
			<RenameSheet
				session={renaming}
				onSave={(name) => {
					if (renaming) {
						void edit((current) =>
							renameSession(current, renaming.id, name, Date.now()),
						);
					}

					setRenamingId(undefined);
				}}
				onClose={() => {
					setRenamingId(undefined);
				}}
			/>
			<FolderSheet
				session={moving}
				folders={store.folders}
				onPick={(target) => {
					if (moving) {
						void edit((current) =>
							moveSession(current, moving.id, target, Date.now()),
						);
					}
				}}
				onClose={() => {
					setMovingId(undefined);
				}}
			/>
			<SessionColorSheet
				session={coloring}
				onClose={() => {
					setColoringId(undefined);
				}}
			/>
		</>
	);
}

function Gap() {
	return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
	footer: {flexDirection: 'row', gap: 8, padding: 8},
	footerButton: {flex: 1},
	tabCompact: {minHeight: 40, paddingVertical: 4},
	screen: {flex: 1},
	list: {paddingBottom: 24, gap: 8},
	pad: {paddingHorizontal: 16, gap: 12},
	cardRow: {paddingHorizontal: 16},
	gap: {height: 12},
	head: {flexDirection: 'row', alignItems: 'center', paddingRight: 8},
	headMain: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingLeft: 16,
		paddingVertical: 14,
		minHeight: TARGET + 24,
	},
	tile: {
		width: 44,
		height: 44,
		borderRadius: 12,
		alignItems: 'center',
		justifyContent: 'center',
	},
	texts: {flex: 1, gap: 2},
	name: {fontSize: 16, fontWeight: '700'},
	preview: {flexDirection: 'row', alignItems: 'center', paddingTop: 6},
	badge: {borderWidth: 2, borderRadius: 13},
	more: {marginLeft: 6, fontSize: 13, fontWeight: '600'},
	// The round chevron at the end of the header, which shows the tabs.
	round: {
		width: TARGET,
		height: TARGET,
		borderRadius: TARGET / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
	tabs: {borderTopWidth: StyleSheet.hairlineWidth},
	tab: {
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
});
