import {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, FlatList, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark} from '../../../../extension/src/shared/types';
import {ActionSheet, type SheetAction} from '../../ui/action-sheet';
import {GlassTarget} from '../../ui/glass';
import {useBackAction} from '../../ui/back-actions';
import {
	findDuplicateBookmarks,
	removalIds,
} from '../../../../extension/src/shared/duplicate-bookmarks';
import {notify} from '../../ui/dialog';
import {useChipLook} from '../../ui/column-icons';
import {FolderBack, FolderList, type FolderEntry} from '../../ui/folder-list';
import {usePreferences} from '../../settings/preferences';
import {useCrossfade} from '../../ui/motion';
import {
	ALL_BOOKMARKS_ID,
	allBookmarks,
	bookmarksIn,
	moveBookmark,
	type BookmarkMove,
	columnViews,
	moveBookmarks,
	moveColumn,
	removeBookmarks,
	removedBookmarks,
	restoreBookmarks,
	searchBookmarks,
} from '../../library/board-edits';
import {
	edit,
	newId,
	setSyncedSetting,
	useLibrary,
	useSyncStatus,
} from '../../library/library-store';
import {trashDeleted} from '../../library/trash-store';
import {linkToOpen} from '../../library/links';
import {openAll, openLink} from '../../platform/open-links';
import {useLinkSettings} from '../../library/use-link-settings';
import {showSnack} from '../../ui/snackbar';
import {useRoomBelow} from '../../ui/keyboard';
import {useBarSpace} from '../../ui/tab-bar';
import {useColors} from '../../ui/theme';
import {PrivateSwitch} from '../../private/private-switch';
import {useRefresh} from '../../library/use-refresh';
import {useSelection} from '../../ui/use-selection';
import {trackScroll} from '../../ui/scroll-state';
import {useView} from '../../library/view';
import {takeJump, usePendingJump} from '../../library/jump';
import {SearchElsewhere} from '../search-elsewhere';
import {resultCount} from '../../library/search-count';
import {useSettledText} from '../../ui/search-count';
import {
	FloatingActions,
	ROOM_FOR_BUTTONS,
	SearchDock,
	useSearch,
} from '../../ui/floating-actions';
import {Button, Chips, Empty, Header, IconButton} from '../../ui/widgets';
import {openShare} from '../transfer/transfer-sheets';
import {useDragSelect} from './use-drag-select';
import {confirmDeleteColumn, ColumnSheet} from './column-sheet';
import {ColumnsSheet} from './columns-sheet';
import {ReorderRow} from './reorder-row';
import {
	BookmarkRow,
	EditSheet,
	MoveSheet,
	SelectionBar,
} from './bookmark-parts';

// The last chip: choosing it opens the form for a new column instead of showing one.
const NEW_COLUMN_CHIP = '__new-column__';

/**
The drawer that is open over the list, if any: one bookmark's edit form, the choice of a column to move to, or the form
for making or changing a column.
*/
type Sheet =
	| {kind: 'edit'; bookmark: Bookmark}
	| {kind: 'move'}
	| {kind: 'column'; id?: string};

export function BookmarksScreen({
	onAdd,
	onConnect,
	onSelecting,
}: {
	onAdd: () => void;
	onConnect: () => void;
	onSelecting: (selecting: boolean) => void;
}) {
	const colors = useColors();
	const chipLook = useChipLook();
	const insets = useSafeAreaInsets();
	const barSpace = useBarSpace();
	const space = useRoomBelow(barSpace);
	const isKeyboardOpen = space !== barSpace;
	const store = useLibrary();
	const selection = useSelection();
	const view = useView();
	const {connected} = useSyncStatus();
	const links = useLinkSettings();
	const [picked, setPicked] = useState('');
	// In the list view, whether a column is open, as opposed to the list of every column.
	const [inside, setInside] = useState(false);
	const isListView = usePreferences().bookmarkView === 'list';
	const search = useSearch();
	const {query} = search;
	const {refreshing, refresh} = useRefresh();
	const listRef = useRef<FlatList<Bookmark>>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	// The bookmark whose menu is open, from holding down its row.
	const [rowMenuId, setRowMenuId] = useState<string>();
	const [columnsOpen, setColumnsOpen] = useState(false);
	// While true, rows show buttons that move them instead of opening them.
	const [reordering, setReordering] = useState(false);
	// The drawer for choosing a column to move the selection to.
	// The bookmark whose edit drawer is open.
	const [sheet, setSheet] = useState<Sheet>();
	const editing = sheet?.kind === 'edit' ? sheet.bookmark : undefined;
	const isMoving = sheet?.kind === 'move';
	const editingColumn =
		sheet?.kind === 'column'
			? store.bookmarkColumns.find((column) => column.id === sheet.id)
			: undefined;

	useBackAction(selection.active, selection.stop);
	useBackAction(reordering, () => {
		setReordering(false);
	});

	useEffect(() => {
		onSelecting(selection.active);
	}, [selection.active, onSelecting]);

	const columns = useMemo(
		() =>
			columnViews(store).map((column) => ({
				...column,
				count: bookmarksIn(store, column.id).length,
			})),
		[store],
	);
	// The All column is the first and the default unless it is turned off. A column that no longer exists falls back
	// to it, or to the first column when it is off.
	const showAll = links.showAllBookmarks;
	const hasPicked = columns.some((column) => column.id === picked);
	const columnId =
		showAll && (picked === ALL_BOOKMARKS_ID || !hasPicked)
			? ALL_BOOKMARKS_ID
			: hasPicked
				? picked
				: (columns[0]?.id ?? '');
	// A result of the search on Sessions that points at a column: show that column.
	const pending = usePendingJump();
	useEffect(() => {
		const jump = takeJump('bookmarks');
		if (!jump) {
			return;
		}

		search.close();
		setPicked(jump.columnId);
		setInside(true);
		// `search` is a fresh object each render; only the jump matters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pending]);
	const isSearching = query.trim().length > 0;
	// The list view starts on the list of columns; a search shows its results instead.
	const atList = isListView && !inside && !isSearching;
	const fade = useCrossfade(atList);
	useBackAction(isListView && inside && !isSearching, () => {
		setInside(false);
	});
	const shown = useMemo(
		() =>
			isSearching
				? searchBookmarks(store, query)
				: atList
					? []
					: columnId === ALL_BOOKMARKS_ID
						? allBookmarks(store)
						: bookmarksIn(store, columnId),
		[store, query, columnId, isSearching, atList],
	);
	const searchCount = useSettledText(isSearching, resultCount(shown.length));
	const columnName =
		columnId === ALL_BOOKMARKS_ID
			? 'All'
			: columns.find((column) => column.id === columnId)?.name;
	// The Unfiled bucket is not a column of its own and cannot be changed.
	const isEditableColumn =
		!atList && store.bookmarkColumns.some((column) => column.id === columnId);
	const columnIndex = atList
		? -1
		: store.bookmarkColumns.findIndex((column) => column.id === columnId);
	const isAllSelected = shown.length > 0 && selection.ids.size === shown.length;
	const rowMenuBookmark = store.bookmarks.find(
		(bookmark) => bookmark.id === rowMenuId,
	);
	// What holding a row offers: what the swipes and the menu offer, for that one bookmark.
	const rowActions: SheetAction[] = rowMenuBookmark
		? [
				{
					icon: 'open-outline',
					label: 'Open',
					onPress() {
						openLink(linkToOpen(rowMenuBookmark.url, links));
					},
				},
				{
					icon: 'create-outline',
					label: 'Edit',
					color: colors.teal,
					hint: 'Its link, title, and column',
					onPress() {
						setSheet({kind: 'edit', bookmark: rowMenuBookmark});
					},
				},
				...(store.bookmarkColumns.length > 1
					? [
							{
								icon: 'folder-open-outline' as const,
								label: 'Move to column',
								color: colors.ok,
								onPress() {
									selection.start(rowMenuBookmark.id);
									setSheet({kind: 'move'});
								},
							},
						]
					: []),
				{
					icon: 'checkbox-outline',
					label: 'Select',
					hint: 'Pick several to open, move or delete',
					onPress() {
						selection.start(rowMenuBookmark.id);
					},
				},
				{
					icon: 'download-outline',
					label: 'Share',
					color: colors.info,
					onPress() {
						openShare({
							title: rowMenuBookmark.title || rowMenuBookmark.url,
							data: {
								kind: 'bookmarks',
								columns: store.bookmarkColumns.filter(
									(column) => column.id === rowMenuBookmark.columnId,
								),
								bookmarks: [rowMenuBookmark],
							},
						});
					},
				},
				{
					icon: 'trash-outline',
					label: 'Delete',
					destructive: true,
					onPress() {
						remove(new Set([rowMenuBookmark.id]));
					},
				},
			]
		: [];

	const remove = (ids: ReadonlySet<string>) => {
		const gone = removedBookmarks(store, ids);
		if (gone.length === 0) {
			return;
		}

		void edit((current) => removeBookmarks(current, ids, Date.now()));
		void trashDeleted(gone.map((entry) => ({kind: 'bookmark', ...entry})));
		selection.stop();
		showSnack(
			gone.length === 1
				? 'Bookmark deleted'
				: `${gone.length} bookmarks deleted`,
			{
				label: 'Undo',
				run() {
					void edit((current) =>
						restoreBookmarks(
							current,
							gone,
							gone.map(() => newId()),
							Date.now(),
						),
					);
				},
			},
		);
	};

	const removeDuplicates = () => {
		const ids = removalIds(findDuplicateBookmarks(store.bookmarks), new Map());
		if (ids.length === 0) {
			notify('No duplicates', 'Every saved address appears once.');
			return;
		}

		remove(new Set(ids));
	};

	// What the 3 dot menu offers, from what is on screen: nothing to open, select, or put in order in an empty column.
	const menuActions: SheetAction[] = [
		...(!isSearching && shown.length > 0 && columnName
			? [
					{
						icon: 'albums-outline' as const,
						label: `Open all ${shown.length} in ${columnName}`,
						onPress() {
							openAll(
								shown.map((bookmark) => linkToOpen(bookmark.url, links)),
								columnName,
							);
						},
					},
				]
			: []),
		...(shown.length > 0
			? [
					{
						icon: 'checkbox-outline' as const,
						label: 'Select bookmarks',
						hint: 'Move, open or delete several at once',
						onPress() {
							selection.start();
						},
					},
				]
			: []),
		...(!isSearching && shown.length > 1 && columnId !== ALL_BOOKMARKS_ID
			? [
					{
						icon: 'swap-vertical-outline' as const,
						label: 'Put bookmarks in order',
						hint: `Move bookmarks up and down in ${columnName}`,
						onPress() {
							setReordering(true);
						},
					},
				]
			: []),
		...(!isSearching && isEditableColumn && shown.length > 0
			? [
					{
						icon: 'download-outline' as const,
						label: 'Share column',
						onPress() {
							openShare({
								title: columnName ?? 'column',
								data: {
									kind: 'bookmarks',
									columns: store.bookmarkColumns.filter(
										(column) => column.id === columnId,
									),
									bookmarks: shown,
								},
							});
						},
					},
				]
			: []),
		...(!isSearching && isEditableColumn
			? [
					{
						icon: 'create-outline' as const,
						label: 'Edit column',
						color: colors.teal,
						hint: 'Rename it, or change its icon and color',
						onPress() {
							setSheet({kind: 'column', id: columnId});
						},
					},
				]
			: []),
		...(!isSearching && !atList && columnId === ALL_BOOKMARKS_ID
			? [
					{
						icon: 'eye-off-outline' as const,
						label: 'Hide All',
						hint: 'Show it again in Settings, under Bookmarks',
						onPress() {
							void setSyncedSetting('showAllBookmarks', false);
							showSnack('All is hidden', {
								label: 'Undo',
								run() {
									void setSyncedSetting('showAllBookmarks', true);
								},
							});
						},
					},
				]
			: []),
		...(!isSearching && columnIndex > 0
			? [
					{
						icon: 'arrow-back-outline' as const,
						label: 'Move column earlier',
						onPress() {
							void edit((current) =>
								moveColumn(current, columnId, -1, Date.now()),
							);
						},
					},
				]
			: []),
		...(!isSearching &&
		columnIndex !== -1 &&
		columnIndex < store.bookmarkColumns.length - 1
			? [
					{
						icon: 'arrow-forward-outline' as const,
						label: 'Move column later',
						onPress() {
							void edit((current) =>
								moveColumn(current, columnId, 1, Date.now()),
							);
						},
					},
				]
			: []),
		...(!isSearching && isEditableColumn
			? [
					{
						icon: 'trash-outline' as const,
						label: 'Delete column',
						destructive: true,
						onPress() {
							confirmDeleteColumn(
								store,
								{id: columnId, name: columnName ?? ''},
								() => {
									setPicked('');
								},
							);
						},
					},
				]
			: []),
		...(!isSearching && store.bookmarks.length > 1
			? [
					{
						icon: 'copy-outline' as const,
						label: 'Remove duplicates',
						hint: 'Keep the oldest copy of each saved address',
						onPress: removeDuplicates,
					},
				]
			: []),
		...(columns.length > 0
			? [
					{
						icon: 'list-outline' as const,
						label: 'Manage columns',
						hint: 'Open, put in order, or change any column',
						onPress() {
							setColumnsOpen(true);
						},
					},
				]
			: []),
	];

	const reorder = (id: string, move: BookmarkMove) => {
		void edit((current) => moveBookmark(current, id, move, Date.now()));
	};

	const headerActions = selection.active ? (
		<>
			<IconButton
				icon={isAllSelected ? 'remove-circle-outline' : 'checkmark-done'}
				label={isAllSelected ? 'Select none' : 'Select all'}
				onPress={() => {
					selection.setAll(
						isAllSelected ? [] : shown.map((bookmark) => bookmark.id),
					);
				}}
			/>
			<IconButton
				icon="close"
				label="Done selecting"
				onPress={selection.stop}
			/>
		</>
	) : reordering ? (
		<IconButton
			icon="checkmark"
			label="Done reordering"
			color={colors.accent}
			onPress={() => {
				setReordering(false);
			}}
		/>
	) : (
		<>
			<PrivateSwitch />
			{menuActions.length > 0 && (
				<IconButton
					icon="ellipsis-horizontal"
					label="More actions"
					onPress={() => {
						setMenuOpen(true);
					}}
				/>
			)}
		</>
	);

	// Every column the chips and the list view draw: All first when it is on, then the columns.
	const entries: FolderEntry[] = [
		...(showAll
			? [
					{
						id: ALL_BOOKMARKS_ID,
						name: 'All',
						count: store.bookmarks.length,
						glyph: 'layers-outline' as const,
						tint: colors.accent,
					},
				]
			: []),
		...columns.map((column) => {
			const look = chipLook(column);
			return {
				id: column.id,
				name: column.name,
				count: column.count,
				glyph: look.glyph,
				tint: look.tint,
			};
		}),
	];
	const openEntry = entries.find((entry) => entry.id === columnId);
	const openColumn = (id: string) => {
		setPicked(id);
		setInside(true);
	};

	// Three fingers dragged over the rows select them.
	const dragSelect = useDragSelect({data: shown, selection, listRef});

	return (
		<View
			ref={dragSelect.containerRef}
			collapsable={false}
			style={styles.screen}
			{...dragSelect.panHandlers}
			onLayout={dragSelect.onContainerLayout}
		>
			<GlassTarget>
				<Animated.View style={[styles.screen, {opacity: fade}]}>
					<FlatList
						ref={listRef}
						removeClippedSubviews
						CellRendererComponent={dragSelect.CellRenderer}
						scrollEnabled={dragSelect.scrollEnabled}
						scrollEventThrottle={16}
						data={shown}
						extraData={selection.ids}
						keyExtractor={(bookmark) => bookmark.id}
						refreshing={refreshing}
						contentContainerStyle={[
							styles.list,
							{
								paddingBottom: isKeyboardOpen
									? space + 8 + (search.open ? ROOM_FOR_BUTTONS : 0)
									: (selection.active ? 72 + insets.bottom : space) +
										ROOM_FOR_BUTTONS,
							},
						]}
						keyboardShouldPersistTaps="handled"
						// Long columns draw only what is on screen, and a little around it.
						initialNumToRender={14}
						windowSize={9}
						maxToRenderPerBatch={10}
						ListHeaderComponent={
							<View style={styles.head}>
								<Header
									title={
										selection.active
											? `${selection.ids.size} selected`
											: reordering
												? `Order ${columnName ?? ''}`
												: 'Bookmarks'
									}
									live={searchCount !== undefined && shown.length > 0}
									subtitle={
										selection.active
											? undefined
											: reordering
												? 'Move bookmarks up or down, then tap Done'
												: (searchCount ??
													`${store.bookmarks.length} saved${view === 'private' ? ', private' : ''}`)
									}
									right={headerActions}
								/>
								<View style={styles.search}>
									{!isSearching && isListView && !atList && openEntry && (
										<FolderBack
											entry={openEntry}
											noun="bookmark"
											label="All columns"
											onBack={() => {
												setInside(false);
											}}
											onMenu={() => {
												setMenuOpen(true);
											}}
										/>
									)}
									{atList && (
										<FolderList
											entries={entries}
											noun="bookmark"
											newLabel="New column"
											onOpen={openColumn}
											onNew={() => {
												setSheet({kind: 'column'});
											}}
											onMenu={(id) => {
												// The same menu as the three dots, for the held column.
												openColumn(id);
												setMenuOpen(true);
											}}
										/>
									)}
									{!isSearching && !isListView && (
										<ScrollView
											horizontal
											showsHorizontalScrollIndicator={false}
										>
											<Chips
												items={[
													...entries,
													{
														id: NEW_COLUMN_CHIP,
														name: 'New column',
														glyph: 'add' as const,
														tint: colors.accent,
													},
												]}
												selected={columnId}
												onLongPress={(id) => {
													if (id === NEW_COLUMN_CHIP) {
														return;
													}

													// The same menu as the three dots, for the held column.
													setPicked(id);
													setMenuOpen(true);
												}}
												onSelect={(id) => {
													if (id === NEW_COLUMN_CHIP) {
														setSheet({kind: 'column'});
													} else {
														setPicked(id);
													}
												}}
											/>
										</ScrollView>
									)}
								</View>
							</View>
						}
						ListFooterComponent={
							<SearchElsewhere
								store={store}
								query={query}
								here="bookmarks"
								localCount={shown.length}
								onJump={search.close}
							/>
						}
						ListEmptyComponent={
							atList ? undefined : isSearching ? (
								<Empty icon="search" title="No match">
									Nothing saved matches that search.
								</Empty>
							) : (
								<Empty
									icon="bookmark-outline"
									title="No bookmarks yet"
									action={
										<View style={styles.emptyActions}>
											<Button label="Add a link" icon="add" onPress={onAdd} />
											{!connected && (
												<Button
													kind="plain"
													label="Connect to your server"
													onPress={onConnect}
												/>
											)}
										</View>
									}
								>
									{view === 'private'
										? 'Nothing is saved in the private library yet. Save a link to start it.'
										: connected
											? 'This phone is connected to your server, but the library has no bookmarks yet. Save a link, or share one from your browser or the extension.'
											: 'Save a link, share one from your browser, or connect your sync server to bring in the ones you already have.'}
								</Empty>
							)
						}
						renderItem={({item, index}) =>
							reordering ? (
								<ReorderRow
									bookmark={item}
									first={index === 0}
									last={index === shown.length - 1}
									onTop={() => {
										reorder(item.id, 'top');
									}}
									onUp={() => {
										reorder(item.id, 'up');
									}}
									onDown={() => {
										reorder(item.id, 'down');
									}}
								/>
							) : (
								<BookmarkRow
									bookmark={item}
									selecting={selection.active}
									checked={selection.ids.has(item.id)}
									onToggle={() => {
										selection.toggle(item.id);
									}}
									onSelect={() => {
										if (selection.active) {
											selection.toggle(item.id);
										} else {
											setRowMenuId(item.id);
										}
									}}
									onEdit={() => {
										setSheet({kind: 'edit', bookmark: item});
									}}
									onMove={() => {
										selection.start(item.id);
										setSheet({kind: 'move'});
									}}
									onDelete={() => {
										remove(new Set([item.id]));
									}}
								/>
							)
						}
						onScroll={(event) => {
							dragSelect.onScroll(event);
							trackScroll(event);
						}}
						onRefresh={() => {
							void refresh();
						}}
					/>
				</Animated.View>
			</GlassTarget>
			{!selection.active && !reordering && !search.open && (
				<FloatingActions bottom={space} onAdd={onAdd} onSearch={search.show} />
			)}
			{search.open && (
				<SearchDock
					label="Search bookmarks"
					placeholder="Title or address"
					bottom={space}
					query={query}
					onChange={search.setQuery}
					onClose={search.close}
				/>
			)}
			{selection.active && (
				<SelectionBar
					count={selection.ids.size}
					canMove={store.bookmarkColumns.length > 1}
					onOpen={() => {
						openAll(
							shown
								.filter((bookmark) => selection.ids.has(bookmark.id))
								.map((bookmark) => linkToOpen(bookmark.url, links)),
							`${selection.ids.size} selected`,
						);
					}}
					onShare={() => {
						const chosen = shown.filter((item) => selection.ids.has(item.id));
						openShare({
							title: `${chosen.length} bookmarks`,
							data: {
								kind: 'bookmarks',
								columns: store.bookmarkColumns,
								bookmarks: chosen,
							},
						});
					}}
					onEdit={() => {
						const bookmark = shown.find((item) => selection.ids.has(item.id));
						if (bookmark) {
							setSheet({kind: 'edit', bookmark});
						}
					}}
					onMove={() => {
						setSheet({kind: 'move'});
					}}
					onDelete={() => {
						remove(selection.ids);
					}}
				/>
			)}
			<ActionSheet
				visible={rowMenuBookmark !== undefined}
				title={rowMenuBookmark?.title || rowMenuBookmark?.url || ''}
				actions={rowActions}
				onClose={() => {
					setRowMenuId(undefined);
				}}
			/>
			<ActionSheet
				visible={menuOpen}
				title={columnName ?? 'Bookmarks'}
				actions={menuActions}
				onClose={() => {
					setMenuOpen(false);
				}}
			/>
			<ColumnsSheet
				visible={columnsOpen}
				columns={columns}
				selected={columnId}
				onClose={() => {
					setColumnsOpen(false);
				}}
				onPick={(id) => {
					setPicked(id);
				}}
				onEdit={(id) => {
					setColumnsOpen(false);
					setSheet({kind: 'column', id});
				}}
				onNew={() => {
					setColumnsOpen(false);
					setSheet({kind: 'column'});
				}}
			/>
			<EditSheet
				bookmark={editing}
				onClose={() => {
					setSheet(undefined);
					selection.stop();
				}}
			/>
			<ColumnSheet
				visible={sheet?.kind === 'column'}
				column={editingColumn}
				onClose={(id) => {
					setSheet(undefined);
					// A column that was just made is shown, so the new link or move lands where the person can see it.
					if (id && !editingColumn) {
						setPicked(id);
					}
				}}
			/>
			<MoveSheet
				visible={isMoving}
				count={selection.ids.size}
				columns={store.bookmarkColumns.map(({id, name, icon, color}) => ({
					id,
					name,
					icon,
					color,
				}))}
				onClose={() => {
					setSheet(undefined);
				}}
				onPick={(id) => {
					void edit((current) =>
						moveBookmarks(current, selection.ids, id, Date.now()),
					);
					setSheet(undefined);
					selection.stop();
				}}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	head: {gap: 8},
	search: {paddingHorizontal: 16, gap: 12, paddingBottom: 8},
	list: {flexGrow: 1},
	emptyActions: {alignSelf: 'stretch', gap: 8, paddingTop: 12},
});
