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
import {Button, Chips, Field} from '../ui';

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
		<ScrollView
			contentContainerStyle={styles.screen}
			keyboardShouldPersistTaps="handled"
		>
			<Field
				label="Link"
				value={text}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
				onChangeText={setText}
			/>
			{text.length > 0 && !url && (
				<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
					Enter a web address that starts with http:// or https://.
				</Text>
			)}
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
				value={newName}
				onChangeText={setNewName}
			/>
			<Button label="Save" disabled={!url} onPress={() => void save()} />
			<Button label="Cancel" kind="plain" onPress={onDone} />
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {padding: 16, gap: 14},
	group: {gap: 6},
});
