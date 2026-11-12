import {useMemo, useState} from 'react';
import {
	Alert,
	FlatList,
	Linking,
	Pressable,
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
import {Button, Chips, Empty, Field} from '../ui';

export function BookmarksScreen({onAdd}: {onAdd: () => void}) {
	const colors = useColors();
	const store = useLibrary();
	const [picked, setPicked] = useState('');
	const [query, setQuery] = useState('');
	const [refreshing, setRefreshing] = useState(false);

	const columns = useMemo(() => columnViews(store), [store]);
	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns[0]?.id ?? '');
	const searching = query.trim().length > 0;
	const shown = searching
		? searchBookmarks(store, query)
		: bookmarksIn(store, columnId);

	const confirmRemove = (bookmark: Bookmark) => {
		Alert.alert('Delete bookmark', bookmark.title, [
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
			// The status line in Settings shows why.
		} finally {
			await refreshStatus();
			setRefreshing(false);
		}
	};

	return (
		<View style={styles.screen}>
			<View style={styles.head}>
				<Field
					label="Search bookmarks"
					value={query}
					autoCapitalize="none"
					autoCorrect={false}
					returnKeyType="search"
					onChangeText={setQuery}
				/>
				{!searching && columns.length > 0 && (
					<Chips items={columns} selected={columnId} onSelect={setPicked} />
				)}
			</View>
			<FlatList
				data={shown}
				keyExtractor={(bookmark) => bookmark.id}
				refreshing={refreshing}
				contentContainerStyle={styles.list}
				ListEmptyComponent={
					<Empty>
						{searching
							? 'No bookmark matches.'
							: 'Nothing here yet. Save a link with Add link, share one from your browser, or connect your sync server in Settings.'}
					</Empty>
				}
				renderItem={({item}) => (
					<View style={[styles.row, {borderColor: colors.border}]}>
						<Pressable
							accessibilityRole="link"
							accessibilityLabel={`${item.title}, ${hostOf(item.url)}`}
							accessibilityHint="Opens the link"
							style={styles.main}
							onPress={() => {
								void Linking.openURL(item.url);
							}}
							onLongPress={() => {
								confirmRemove(item);
							}}
						>
							<Text
								numberOfLines={2}
								style={[styles.title, {color: colors.text}]}
							>
								{item.title}
							</Text>
							<Text numberOfLines={1} style={{color: colors.muted}}>
								{hostOf(item.url)}
							</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Delete ${item.title}`}
							style={styles.delete}
							onPress={() => {
								confirmRemove(item);
							}}
						>
							<Text style={{color: colors.danger, fontWeight: '600'}}>
								Delete
							</Text>
						</Pressable>
					</View>
				)}
				onRefresh={() => {
					void refresh();
				}}
			/>
			<View style={styles.foot}>
				<Button label="Add link" onPress={onAdd} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	head: {padding: 16, gap: 12},
	list: {paddingHorizontal: 16, flexGrow: 1},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	main: {flex: 1, minHeight: TARGET + 8, paddingVertical: 10, gap: 2},
	title: {fontSize: 16, fontWeight: '500'},
	delete: {
		minHeight: TARGET,
		minWidth: TARGET,
		justifyContent: 'center',
		paddingLeft: 12,
	},
	foot: {padding: 16},
});
