import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {Bookmark} from '../../../src/app/types';
import {
	addBookmark,
	addColumn,
	columnViews,
	DEFAULT_COLUMN_ID,
	extractUrl,
	updateBookmark,
} from '../library';
import {edit, newId, useLibrary} from '../library-store';
import {getPreferences, setPreferences} from '../preferences';
import {useColors} from '../theme';
import {Button, Chips, Field, IconButton} from '../ui';

/**
The body of the save drawer. Opened by Add link, or by the Android share sheet with the shared text filled in.
*/
export function SaveLinkForm({
	initialText,
	initialTitle,
	editing,
	onDone,
}: {
	initialText: string;
	initialTitle: string;
	/**
	A bookmark to change instead of saving a new one. The initial text and title are then its own.
	*/
	editing?: Bookmark;
	/**
	Called when the drawer should close; `saved` is the column name when a link was saved.
	*/
	onDone: (saved?: string) => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const columns = columnViews(store).filter((column) =>
		store.bookmarkColumns.some((own) => own.id === column.id),
	);
	const [text, setText] = useState(
		() => extractUrl(initialText) ?? initialText,
	);
	const [title, setTitle] = useState(initialTitle);
	const [picked, setPicked] = useState(editing?.columnId ?? '');
	const [newName, setNewName] = useState('');
	const [saving, setSaving] = useState(false);

	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns.find((column) => column.id === getPreferences().lastColumnId)
				?.id ??
			columns.find((column) => column.id === DEFAULT_COLUMN_ID)?.id ??
			columns[0]?.id ??
			DEFAULT_COLUMN_ID);
	const url = extractUrl(text);

	const save = async () => {
		if (!url) {
			return;
		}

		setSaving(true);
		let target = columnId;
		const name = newName.trim();
		if (name) {
			target = newId();
			const id = target;
			await edit((current) => addColumn(current, name, id, Date.now()));
		}

		await edit((current) =>
			editing
				? updateBookmark(
						current,
						editing.id,
						{url, title, columnId: target},
						Date.now(),
					)
				: addBookmark(
						current,
						{url, title, columnId: target},
						newId(),
						Date.now(),
					),
		);
		setPreferences({lastColumnId: target});
		onDone(
			name ||
				columns.find((column) => column.id === target)?.name ||
				'Bookmarks',
		);
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{editing ? 'Edit link' : 'Save link'}
				</Text>
				<IconButton
					icon="close"
					label="Close"
					onPress={() => {
						onDone();
					}}
				/>
			</View>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				<Field
					label="Link"
					icon="link-outline"
					value={text}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					error={
						text.length > 0 && !url
							? 'Enter a web address that starts with http:// or https://.'
							: undefined
					}
					onChangeText={setText}
					onClear={() => {
						setText('');
					}}
				/>
				<Field label="Title (optional)" value={title} onChangeText={setTitle} />
				{columns.length > 0 && (
					<View style={styles.group}>
						<Text style={{color: colors.muted}}>Column</Text>
						<Chips items={columns} selected={columnId} onSelect={setPicked} />
					</View>
				)}
				<Field
					label={
						columns.length > 0
							? 'Or create a new column'
							: 'Column name (optional)'
					}
					icon="folder-outline"
					value={newName}
					onChangeText={setNewName}
				/>
				<Button
					label="Save"
					icon="checkmark"
					disabled={!url}
					loading={saving}
					onPress={() => void save()}
				/>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	// Sized to its content: the sheet only grows as far as its own maximum height, then the body scrolls.
	screen: {flexShrink: 1},
	top: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {fontSize: 20, fontWeight: '700'},
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
});
