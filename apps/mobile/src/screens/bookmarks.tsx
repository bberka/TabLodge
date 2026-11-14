import {useEffect, useMemo, useState} from 'react';
import {FlatList, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark} from '../../../extension/src/app/types';
import {ActionSheet} from '../action-sheet';
import {useBackAction} from '../back-actions';
import {useChipLook} from '../column-icons';
import {
	bookmarksIn,
	moveBookmark,
	type BookmarkMove,
	columnViews,
	moveBookmarks,
	removeBookmarks,
	restoreBookmarks,
	searchBookmarks,
} from '../library';
import {
	edit,
	newId,
	refreshStatus,
	syncClient,
	useLibrary,
} from '../library-store';
import {linkToOpen} from '../links';
import {openAll} from '../open-links';
import {useLinkSettings} from '../use-link-settings';
import {showSnack} from '../snackbar';
import {useBarSpace} from '../tab-bar';
import {useColors, useShape} from '../theme';
import {PrivateSwitch} from '../private-switch';
import {syncPrivate} from '../private-library';
import {useSelection} from '../use-selection';
import {useView} from '../view';
import {Button, Chips, Empty, Field, Header, IconButton} from '../ui';
import {ColumnSheet} from './column-sheet';
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
	const space = useBarSpace();
	const store = useLibrary();
	const selection = useSelection();
	const view = useView();
	const readOnly = view === 'private';
	const links = useLinkSettings();
	const [picked, setPicked] = useState('');
	const [query, setQuery] = useState('');
	const [refreshing, setRefreshing] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [columnsOpen, setColumnsOpen] = useState(false);
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

	const remove = (ids: ReadonlySet<string>) => {
		const gone = store.bookmarks.filter((bookmark) => ids.has(bookmark.id));
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
			{shape.ios && !readOnly && (
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
				data={shown}
				extraData={selection.ids}
				keyExtractor={(bookmark) => bookmark.id}
				refreshing={refreshing}
				contentContainerStyle={[
					styles.list,
					{paddingBottom: (selection.active ? 72 + insets.bottom : space) + 72},
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
										: `${store.bookmarks.length} saved${readOnly ? ', private, read only' : ''}`
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
							{!searching && (columns.length > 0 || !readOnly) && (
								<ScrollView horizontal showsHorizontalScrollIndicator={false}>
									<Chips
										items={[
											...columns.map((column) => chipLook(column)),
											...(readOnly
												? []
												: [
														{
															id: NEW_COLUMN_CHIP,
															name: 'New column',
															glyph: 'add' as const,
															tint: colors.accent,
														},
													]),
										]}
										selected={columnId}
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
								readOnly ? undefined : (
									<View style={styles.emptyActions}>
										<Button label="Add a link" icon="add" onPress={onAdd} />
										<Button
											kind="plain"
											label="Connect to your server"
											onPress={onConnect}
										/>
									</View>
								)
							}
						>
							{readOnly
								? 'Nothing is saved in the private library yet.'
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
							readOnly={readOnly}
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
				onRefresh={() => {
					void refresh();
				}}
			/>
			{!selection.active && !reordering && !shape.ios && !readOnly && (
				<AddButton bottom={space} onPress={onAdd} />
			)}
			{!selection.active && !reordering && (
				<MenuButton
					bottom={space}
					right={shape.ios || readOnly ? 16 : 16 + 56 + 12}
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
					...(readOnly
						? []
						: [
								{
									icon: 'list-outline' as const,
									label: 'Manage columns',
									hint: 'Open, put in order, or change any column',
									onPress() {
										setColumnsOpen(true);
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
								{
									icon: 'checkbox-outline' as const,
									label: 'Select bookmarks',
									hint: 'Move, open or delete several at once',
									onPress() {
										selection.start();
									},
								},
							]),
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
