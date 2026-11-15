import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	FlatList,
	useColorScheme,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {
	Session,
	Settings,
	Store,
} from '../../../../extension/src/shared/types';
import {columnGlyph, columnTint, useChipLook} from '../../ui/column-icons';
import {
	ALL_SESSIONS_ID,
	archiveSession,
	isArchivedSession,
	unarchiveSession,
	canChangeFolder,
	deleteFolder,
	restoreFolder,
	setSessionColor,
	describeSession,
	hostOf,
	markSessionOpened,
	moveSession,
	removeSession,
	removeSessionTab,
	renameSession,
	restoreSession,
	type SessionFolderView,
	sessionFolders,
	sessionsIn,
} from '../../library/library';
import {
	edit,
	refreshStatus,
	syncClient,
	useLibrary,
	useSyncStatus,
} from '../../library/library-store';
import {trashDeleted} from '../../library/trash-store';
import {ActionSheet, type SheetAction} from '../../ui/action-sheet';
import {useBackAction} from '../../ui/back-actions';
import {useSelection} from '../../ui/use-selection';
import {ActionBar} from '../bookmarks/bookmark-parts';
import {showSnack} from '../../ui/snackbar';
import {
	FloatingActions,
	ROOM_FOR_BUTTONS,
	SearchDock,
	useSearch,
} from '../../ui/floating-actions';
import {linkActionLook, sessionActionLook} from '../../library/row-actions';
import {SwipeRow} from '../../ui/swipe-row';
import {
	type LinkAction,
	type SessionAction,
	usePreferences,
} from '../../settings/preferences';
import {linkToOpen, rowText} from '../../library/links';
import {openAll, openLink} from '../../platform/open-links';
import {PrivateSwitch} from '../../private/private-switch';
import {useRoomBelow} from '../../ui/keyboard';
import {useBarSpace} from '../../ui/tab-bar';
import {type Colors, soften, TARGET, useColors} from '../../ui/theme';
import {useLinkSettings} from '../../library/use-link-settings';
import {trackScroll} from '../../ui/scroll-state';
import {useView} from '../../library/view';
import {takeJump, usePendingJump} from '../../library/jump';
import {SearchElsewhere} from '../search-elsewhere';
import {resultCount} from '../../library/search-count';
import {useSettledText} from '../../ui/search-count';
import {
	Button,
	Card,
	Chips,
	Empty,
	Header,
	Icon,
	IconButton,
} from '../../ui/ui';
import {SiteIcon} from '../../ui/site-icon';
import {openShare} from '../transfer/transfer-sheets';
import {FolderEditSheet} from './folder-sheet';
import {
	AddLinksSheet,
	type BookmarkLinks,
	EditLinkSheet,
	SaveAsBookmarksSheet,
} from './session-link-sheets';
import {FolderSheet, MoveSessionsSheet, RenameSheet} from './session-sheets';

const PREVIEW_TABS = 4;

// The actions a screen reader offers on a session card, besides the ones a swipe can also run.
const SESSION_MENU: ReadonlyArray<readonly [string, string]> = [
	['expand', 'Show or hide tabs'],
	['open', 'Open all tabs'],
	['rename', 'Edit details'],
	['share', 'Share'],
	['archive', 'Archive'],
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
	archived,
	tint: folderTint,
	expanded,
	selecting,
	checked,
	onPick,
	onToggle,
	onAct,
	onTabMenu,
	onTabAct,
	onMenu,
}: {
	session: Session;
	folderName: string;
	/**
	The session is in the Archived folder, so its Archive action takes it out instead.
	*/
	archived: boolean;
	tint: string;
	expanded: boolean;
	/**
	Selecting several sessions: a tap picks this one, and the card shows a check instead of its tile.
	*/
	selecting: boolean;
	checked: boolean;
	onPick: (id: string) => void;
	onToggle: (id: string) => void;
	/**
	Runs a session action; missing where the library is read only, which allows only opening and sharing.
	*/
	onAct: (action: SessionAction, session: Session) => void;
	/**
	Opens the menu of one link in the session: edit, add to bookmarks, delete.
	*/
	onTabMenu?: (session: Session, tabId: string) => void;
	/**
	Runs what swiping a link does; missing where the library is read only.
	*/
	onTabAct?: (action: LinkAction, session: Session, tabId: string) => void;
	onMenu: (session: Session) => void;
}) {
	const colors = useColors();
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	const tint = columnTint(session.color, scheme) ?? folderTint;
	const links = useLinkSettings();
	const prefs = usePreferences();
	const isCompact = prefs.compactSessions;
	const main = prefs.sessionMain;
	const mainLook = sessionActionLook(main, colors, archived);
	const swipe = (action: SessionAction) =>
		action === 'none'
			? undefined
			: {
					...sessionActionLook(action, colors, archived),
					onTrigger() {
						onAct(action, session);
					},
				};
	const swipeLink = (action: LinkAction, tabId: string) =>
		action === 'none' || !onTabAct
			? undefined
			: {
					...linkActionLook(action, colors),
					onTrigger() {
						onTabAct(action, session, tabId);
					},
				};
	const chevron = (
		<Icon
			name={expanded ? 'chevron-up' : 'chevron-down'}
			color={colors.muted}
		/>
	);
	const count = `${session.tabs.length} ${session.tabs.length === 1 ? 'tab' : 'tabs'}`;
	return (
		<SwipeRow
			radius={16}
			disabled={selecting}
			left={swipe(prefs.sessionSwipeRight)}
			right={swipe(prefs.sessionSwipeLeft)}
		>
			{(handlers) => (
				<Card flush>
					<View style={styles.head} {...handlers}>
						<Pressable
							accessibilityRole={selecting ? 'checkbox' : 'button'}
							accessibilityState={selecting ? {checked} : {expanded}}
							accessibilityLabel={`${session.name}, ${count}, ${folderName}${session.deviceName ? `, saved on ${session.deviceName}` : ''}`}
							style={({pressed}) => [
								styles.headMain,
								(checked || pressed) && {
									backgroundColor: checked ? colors.accentSoft : colors.pressed,
								},
							]}
							accessibilityActions={SESSION_MENU.map(([name, label]) => ({
								name,
								label: name === 'archive' && archived ? 'Unarchive' : label,
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
								if (selecting) {
									onPick(session.id);
								} else {
									onMenu(session);
								}
							}}
							onPress={() => {
								if (selecting) {
									onPick(session.id);
								} else if (prefs.sessionTap === 'open') {
									onAct('open', session);
								} else {
									onToggle(session.id);
								}
							}}
						>
							{selecting ? (
								<View style={styles.tile}>
									<Icon
										name={checked ? 'checkmark-circle' : 'ellipse-outline'}
										size={28}
										color={checked ? colors.accent : colors.muted}
									/>
								</View>
							) : (
								<View style={[styles.tile, {backgroundColor: soften(tint)}]}>
									<Icon name="albums" size={22} color={tint} />
								</View>
							)}
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
								{session.description !== '' && !prefs.compactSessions && (
									<Text numberOfLines={2} style={{color: colors.muted}}>
										{session.description}
									</Text>
								)}
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
							{!selecting && prefs.sessionTap !== 'open' && chevron}
						</Pressable>
						{!selecting && prefs.sessionTap === 'open' && (
							<Pressable
								accessibilityRole="button"
								accessibilityState={{expanded}}
								accessibilityLabel={
									expanded
										? `Hide tabs in ${session.name}`
										: `Show tabs in ${session.name}`
								}
								style={({pressed}) => [
									styles.round,
									styles.roundEnd,
									pressed && {backgroundColor: colors.pressed},
								]}
								onPress={() => {
									onToggle(session.id);
								}}
							>
								{chevron}
							</Pressable>
						)}
					</View>
					{expanded && !selecting && (
						<View style={[styles.tabs, {borderColor: colors.border}]}>
							{session.tabs.map((tab) => {
								const text = rowText(
									{title: tab.title || tab.url, url: tab.url},
									links,
								);
								return (
									<SwipeRow
										key={tab.id}
										background={colors.surface}
										left={swipeLink(prefs.linkSwipeRight, tab.id)}
										right={swipeLink(prefs.linkSwipeLeft, tab.id)}
									>
										<Pressable
											accessibilityRole="link"
											accessibilityLabel={`${text.main}${text.sub ? `, ${text.sub}` : ''}${tab.notes.trim() ? `, note: ${tab.notes.trim()}` : ''}`}
											accessibilityHint="Opens the link"
											style={({pressed}) => [
												styles.tab,
												isCompact && styles.tabCompact,
												{
													backgroundColor: pressed
														? colors.pressed
														: 'transparent',
												},
											]}
											accessibilityActions={
												onTabMenu
													? [{name: 'menu', label: 'Link menu'}]
													: undefined
											}
											onAccessibilityAction={() => {
												onTabMenu?.(session, tab.id);
											}}
											onLongPress={
												onTabMenu
													? () => {
															onTabMenu(session, tab.id);
														}
													: undefined
											}
											onPress={() => {
												openLink(linkToOpen(tab.url, links));
											}}
										>
											<SiteIcon
												host={hostOf(tab.url)}
												size={isCompact ? 24 : 32}
											/>
											<View style={styles.texts}>
												<Text
													numberOfLines={isCompact ? 1 : 2}
													style={{color: colors.text}}
												>
													{text.main}
												</Text>
												{text.sub !== undefined && !isCompact && (
													<Text
														numberOfLines={1}
														style={{color: colors.muted, fontSize: 13}}
													>
														{text.sub}
													</Text>
												)}
												{tab.notes.trim() !== '' && (
													<Text
														numberOfLines={isCompact ? 1 : 2}
														style={{color: colors.muted, fontSize: 13}}
													>
														{tab.notes.trim()}
													</Text>
												)}
											</View>
											{tab.pinned && (
												<Icon name="pin" size={15} color={colors.muted} />
											)}
											<Icon
												name="open-outline"
												size={18}
												color={colors.muted}
											/>
										</Pressable>
									</SwipeRow>
								);
							})}
							<View style={styles.footer}>
								<View style={styles.footerButton}>
									<Button
										kind="plain"
										label={
											main === 'open'
												? `Open all ${session.tabs.length}`
												: mainLook.label
										}
										icon={mainLook.icon}
										onPress={() => {
											onAct(main, session);
										}}
									/>
								</View>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={`More actions for ${session.name}`}
									style={({pressed}) => [
										styles.round,
										pressed && {backgroundColor: colors.pressed},
									]}
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
			)}
		</SwipeRow>
	);
}

// Cards re-draw only when their own session, folder, or expanded state changes, not on every keystroke in the search.
const SessionCard = memo(SessionCardView);

// Runs one library change per item, in order, on the store it was given.
function applyAll<T>(
	store: Store,
	items: readonly T[],
	step: (current: Store, item: T) => Store,
): Store {
	let next = store;
	for (const item of items) {
		next = step(next, item);
	}

	return next;
}

const NEW_FOLDER_CHIP = 'new-folder';

/**
Sessions from the browser extension, and ones saved here from a shared list of links. A phone browser cannot list its
own tabs, so there is no capture here.
*/
export function SessionsScreen({
	onConnect,
	onAdd,
	onSelecting,
}: {
	onConnect: () => void;
	onAdd: () => void;
	/**
	Told when selecting starts or stops, so the tab bar can step aside for the action bar.
	*/
	onSelecting: (selecting: boolean) => void;
}) {
	const colors = useColors();
	const insets = useSafeAreaInsets();
	const space = useRoomBelow(useBarSpace());
	const store = useLibrary();
	const links = useLinkSettings();
	const view = useView();
	const {connected} = useSyncStatus();
	const [syncing, setSyncing] = useState(false);
	const chipLook = useChipLook();
	const [picked, setPicked] = useState(ALL_SESSIONS_ID);
	const search = useSearch();
	const {query} = search;
	const listRef = useRef<FlatList<Session>>(null);
	const [revealId, setRevealId] = useState<string>();
	const selection = useSelection();
	const [movingSelected, setMovingSelected] = useState(false);
	useBackAction(selection.active, selection.stop);
	useEffect(() => {
		onSelecting(selection.active);
	}, [selection.active, onSelecting]);
	// The sessions whose state was flipped from the default: opened when the default is collapsed, closed when it is
	// expanded.
	const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
	const isExpandAll = links.expandSessionsByDefault;
	const [renamingId, setRenamingId] = useState<string>();
	const renaming = store.groups.find((session) => session.id === renamingId);
	const [movingId, setMovingId] = useState<string>();
	const moving = store.groups.find((session) => session.id === movingId);
	const [menuId, setMenuId] = useState<string>();
	// A link of a session, for its menu from holding it down, and the drawers that menu and the session menu open.
	const [tabMenu, setTabMenu] = useState<{sessionId: string; tabId: string}>();
	const [editingTab, setEditingTab] = useState<{
		session: Session;
		tabId: string;
	}>();
	const [addingToId, setAddingToId] = useState<string>();
	const [bookmarking, setBookmarking] = useState<BookmarkLinks>();
	// The folder whose menu is open, from holding down its chip, and the one being renamed.
	const [folderMenuId, setFolderMenuId] = useState<string>();
	// The folder whose edit drawer is open, or `{}` for a new one.
	const [editingFolder, setEditingFolder] = useState<{id?: string}>();
	const menuFor = store.groups.find((session) => session.id === menuId);
	const colorsNow = useColors();

	const folders = useMemo(() => sessionFolders(store), [store]);
	const folderBeingEdited = store.folders.find(
		(folder) => folder.id === editingFolder?.id,
	);
	const folderMenu = folderMenuId
		? folderMenuFor(folderMenuId, store, folders, {
				sort: links.sessionSort,
				colors: colorsNow,
				edit(id) {
					setEditingFolder({id});
				},
				removed(id) {
					if (picked === id) {
						setPicked(ALL_SESSIONS_ID);
					}
				},
			})
		: undefined;
	const folderId = folders.some((folder) => folder.id === picked)
		? picked
		: ALL_SESSIONS_ID;
	const needle = query.trim().toLocaleLowerCase();
	const shown = useMemo(() => {
		const inFolder = sessionsIn(store, folderId, links.sessionSort);
		return needle ? inFolder.filter((s) => matches(s, needle)) : inFolder;
	}, [store, folderId, links.sessionSort, needle]);
	const searchCount = useSettledText(needle !== '', resultCount(shown.length));
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
			switch (action) {
				case 'open': {
					openAll(
						session.tabs.map((tab) => linkToOpen(tab.url, links)),
						session.name,
					);
					void edit((current) =>
						markSessionOpened(current, session.id, Date.now()),
					);

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
					const was = session.folderId;
					const archived = isArchivedSession(store.folders, session);
					void edit((current) =>
						archived
							? unarchiveSession(current, session.id, Date.now())
							: archiveSession(current, session.id, Date.now()),
					);
					showSnack(`${archived ? 'Unarchived' : 'Archived'} ${session.name}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								moveSession(current, session.id, was, Date.now()),
							);
						},
					});
					break;
				}

				case 'share': {
					openShare({
						title: session.name,
						data: {kind: 'sessions', groups: [session], folders: store.folders},
					});
					break;
				}

				case 'delete': {
					void edit((current) =>
						removeSession(current, session.id, Date.now()),
					);
					void trashDeleted([{kind: 'session', session}]);
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
		[links, store.folders],
	);
	const removeTab = useCallback((session: Session, tabId: string) => {
		if (
			session.tabs.every((candidate) => candidate.id !== tabId) ||
			session.tabs.length < 2
		) {
			showSnack('A session keeps at least one tab. Delete the session instead');
			return;
		}

		const index = session.tabs.findIndex((candidate) => candidate.id === tabId);
		void edit((current) =>
			removeSessionTab(current, session.id, tabId, Date.now()),
		);
		void trashDeleted([
			{
				kind: 'tab',
				tab: session.tabs[index],
				index,
				sessionId: session.id,
				sessionName: session.name,
				folderId: session.folderId,
			},
		]);
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
	const openTabMenu = useCallback((session: Session, tabId: string) => {
		setTabMenu({sessionId: session.id, tabId});
	}, []);
	const runTabAction = useCallback(
		(action: LinkAction, session: Session, tabId: string) => {
			const tab = session.tabs.find((candidate) => candidate.id === tabId);
			if (!tab) {
				return;
			}

			switch (action) {
				case 'open': {
					openLink(linkToOpen(tab.url, links));

					break;
				}

				case 'edit': {
					setEditingTab({session, tabId});

					break;
				}

				case 'bookmark': {
					setBookmarking({
						title: tab.title || tab.url,
						links: [{title: tab.title, url: tab.url}],
					});

					break;
				}

				case 'delete': {
					removeTab(session, tabId);

					break;
				}
				// No default
			}
		},
		[links, removeTab],
	);
	const menuItem = (action: SessionAction, session: Session): SheetAction => {
		const actionLook = sessionActionLook(
			action,
			colorsNow,
			isArchivedSession(store.folders, session),
		);
		return {
			icon: actionLook.icon,
			label: actionLook.label,
			color: actionLook.color,
			destructive: action === 'delete',
			onPress() {
				act(action, session);
			},
		};
	};

	const menu: SheetAction[] = menuFor
		? [
				...(['open', 'rename'] as const).map((action) =>
					menuItem(action, menuFor),
				),
				{
					icon: 'checkbox-outline' as const,
					label: 'Select',
					hint: 'Pick several to open, move, archive or delete',
					onPress() {
						selection.start(menuFor.id);
					},
				},
				{
					icon: 'add-circle-outline' as const,
					label: 'Add links',
					color: colorsNow.accent,
					onPress() {
						setAddingToId(menuFor.id);
					},
				},
				{
					icon: 'bookmark-outline' as const,
					label: 'Save links as bookmarks',
					color: colorsNow.ok,
					onPress() {
						setBookmarking({
							title: menuFor.name,
							links: menuFor.tabs.map((tab) => ({
								title: tab.title,
								url: tab.url,
							})),
						});
					},
				},
				menuItem('share', menuFor),
				...(['archive', 'delete'] as const).map((action) =>
					menuItem(action, menuFor),
				),
			]
		: [];
	const tabMenuSession = store.groups.find(
		(session) => session.id === tabMenu?.sessionId,
	);
	const tabMenuTab = tabMenuSession?.tabs.find(
		(tab) => tab.id === tabMenu?.tabId,
	);
	// What holding a link of a session offers: nothing that removes it unless asked for by name.
	const tabActions: SheetAction[] =
		tabMenuSession && tabMenuTab
			? [
					{
						icon: 'open-outline',
						label: 'Open',
						onPress() {
							openLink(linkToOpen(tabMenuTab.url, links));
						},
					},
					{
						icon: 'create-outline',
						label: 'Edit',
						color: colorsNow.teal,
						onPress() {
							setEditingTab({session: tabMenuSession, tabId: tabMenuTab.id});
						},
					},
					{
						icon: 'bookmark-outline',
						label: 'Add to bookmarks',
						color: colorsNow.ok,
						onPress() {
							setBookmarking({
								title: tabMenuTab.title || tabMenuTab.url,
								links: [{title: tabMenuTab.title, url: tabMenuTab.url}],
							});
						},
					},
					{
						icon: 'trash-outline',
						label: 'Delete',
						destructive: true,
						onPress() {
							removeTab(tabMenuSession, tabMenuTab.id);
						},
					},
				]
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

	// A result of the search on Bookmarks that points at a session: show its folder, open it, and scroll to it.
	const pending = usePendingJump();
	useEffect(() => {
		const jump = takeJump('sessions');
		if (!jump) {
			return;
		}

		search.close();
		setPicked(ALL_SESSIONS_ID);
		setFlipped((current) => {
			const next = new Set(current);
			if (isExpandAll) {
				next.delete(jump.sessionId);
			} else {
				next.add(jump.sessionId);
			}

			return next;
		});
		setRevealId(jump.sessionId);
		// `search` is a fresh object each render; only the jump matters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pending, isExpandAll]);
	useEffect(() => {
		if (revealId === undefined) {
			return;
		}

		const index = shown.findIndex((session) => session.id === revealId);
		if (index !== -1) {
			listRef.current?.scrollToIndex({index, animated: false});
		}

		setRevealId(undefined);
	}, [revealId, shown]);

	if (store.groups.length === 0) {
		return (
			<View style={styles.screen}>
				<Header title="Sessions" right={<PrivateSwitch />} />
				<Empty
					icon="albums-outline"
					title="No sessions yet"
					action={
						view === 'private' ? undefined : connected ? (
							<Button
								label="Sync now"
								icon="sync-outline"
								loading={syncing}
								onPress={() => {
									setSyncing(true);
									void syncClient
										.syncNow()
										.catch(() => undefined)
										.then(refreshStatus)
										.finally(() => {
											setSyncing(false);
										});
								}}
							/>
						) : (
							<Button
								label="Connect to your server"
								icon="sync-outline"
								onPress={onConnect}
							/>
						)
					}
				>
					{view === 'private'
						? 'Nothing is saved in the private library yet. Choose Private when you save a link.'
						: connected
							? 'This phone is connected to your server, but the library has no sessions yet. Sessions saved in the TabLodge extension appear here after they sync. To save one from here, share several links from your browser to TabLodge.'
							: 'Sessions saved in the TabLodge extension appear here once this phone is synced with your server. To save one from here, share several links from your browser to TabLodge.'}
				</Empty>
				<FloatingActions bottom={space} buttonLabel="Add links" onAdd={onAdd} />
			</View>
		);
	}

	const chosen = shown.filter((session) => selection.ids.has(session.id));
	const isAllSelected = shown.length > 0 && chosen.length === shown.length;
	const allArchived = chosen.every((session) =>
		isArchivedSession(store.folders, session),
	);
	const plural = (count: number) =>
		`${count} ${count === 1 ? 'session' : 'sessions'}`;
	const deleteChosen = () => {
		const gone = chosen;
		if (gone.length === 0) {
			return;
		}

		void edit((current) =>
			applyAll(current, gone, (next, session) =>
				removeSession(next, session.id, Date.now()),
			),
		);
		void trashDeleted(gone.map((session) => ({kind: 'session', session})));
		selection.stop();
		showSnack(`Deleted ${plural(gone.length)}`, {
			label: 'Undo',
			run() {
				void edit((current) =>
					applyAll(current, gone, (next, session) =>
						restoreSession(next, session, Date.now()),
					),
				);
			},
		});
	};

	// Sessions in the Archived folder come out of it when the whole selection is archived already, and go in otherwise.
	const archiveChosen = () => {
		// The button is off while nothing is picked.
		void edit((current) =>
			applyAll(current, chosen, (next, session) =>
				allArchived
					? unarchiveSession(next, session.id, Date.now())
					: archiveSession(next, session.id, Date.now()),
			),
		);
		selection.stop();
		showSnack(
			`${allArchived ? 'Unarchived' : 'Archived'} ${plural(chosen.length)}`,
			{
				label: 'Undo',
				run() {
					void edit((current) =>
						applyAll(current, chosen, (next, session) =>
							moveSession(next, session.id, session.folderId, Date.now()),
						),
					);
				},
			},
		);
	};

	const subtitle =
		searchCount ??
		`${folders[0]?.count ?? 0} ${view === 'private' ? 'in the private library' : 'saved'}`;
	return (
		<>
			<FlatList
				ref={listRef}
				removeClippedSubviews
				scrollEventThrottle={16}
				data={shown}
				extraData={[flipped, isExpandAll, selection.ids, selection.active]}
				keyExtractor={(session) => session.id}
				contentContainerStyle={[
					styles.list,
					{
						paddingBottom: selection.active
							? 72 + insets.bottom
							: space + 8 + ROOM_FOR_BUTTONS,
					},
				]}
				keyboardShouldPersistTaps="handled"
				// Long libraries draw only what is on screen, and a little around it.
				initialNumToRender={6}
				windowSize={7}
				maxToRenderPerBatch={6}
				ListHeaderComponent={
					<View>
						<Header
							title="Sessions"
							live={searchCount !== undefined && shown.length > 0}
							subtitle={
								selection.active ? `${chosen.length} selected` : subtitle
							}
							right={
								selection.active ? (
									<>
										<IconButton
											icon={
												isAllSelected
													? 'remove-circle-outline'
													: 'checkmark-done'
											}
											label={isAllSelected ? 'Select none' : 'Select all'}
											onPress={() => {
												selection.setAll(
													isAllSelected
														? []
														: shown.map((session) => session.id),
												);
											}}
										/>
										<IconButton
											icon="close"
											label="Done selecting"
											onPress={selection.stop}
										/>
									</>
								) : (
									<PrivateSwitch />
								)
							}
						/>
						<View style={styles.pad}>
							<ScrollView horizontal showsHorizontalScrollIndicator={false}>
								<Chips
									items={[
										...folders.map((folder) => look(folder)),
										{
											id: NEW_FOLDER_CHIP,
											name: 'New folder',
											glyph: 'add' as const,
											tint: colors.accent,
										},
									]}
									selected={folderId}
									onSelect={(id) => {
										if (id === NEW_FOLDER_CHIP) {
											setEditingFolder({});
										} else {
											setPicked(id);
										}
									}}
									onLongPress={(id) => {
										if (id !== NEW_FOLDER_CHIP) {
											setFolderMenuId(id);
										}
									}}
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
				ListFooterComponent={
					<SearchElsewhere
						store={store}
						query={query}
						here="sessions"
						localCount={shown.length}
						onJump={search.close}
					/>
				}
				ItemSeparatorComponent={Gap}
				renderItem={({item}) => (
					<View style={styles.cardRow}>
						<SessionCard
							session={item}
							folderName={folderInfo.get(item.folderId)?.name ?? 'Other'}
							archived={isArchivedSession(store.folders, item)}
							tint={folderInfo.get(item.folderId)?.tint ?? otherTint}
							expanded={isExpandAll !== flipped.has(item.id)}
							selecting={selection.active}
							checked={selection.ids.has(item.id)}
							onPick={selection.toggle}
							onToggle={toggle}
							onAct={act}
							onMenu={openMenu}
							onTabMenu={openTabMenu}
							onTabAct={runTabAction}
						/>
					</View>
				)}
				onScrollToIndexFailed={({index, averageItemLength}) => {
					listRef.current?.scrollToOffset({
						offset: index * averageItemLength,
						animated: false,
					});
				}}
				onScroll={trackScroll}
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
				title="Edit details"
				description={renaming?.description ?? ''}
				color={renaming?.color ?? ''}
				folders={store.folders}
				folderId={renaming?.folderId}
				onSave={(name, description, color, chosenFolderId) => {
					if (renaming) {
						void edit((current) => {
							const renamed = describeSession(
								renameSession(current, renaming.id, name, Date.now()),
								renaming.id,
								description ?? '',
								Date.now(),
							);
							// Moved first, so a color chosen in the same save wins over the folder's.
							const moved =
								chosenFolderId && chosenFolderId !== renaming.folderId
									? moveSession(
											renamed,
											renaming.id,
											chosenFolderId,
											Date.now(),
										)
									: renamed;
							return setSessionColor(
								moved,
								renaming.id,
								color ?? '',
								Date.now(),
							);
						});
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
			<ActionSheet
				visible={folderMenu !== undefined}
				title={folderMenu?.title ?? ''}
				actions={folderMenu?.actions ?? []}
				onClose={() => {
					setFolderMenuId(undefined);
				}}
			/>
			<ActionSheet
				visible={tabMenuTab !== undefined}
				title={tabMenuTab?.title || tabMenuTab?.url || ''}
				actions={tabActions}
				onClose={() => {
					setTabMenu(undefined);
				}}
			/>
			<EditLinkSheet
				target={editingTab}
				onClose={() => {
					setEditingTab(undefined);
				}}
			/>
			<AddLinksSheet
				session={store.groups.find((session) => session.id === addingToId)}
				onClose={() => {
					setAddingToId(undefined);
				}}
			/>
			<SaveAsBookmarksSheet
				target={bookmarking}
				onClose={() => {
					setBookmarking(undefined);
				}}
			/>
			{selection.active && (
				<ActionBar
					actions={[
						{
							icon: 'albums-outline',
							label: 'Open',
							disabled: chosen.length === 0,
							onPress() {
								openAll(
									chosen.flatMap((session) =>
										session.tabs.map((tab) => linkToOpen(tab.url, links)),
									),
									plural(chosen.length),
								);
							},
						},
						{
							icon: 'share-outline',
							label: 'Share',
							disabled: chosen.length === 0,
							onPress() {
								openShare({
									title: plural(chosen.length),
									data: {
										kind: 'sessions',
										groups: chosen,
										folders: store.folders,
									},
								});
							},
						},
						{
							icon: 'folder-open-outline',
							label: 'Move',
							disabled: chosen.length === 0 || store.folders.length < 2,
							onPress() {
								setMovingSelected(true);
							},
						},
						{
							icon: allArchived ? 'arrow-undo-outline' : 'archive-outline',
							label: allArchived ? 'Unarchive' : 'Archive',
							color: colors.warn,
							disabled: chosen.length === 0,
							onPress: archiveChosen,
						},
						{
							icon: 'trash-outline',
							label: 'Delete',
							color: colors.danger,
							disabled: chosen.length === 0,
							onPress: deleteChosen,
						},
					]}
				/>
			)}
			<MoveSessionsSheet
				visible={movingSelected}
				count={chosen.length}
				folders={store.folders}
				onPick={(target) => {
					const ids = chosen.map((session) => session.id);
					const was = new Map(
						chosen.map((session) => [session.id, session.folderId]),
					);
					void edit((current) =>
						applyAll(current, ids, (next, id) =>
							moveSession(next, id, target, Date.now()),
						),
					);
					selection.stop();
					showSnack(`Moved ${plural(ids.length)}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								applyAll(current, ids, (next, id) =>
									moveSession(next, id, was.get(id) ?? target, Date.now()),
								),
							);
						},
					});
				}}
				onClose={() => {
					setMovingSelected(false);
				}}
			/>
			<FolderEditSheet
				visible={editingFolder !== undefined}
				folder={folderBeingEdited}
				onClose={(id) => {
					setEditingFolder(undefined);
					if (id) {
						setPicked(id);
					}
				}}
			/>
			{!search.open && !selection.active && (
				<FloatingActions
					bottom={space}
					buttonLabel="Add links"
					onAdd={onAdd}
					onSearch={search.show}
				/>
			)}
			{search.open && (
				<SearchDock
					label="Search sessions"
					placeholder="Session name, tab title or address"
					bottom={space}
					query={query}
					onChange={search.setQuery}
					onClose={search.close}
				/>
			)}
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
	head: {flexDirection: 'row', alignItems: 'center'},
	headMain: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingHorizontal: 16,
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
	roundEnd: {marginRight: 8},
	tabs: {borderTopWidth: StyleSheet.hairlineWidth},
	tab: {
		borderRadius: 12,
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
});

/**
The menu for one folder chip: sharing its links, and for a folder that can change, renaming and deleting it. Sessions of
a deleted folder move to Unfiled.
*/
function folderMenuFor(
	id: string,
	store: Store,
	folders: SessionFolderView[],
	{
		sort,
		colors,
		edit: editFolder,
		removed,
	}: {
		sort: Settings['sessionSort'];
		colors: Colors;
		edit: (id: string) => void;
		removed: (id: string) => void;
	},
): {title: string; actions: SheetAction[]} | undefined {
	const view = folders.find((folder) => folder.id === id);
	if (!view) {
		return undefined;
	}

	const sessions = sessionsIn(store, id, sort);
	const folder = store.folders.find((entry) => entry.id === id);
	const actions: SheetAction[] = [];
	actions.push({
		icon: 'share-outline',
		label: 'Share',
		onPress() {
			openShare({
				title: view.name,
				data: {kind: 'sessions', groups: sessions, folders: store.folders},
			});
		},
	});

	if (folder && canChangeFolder(folder)) {
		actions.push(
			{
				icon: 'create-outline',
				label: 'Edit folder',
				color: colors.teal,
				hint: 'Rename it, or change its icon and color',
				onPress() {
					editFolder(id);
				},
			},
			{
				icon: 'trash-outline',
				label: 'Delete folder',
				destructive: true,
				onPress() {
					const held = sessions.map((session) => session.id);
					void edit((current) => deleteFolder(current, id, Date.now()));
					void trashDeleted([{kind: 'folder', folder, sessionIds: held}]);
					removed(id);
					showSnack(`Deleted ${folder.name}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								restoreFolder(current, folder, held, Date.now()),
							);
						},
					});
				},
			},
		);
	}

	return {title: view.name, actions};
}
