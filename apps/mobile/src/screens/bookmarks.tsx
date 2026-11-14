import {useEffect, useMemo, useState} from 'react';
import {FlatList, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark, Store} from '../../../extension/src/shared/types';
import {ActionSheet, type SheetAction} from '../action-sheet';
import {useBackAction} from '../back-actions';
import {
	findDuplicateBookmarks,
	removalIds,
} from '../../../extension/src/shared/duplicate-bookmarks';
import {confirm, notify} from '../dialog';
import {useChipLook} from '../column-icons';
import {
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
} from '../library';
import {
	edit,
	newId,
	refreshStatus,
	syncClient,
	useLibrary,
	useSyncStatus,
} from '../library-store';
import {linkToOpen} from '../links';
import {openAll} from '../open-links';
import {useLinkSettings} from '../use-link-settings';
import {showSnack} from '../snackbar';
import {useRoomBelow} from '../keyboard';
import {useBarSpace} from '../tab-bar';
import {useColors, useShape} from '../theme';
import {PrivateSwitch} from '../private-switch';
import {syncPrivate} from '../private-library';
import {useSelection} from '../use-selection';
import {trackScroll} from '../scroll-state';
import {useView} from '../view';
import {Button, Chips, Empty, Field, Header, IconButton} from '../ui';
import {confirmDeleteColumn, ColumnSheet} from './column-sheet';
import {ColumnsSheet} from './columns-sheet';
import {ReorderRow} from './reorder-row';
import {
	AddButton,
	MenuButton,
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
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const barSpace = useBarSpace();
	const space = useRoomBelow(barSpace);
	const keyboardOpen = space !== barSpace;
	const store = useLibrary();
	const selection = useSelection();
	const view = useView();
	const {connected} = useSyncStatus();
	const links = useLinkSettings();
	const [picked, setPicked] = useState('');
	const [query, setQuery] = useState('');
	const [refreshing, setRefreshing] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [columnsOpen, setColumnsOpen] = useState(false);
	// The column whose menu is open, from holding down its chip.
	const [chipMenuId, setChipMenuId] = useState<string>();
	// While true, rows show buttons that move them instead of opening them.
	const [reordering, setReordering] = useState(false);
	// The drawer for choosing a column to move the selection to.
	// The bookmark whose edit drawer is open.
	const [sheet, setSheet] = useState<Sheet>();
	const editing = sheet?.kind === 'edit' ? sheet.bookmark : undefined;
	const moving = sheet?.kind === 'move';
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
	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns[0]?.id ?? '');
	const searching = query.trim().length > 0;
	const shown = useMemo(
		() =>
			searching ? searchBookmarks(store, query) : bookmarksIn(store, columnId),
		[store, query, columnId, searching],
	);
	const columnName = columns.find((column) => column.id === columnId)?.name;
	// The Unfiled bucket is not a column of its own and cannot be changed.
	const editableColumn = store.bookmarkColumns.some(
		(column) => column.id === columnId,
	);
	const allSelected = shown.length > 0 && selection.ids.size === shown.length;
	const chipMenu = chipMenuId
		? columnMenu(chipMenuId, store, {
				links,
				edit(id) {
					setSheet({kind: 'column', id});
				},
				removed(id) {
					if (picked === id) {
						setPicked('');
					}
				},
			})
		: undefined;

	const remove = (ids: ReadonlySet<string>) => {
		const gone = removedBookmarks(store, ids);
		if (gone.length === 0) {
			return;
		}

		void edit((current) => removeBookmarks(current, ids, Date.now()));
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

		confirm(
			`Remove ${ids.length} duplicate ${ids.length === 1 ? 'bookmark' : 'bookmarks'}?`,
			'Each address keeps its oldest copy. You can undo this right after.',
			{label: `Remove ${ids.length}`, destructive: true},
			() => {
				remove(new Set(ids));
			},
		);
	};

	const reorder = (id: string, move: BookmarkMove) => {
		void edit((current) => moveBookmark(current, id, move, Date.now()));
	};

	const refresh = async () => {
		setRefreshing(true);
		try {
			await (view === 'private' ? syncPrivate() : syncClient.syncNow());
		} catch {
			// The status card in Settings shows why.
		} finally {
			await refreshStatus();
			setRefreshing(false);
		}
	};

	const headerActions = selection.active ? (
		<>
			<IconButton
				icon={allSelected ? 'remove-circle-outline' : 'checkmark-done'}
				label={allSelected ? 'Select none' : 'Select all'}
				onPress={() => {
					selection.setAll(
						allSelected ? [] : shown.map((bookmark) => bookmark.id),
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
			{shape.ios && (
				<IconButton
					icon="add"
					label="Add link"
					color={colors.accent}
					onPress={onAdd}
				/>
			)}
		</>
	);

	return (
		<View style={styles.screen}>
			<FlatList
				removeClippedSubviews
				scrollEventThrottle={16}
				data={shown}
				extraData={selection.ids}
				keyExtractor={(bookmark) => bookmark.id}
				refreshing={refreshing}
				contentContainerStyle={[
					styles.list,
					{
						paddingBottom: keyboardOpen
							? space + 8
							: (selection.active ? 72 + insets.bottom : space) + 72,
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
							subtitle={
								selection.active
									? undefined
									: reordering
										? 'Move bookmarks up or down, then tap Done'
										: `${store.bookmarks.length} saved${view === 'private' ? ', private' : ''}`
							}
							right={headerActions}
						/>
						<View style={styles.search}>
							<Field
								label="Search bookmarks"
								icon="search"
								placeholder="Title or address"
								value={query}
								autoCapitalize="none"
								autoCorrect={false}
								returnKeyType="search"
								onChangeText={setQuery}
								onClear={() => {
									setQuery('');
								}}
							/>
							{!searching && (
								<ScrollView horizontal showsHorizontalScrollIndicator={false}>
									<Chips
										items={[
											...columns.map((column) => chipLook(column)),
											{
												id: NEW_COLUMN_CHIP,
												name: 'New column',
												glyph: 'add' as const,
												tint: colors.accent,
											},
										]}
										selected={columnId}
										onLongPress={(id) => {
											if (id !== NEW_COLUMN_CHIP) {
												setChipMenuId(id);
											}
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
				ListEmptyComponent={
					searching ? (
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
								selection.start(item.id);
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
				onScroll={trackScroll}
				onRefresh={() => {
					void refresh();
				}}
			/>
			{!selection.active && !reordering && !shape.ios && (
				<AddButton bottom={space} onPress={onAdd} />
			)}
			{!selection.active && !reordering && (
				<MenuButton
					bottom={space}
					right={shape.ios ? 16 : 16 + 56 + 12}
					onPress={() => {
						setMenuOpen(true);
					}}
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
				visible={chipMenu !== undefined}
				title={chipMenu?.title ?? ''}
				actions={chipMenu?.actions ?? []}
				onClose={() => {
					setChipMenuId(undefined);
				}}
			/>
			<ActionSheet
				visible={menuOpen}
				title={columnName ?? 'Bookmarks'}
				actions={[
					...(searching
						? []
						: [
								{
									icon: 'albums-outline' as const,
									label: `Open all ${shown.length} in ${columnName}`,
									onPress() {
										openAll(
											shown.map((bookmark) => linkToOpen(bookmark.url, links)),
											columnName ?? 'This column',
										);
									},
								},
							]),

					{
						icon: 'checkbox-outline' as const,
						label: 'Select bookmarks',
						hint: 'Move, open or delete several at once',
						onPress() {
							selection.start();
						},
					},
					...(!searching && shown.length > 1
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
					...(!searching && editableColumn
						? [
								{
									icon: 'color-palette-outline' as const,
									label: 'Edit column',
									hint: 'Rename it, or change its icon and color',
									onPress() {
										setSheet({kind: 'column', id: columnId});
									},
								},
							]
						: []),
					...(!searching && store.bookmarks.length > 1
						? [
								{
									icon: 'copy-outline' as const,
									label: 'Remove duplicates',
									hint: 'Keep the oldest copy of each saved address',
									onPress: removeDuplicates,
								},
							]
						: []),
					{
						icon: 'list-outline' as const,
						label: 'Manage columns',
						hint: 'Open, put in order, or change any column',
						onPress() {
							setColumnsOpen(true);
						},
					},
				]}
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
				visible={moving}
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

/**
The menu for one column chip: what holding it down offers. The Unfiled bucket only opens its
bookmarks.
*/
function columnMenu(
	id: string,
	store: Store,
	{
		links,
		edit: editColumn,
		removed,
	}: {
		links: ReturnType<typeof useLinkSettings>;
		edit: (id: string) => void;
		removed: (id: string) => void;
	},
): {title: string; actions: SheetAction[]} | undefined {
	const view = columnViews(store).find((column) => column.id === id);
	if (!view) {
		return undefined;
	}

	const bookmarks = bookmarksIn(store, id);
	const index = store.bookmarkColumns.findIndex((column) => column.id === id);
	const real = index !== -1;
	const actions: SheetAction[] = [];
	if (bookmarks.length > 0) {
		actions.push({
			icon: 'albums-outline',
			label: `Open all ${bookmarks.length}`,
			onPress() {
				openAll(
					bookmarks.map((bookmark) => linkToOpen(bookmark.url, links)),
					view.name,
				);
			},
		});
	}

	if (real) {
		actions.push({
			icon: 'color-palette-outline',
			label: 'Edit column',
			hint: 'Rename it, or change its icon and color',
			onPress() {
				editColumn(id);
			},
		});
		if (index > 0) {
			actions.push({
				icon: 'arrow-back-outline',
				label: 'Move earlier',
				onPress() {
					void edit((current) => moveColumn(current, id, -1, Date.now()));
				},
			});
		}

		if (index < store.bookmarkColumns.length - 1) {
			actions.push({
				icon: 'arrow-forward-outline',
				label: 'Move later',
				onPress() {
					void edit((current) => moveColumn(current, id, 1, Date.now()));
				},
			});
		}

		actions.push({
			icon: 'trash-outline',
			label: 'Delete column',
			destructive: true,
			onPress() {
				confirmDeleteColumn(store, view, () => {
					removed(id);
				});
			},
		});
	}

	return {title: view.name, actions};
}
