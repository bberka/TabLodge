import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {
	addBookmark,
	addColumn,
	columnViews,
	DEFAULT_COLUMN_ID,
	extractUrl,
} from '../library';
import {edit, newId, useLibrary} from '../library-store';
import {useColors} from '../theme';
import {Button, Chips, Field, Header, IconButton} from '../ui';

/**
Saves a link into a column. Opened by Add link, or by the Android share sheet with the shared text filled in.
*/
export function SaveLinkScreen({
	initialText,
	initialTitle,
	onDone,
}: {
	initialText: string;
	initialTitle: string;
	onDone: () => void;
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
	const [picked, setPicked] = useState('');
	const [newName, setNewName] = useState('');
	const [saving, setSaving] = useState(false);

	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns.find((column) => column.id === DEFAULT_COLUMN_ID)?.id ??
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
			addBookmark(current, {url, title, columnId: target}, newId(), Date.now()),
		);
		onDone();
	};

	return (
		<View style={styles.screen}>
			<Header
				title="Save link"
				right={<IconButton icon="close" label="Close" onPress={onDone} />}
			/>
			<ScrollView
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
				<Button label="Cancel" kind="plain" onPress={onDone} />
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	body: {padding: 16, gap: 16},
	group: {gap: 8},
});
