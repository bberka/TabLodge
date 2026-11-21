import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Animated, FlatList, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SyncProblemBanner} from '../../ui/sync-problem-banner';
import type {Session} from '../../../../extension/src/shared/types';
import {GlassTarget} from '../../ui/glass';
import {
	ALL_SESSIONS_ID,
	isArchivedSession,
	moveSession,
	sessionFolders,
	sessionsIn,
	searchSessions,
} from '../../library/session-edits';
import {edit, useLibrary, useSyncStatus} from '../../library/library-store';
import {ActionSheet, type SheetAction} from '../../ui/action-sheet';
import {useBackAction} from '../../ui/back-actions';
import {useSelection} from '../../ui/use-selection';
import {
	FloatingActions,
	ROOM_FOR_BUTTONS,
	SearchDock,
	useSearch,
} from '../../ui/floating-actions';
import {
	type LinkAction,
	type SessionAction,
	usePreferences,
} from '../../settings/preferences';
import {useCrossfade} from '../../ui/motion';
import {PrivateSwitch} from '../../private/private-switch';
import {useRoomBelow} from '../../ui/keyboard';
import {useBarSpace} from '../../ui/tab-bar';
import {useColors} from '../../ui/theme';
import {useLinkSettings} from '../../library/use-link-settings';
import {trackScroll} from '../../ui/scroll-state';
import {useView} from '../../library/view';
import {useRefresh} from '../../library/use-refresh';
import {takeJump, usePendingJump} from '../../library/jump';
import {FolderBack, FolderList} from '../../ui/folder-list';
import {SearchElsewhere} from '../search-elsewhere';
import {SearchTipsSheet} from '../search-tips';
import {resultCount} from '../../library/search-count';
import {useSettledText} from '../../ui/search-count';
import {Empty, Header, IconButton} from '../../ui/widgets';
import {copyActions, withCopyActions} from '../copy/copy-actions';
import {useCopyUrls} from '../../library/page-copies';
import {useSharedPagesAction} from '../settings/shared-pages-settings';
import {FolderEditSheet} from './folder-sheet';
import {FolderChips, folderMenuFor, useFolderLook} from './folder-chips';
import {
	AddLinksSheet,
	type BookmarkLinks,
	EditLinkSheet,
	SaveAsBookmarksSheet,
} from './session-link-sheets';
import {FolderSheet, RenameSheet} from './session-sheets';
import {SessionCard} from './session-card';
import {
	runSessionAction,
	runTabAction,
	sessionMenuActions,
	tabMenuActions,
} from './session-actions';
import {saveSessionDetails, selectionOf} from './session-changes';
import {SessionSelectionBar} from './session-selection-bar';
import {SessionsEmpty} from './sessions-empty';

/**
Sessions from the browser extension, and ones saved here from a shared list of links. A phone browser cannot list its
own tabs, so there is no capture here.
*/
export function SessionsScreen({
	onConnect,
	onOpenSettings,
	onAdd,
	onSelecting,
}: {
	onConnect: () => void;
	onOpenSettings: () => void;
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
	const sharedPagesAction = useSharedPagesAction();
	const links = useLinkSettings();
	const view = useView();
	const copyUrls = useCopyUrls();
	const {connected} = useSyncStatus();
	const {refreshing, refresh} = useRefresh();
	const [picked, setPicked] = useState(ALL_SESSIONS_ID);
	// In the list view, whether a folder is open, as opposed to the list of every folder.
	const [inside, setInside] = useState(false);
	const isListView = usePreferences().sessionView === 'list';
	const search = useSearch();
	const [tipsOpen, setTipsOpen] = useState(false);
	const {query} = search;
	const listRef = useRef<FlatList<Session>>(null);
	const [revealId, setRevealId] = useState<string>();
	const selection = useSelection();
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
	// The 3 dot menu in the header, for the folder on screen.
	const [moreOpen, setMoreOpen] = useState(false);
	const menuFor = store.groups.find((session) => session.id === menuId);

	const folders = useMemo(() => sessionFolders(store), [store]);
	const folderBeingEdited = store.folders.find(
		(folder) => folder.id === editingFolder?.id,
	);
	const folderMenuOptions = {
		sort: links.sessionSort,
		colors,
		edit(id: string) {
			setEditingFolder({id});
		},
		removed(id: string) {
			if (picked !== id) {
				return;
			}

			setPicked(ALL_SESSIONS_ID);
			setInside(false);
		},
	};
	const folderMenu = folderMenuId
		? folderMenuFor(folderMenuId, store, folders, folderMenuOptions)
		: undefined;
	const folderId = folders.some((folder) => folder.id === picked)
		? picked
		: ALL_SESSIONS_ID;
	const needle = query.trim().toLocaleLowerCase();
	// The list view starts on the list of folders; a search looks through every session instead.
	const atList = isListView && !inside && needle === '';
	const fade = useCrossfade(atList);
	const scopeId = isListView && !inside ? ALL_SESSIONS_ID : folderId;
	useBackAction(isListView && inside && needle === '', () => {
		setInside(false);
	});
	const shown = useMemo(() => {
		if (atList) {
			return [];
		}

		const inFolder = sessionsIn(store, scopeId, links.sessionSort);
		return needle ? searchSessions(inFolder, query, store.folders) : inFolder;
	}, [store, scopeId, links.sessionSort, needle, query, atList]);
	const moreMenu = moreOpen
		? folderMenuFor(folderId, store, folders, folderMenuOptions)
		: undefined;
	const moreActions: SheetAction[] = [
		...(moreMenu?.actions ?? []),
		...(shown.length > 0
			? [
					{
						icon: 'checkbox-outline' as const,
						label: 'Select sessions',
						hint: 'Move, archive, share or delete several at once',
						onPress() {
							selection.start();
						},
					},
				]
			: []),
		{
			icon: 'add' as const,
			label: 'New folder',
			onPress() {
				setEditingFolder({});
			},
		},
		...sharedPagesAction,
	];
	const searchCount = useSettledText(needle !== '', resultCount(shown.length));
	const look = useFolderLook();
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
			runSessionAction(action, session, {
				folders: store.folders,
				links,
				rename: setRenamingId,
				move: setMovingId,
			});
		},
		[links, store.folders],
	);
	const openMenu = useCallback((session: Session) => {
		setMenuId(session.id);
	}, []);
	const openTabMenu = useCallback((session: Session, tabId: string) => {
		setTabMenu({sessionId: session.id, tabId});
	}, []);
	const runTabActionOn = useCallback(
		(action: LinkAction, session: Session, tabId: string) => {
			runTabAction(action, session, tabId, {
				links,
				edit: setEditingTab,
				bookmark: setBookmarking,
			});
		},
		[links],
	);
	const menu = menuFor
		? sessionMenuActions(menuFor, {
				colors,
				folders: store.folders,
				links,
				act,
				select: selection.start,
				addLinks: setAddingToId,
				bookmark: setBookmarking,
			})
		: [];
	const tabMenuSession = store.groups.find(
		(session) => session.id === tabMenu?.sessionId,
	);
	const tabMenuTab = tabMenuSession?.tabs.find(
		(tab) => tab.id === tabMenu?.tabId,
	);
	const tabActions =
		tabMenuSession && tabMenuTab
			? withCopyActions(
					tabMenuActions(tabMenuSession, tabMenuTab, {
						colors,
						links,
						edit: setEditingTab,
						bookmark: setBookmarking,
					}),
					copyActions(tabMenuTab.url, {
						colors,
						hasCopy: copyUrls.has(tabMenuTab.url),
						isPrivate: view === 'private',
					}),
				)
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
		setInside(true);
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
			<SessionsEmpty
				connected={connected}
				isPrivate={view === 'private'}
				space={space}
				onConnect={onConnect}
				onAdd={onAdd}
			/>
		);
	}

	const {chosen, isAllSelected, allArchived} = selectionOf(
		shown,
		selection.ids,
		store.folders,
	);

	const entries = folders.map((folder) => {
		const {glyph, tint} = look(folder);
		return {id: folder.id, name: folder.name, count: folder.count, glyph, tint};
	});
	const openEntry = entries.find((entry) => entry.id === folderId);
	const openFolder = (id: string) => {
		setPicked(id);
		setInside(true);
	};

	const subtitle =
		searchCount ??
		`${folders[0]?.count ?? 0} ${view === 'private' ? 'in the private library' : 'saved'}`;
	return (
		<>
			<GlassTarget>
				<Animated.View style={[styles.fill, {opacity: fade}]}>
					<FlatList
						ref={listRef}
						removeClippedSubviews
						scrollEventThrottle={16}
						refreshing={refreshing}
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
							<View style={styles.head}>
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
											<>
												<PrivateSwitch />
												{!atList && (
													<IconButton
														icon="ellipsis-horizontal"
														label="More actions"
														onPress={() => {
															setMoreOpen(true);
														}}
													/>
												)}
											</>
										)
									}
								/>
								<SyncProblemBanner onOpenSettings={onOpenSettings} />
								{isListView ? (
									<View style={styles.folders}>
										{atList && (
											<FolderList
												entries={entries}
												noun="session"
												newLabel="New folder"
												onOpen={openFolder}
												onNew={() => {
													setEditingFolder({});
												}}
												onMenu={setFolderMenuId}
											/>
										)}
										{inside && needle === '' && openEntry && (
											<FolderBack
												entry={openEntry}
												noun="session"
												label="All folders"
												onBack={() => {
													setInside(false);
												}}
												onMenu={() => {
													setFolderMenuId(openEntry.id);
												}}
											/>
										)}
									</View>
								) : (
									<FolderChips
										folders={folders}
										selected={folderId}
										onSelect={setPicked}
										onNewFolder={() => {
											setEditingFolder({});
										}}
										onMenu={setFolderMenuId}
									/>
								)}
							</View>
						}
						ListEmptyComponent={
							atList ? undefined : (
								<Empty
									icon={needle ? 'search' : 'albums-outline'}
									title={needle ? 'No match' : 'Nothing here'}
								>
									{needle
										? 'No session or tab matches that search.'
										: 'This folder has no sessions.'}
								</Empty>
							)
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
									onTabAct={runTabActionOn}
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
						onRefresh={() => {
							void refresh();
						}}
					/>
				</Animated.View>
			</GlassTarget>
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
						void edit((current) =>
							saveSessionDetails(
								current,
								renaming,
								{name, description, color, folderId: chosenFolderId},
								Date.now,
							),
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
			<ActionSheet
				visible={moreOpen}
				title={moreMenu?.title ?? ''}
				actions={moreActions}
				onClose={() => {
					setMoreOpen(false);
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
			<SessionSelectionBar
				active={selection.active}
				chosen={chosen}
				allArchived={allArchived}
				folders={store.folders}
				links={links}
				stop={selection.stop}
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
					onTips={() => {
						setTipsOpen(true);
					}}
				/>
			)}
			<SearchTipsSheet
				visible={tipsOpen}
				onClose={() => {
					setTipsOpen(false);
				}}
			/>
		</>
	);
}

function Gap() {
	return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
	list: {paddingBottom: 24, gap: 8},
	cardRow: {paddingHorizontal: 16},
	gap: {height: 12},
	// Same spacing under the header as the Bookmarks screen, so the chips sit at the same height on both.
	head: {gap: 8},
	folders: {paddingHorizontal: 16, paddingBottom: 8},
	fill: {flex: 1},
});
