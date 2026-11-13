import {useEffect, useMemo, useState} from 'react';
import {
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark} from '../../../src/app/types';
import {BottomSheet} from '../bottom-sheet';
import {
	bookmarksIn,
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
import {openAll} from '../open-links';
import {showSnack} from '../snackbar';
import {useBarSpace} from '../tab-bar';
import {useColors, useShape} from '../theme';
import {useSelection} from '../use-selection';
import {Chips, Empty, Field, Header, Icon, IconButton} from '../ui';
import {BookmarkRow, MoveSheet, SelectionBar} from './bookmark-parts';
import {SaveLinkForm} from './save-link';

export function BookmarksScreen({
	onAdd,
	onSelecting,
}: {
	onAdd: () => void;
	onSelecting: (selecting: boolean) => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const space = useBarSpace();
	const store = useLibrary();
	const selection = useSelection();
	const [picked, setPicked] = useState('');
	const [query, setQuery] = useState('');
	const [refreshing, setRefreshing] = useState(false);
	// The drawer for choosing a column to move the selection to.
	const [moving, setMoving] = useState(false);
	// The bookmark whose edit drawer is open.
	const [editing, setEditing] = useState<Bookmark>();

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

	const refresh = async () => {
		setRefreshing(true);
		try {
			await syncClient.syncNow();
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
	) : (
		<>
			{!searching && shown.length > 0 && (
				<IconButton
					icon="albums-outline"
					label={`Open all ${shown.length} in ${columnName}`}
					onPress={() => {
						openAll(
							shown.map((bookmark) => bookmark.url),
							columnName ?? 'This column',
						);
					}}
				/>
			)}
			<IconButton
				icon="checkbox-outline"
				label="Select bookmarks"
				onPress={() => {
					selection.start();
				}}
			/>
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
				data={shown}
				extraData={selection.ids}
				keyExtractor={(bookmark) => bookmark.id}
				refreshing={refreshing}
				contentContainerStyle={[
					styles.list,
					{paddingBottom: (selection.active ? 72 + insets.bottom : space) + 72},
				]}
				keyboardShouldPersistTaps="handled"
				ListHeaderComponent={
					<View style={styles.head}>
						<Header
							title={
								selection.active
									? `${selection.ids.size} selected`
									: 'Bookmarks'
							}
							subtitle={
								selection.active ? undefined : `${store.bookmarks.length} saved`
							}
							right={headerActions}
						/>
						<View style={styles.search}>
							<Field
								label="Search bookmarks"
								icon="search"
								value={query}
								autoCapitalize="none"
								autoCorrect={false}
								returnKeyType="search"
								onChangeText={setQuery}
								onClear={() => {
									setQuery('');
								}}
							/>
							{!searching && columns.length > 0 && (
								<ScrollView horizontal showsHorizontalScrollIndicator={false}>
									<Chips
										items={columns}
										selected={columnId}
										onSelect={setPicked}
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
						<Empty icon="bookmark-outline" title="No bookmarks yet">
							Save a link with Add link, share one from your browser, or connect
							your sync server in Settings.
						</Empty>
					)
				}
				renderItem={({item}) => (
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
							setEditing(item);
						}}
						onDelete={() => {
							remove(new Set([item.id]));
						}}
					/>
				)}
				onRefresh={() => {
					void refresh();
				}}
			/>
			{!selection.active && !shape.ios && (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Add link"
					android_ripple={{color: '#ffffff33'}}
					style={({pressed}) => [
						styles.fab,
						{
							bottom: space,
							backgroundColor: colors.accent,
							opacity: pressed ? 0.85 : 1,
						},
					]}
					onPress={onAdd}
				>
					<Icon name="add" size={24} color={colors.onAccent} />
					<Text style={[styles.fabLabel, {color: colors.onAccent}]}>
						Add link
					</Text>
				</Pressable>
			)}
			{selection.active && (
				<SelectionBar
					count={selection.ids.size}
					canMove={store.bookmarkColumns.length > 1}
					onOpen={() => {
						openAll(
							shown
								.filter((bookmark) => selection.ids.has(bookmark.id))
								.map((bookmark) => bookmark.url),
							`${selection.ids.size} selected`,
						);
					}}
					onEdit={() => {
						setEditing(
							shown.find((bookmark) => selection.ids.has(bookmark.id)),
						);
					}}
					onMove={() => {
						setMoving(true);
					}}
					onDelete={() => {
						remove(selection.ids);
					}}
				/>
			)}
			<BottomSheet
				visible={Boolean(editing)}
				label="Edit link"
				onClose={() => {
					setEditing(undefined);
				}}
			>
				{editing && (
					<SaveLinkForm
						key={editing.id}
						editing={editing}
						initialText={editing.url}
						initialTitle={editing.title}
						onDone={() => {
							setEditing(undefined);
							selection.stop();
						}}
					/>
				)}
			</BottomSheet>
			<MoveSheet
				visible={moving}
				count={selection.ids.size}
				columns={store.bookmarkColumns.map(({id, name}) => ({id, name}))}
				onClose={() => {
					setMoving(false);
				}}
				onPick={(id) => {
					void edit((current) =>
						moveBookmarks(current, selection.ids, id, Date.now()),
					);
					setMoving(false);
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
	fab: {
		position: 'absolute',
		right: 16,
		minHeight: 56,
		paddingHorizontal: 20,
		borderRadius: 28,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		elevation: 4,
	},
	fabLabel: {fontWeight: '600', fontSize: 15},
});
