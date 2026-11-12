import {useMemo, useState} from 'react';
import {
	Alert,
	FlatList,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import type {Bookmark} from '../../../src/app/types';
import {
	bookmarksIn,
	columnViews,
	hostOf,
	removeBookmark,
	searchBookmarks,
} from '../library';
import {edit, refreshStatus, syncClient, useLibrary} from '../library-store';
import {TARGET, useColors} from '../theme';
import {Avatar, Chips, Empty, Field, Header, Icon, IconButton} from '../ui';

export function BookmarksScreen({onAdd}: {onAdd: () => void}) {
	const colors = useColors();
	const store = useLibrary();
	const [picked, setPicked] = useState('');
	const [query, setQuery] = useState('');
	const [refreshing, setRefreshing] = useState(false);

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
	const shown = searching
		? searchBookmarks(store, query)
		: bookmarksIn(store, columnId);

	const confirmRemove = (bookmark: Bookmark) => {
		Alert.alert('Delete bookmark?', bookmark.title, [
			{text: 'Cancel', style: 'cancel'},
			{
				text: 'Delete',
				style: 'destructive',
				onPress() {
					void edit((current) =>
						removeBookmark(current, bookmark.id, Date.now()),
					);
				},
			},
		]);
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

	return (
		<View style={styles.screen}>
			<FlatList
				data={shown}
				keyExtractor={(bookmark) => bookmark.id}
				refreshing={refreshing}
				contentContainerStyle={styles.list}
				keyboardShouldPersistTaps="handled"
				ListHeaderComponent={
					<View style={styles.head}>
						<Header
							title="Bookmarks"
							subtitle={`${store.bookmarks.length} saved`}
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
					<View style={[styles.row, {borderColor: colors.border}]}>
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={`${item.title}, ${hostOf(item.url)}`}
							accessibilityHint="Opens the link"
							android_ripple={{color: colors.pressed}}
							style={({pressed}) => [
								styles.main,
								{backgroundColor: pressed ? colors.pressed : 'transparent'},
							]}
							onPress={() => {
								void Linking.openURL(item.url);
							}}
							onLongPress={() => {
								confirmRemove(item);
							}}
						>
							<Avatar host={hostOf(item.url)} />
							<View style={styles.texts}>
								<Text
									numberOfLines={2}
									style={[styles.title, {color: colors.text}]}
								>
									{item.title}
								</Text>
								<Text numberOfLines={1} style={{color: colors.muted}}>
									{hostOf(item.url)}
								</Text>
							</View>
							<Icon name="open-outline" size={18} color={colors.muted} />
						</Pressable>
						<IconButton
							icon="trash-outline"
							label={`Delete ${item.title}`}
							color={colors.danger}
							onPress={() => {
								confirmRemove(item);
							}}
						/>
					</View>
				)}
				onRefresh={() => {
					void refresh();
				}}
			/>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Add link"
				android_ripple={{color: '#ffffff33'}}
				style={({pressed}) => [
					styles.fab,
					{backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1},
				]}
				onPress={onAdd}
			>
				<Icon name="add" size={24} color={colors.onAccent} />
				<Text style={[styles.fabLabel, {color: colors.onAccent}]}>
					Add link
				</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	head: {gap: 8},
	search: {paddingHorizontal: 16, gap: 12, paddingBottom: 8},
	list: {paddingBottom: 96, flexGrow: 1},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
		paddingRight: 4,
	},
	main: {
		flex: 1,
		minHeight: TARGET + 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 10,
		paddingHorizontal: 16,
	},
	texts: {flex: 1, gap: 2},
	title: {fontSize: 16, fontWeight: '500'},
	fab: {
		position: 'absolute',
		right: 16,
		bottom: 16,
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
