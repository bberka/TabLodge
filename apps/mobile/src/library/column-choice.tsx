import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {DEFAULT_BOOKMARK_COLUMN_ID} from '../../../extension/src/shared/bookmark-rules';
import {ColorPicker} from '../ui/color-picker';
import {columnGlyph, useChipLook} from '../ui/column-icons';
import {IconPicker} from '../ui/icon-picker';
import {getPreferences} from '../settings/preferences';
import {useColors} from '../ui/theme';
import {Chips, Field} from '../ui/widgets';
import {editIn, type LibraryName, newId, useLibraryOf} from './library-store';
import {addColumn, columnViews} from './board-edits';

const NEW_COLUMN = '__new-column__';

export function useColumnChoice(
	initial = '',
	library: LibraryName = 'regular',
) {
	const store = useLibraryOf(library);
	const columns = columnViews(store).filter((column) =>
		store.bookmarkColumns.some((own) => own.id === column.id),
	);
	const [picked, setPicked] = useState(initial);
	const [newName, setNewName] = useState('');
	const [newIcon, setNewIcon] = useState('');
	const [newColor, setNewColor] = useState('');

	const creating = picked === NEW_COLUMN || columns.length === 0;
	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns.find((column) => column.id === getPreferences().lastColumnId)
				?.id ??
			columns.find((column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID)?.id ??
			columns[0]?.id ??
			DEFAULT_BOOKMARK_COLUMN_ID);

	return {
		columns,
		creating,
		columnId,
		setPicked,
		newName,
		setNewName,
		newIcon,
		setNewIcon,
		newColor,
		setNewColor,
		incomplete: creating && columns.length > 0 && !newName.trim(),
		async resolve(): Promise<{id: string; name: string}> {
			const name = creating ? newName.trim() : '';
			if (!name) {
				return {
					id: columnId,
					name:
						columns.find((column) => column.id === columnId)?.name ??
						'Bookmarks',
				};
			}

			const id = newId();
			await editIn(library, (current) =>
				addColumn(current, name, id, Date.now(), newIcon, newColor),
			);
			return {id, name};
		},
	};
}

export function ColumnChoice({
	choice,
}: {
	choice: ReturnType<typeof useColumnChoice>;
}) {
	const colors = useColors();
	const chipLook = useChipLook();
	return (
		<>
			<View style={styles.group}>
				<Text style={{color: colors.muted}}>Column</Text>
				<Chips
					items={[
						...choice.columns.map((column) => chipLook(column)),
						{id: NEW_COLUMN, name: 'New column', glyph: 'add'},
					]}
					selected={choice.creating ? NEW_COLUMN : choice.columnId}
					onSelect={choice.setPicked}
				/>
			</View>
			{choice.creating && (
				<View style={styles.group}>
					<Field
						label="Column name"
						icon={columnGlyph(choice.newIcon)}
						value={choice.newName}
						onChangeText={choice.setNewName}
					/>
					<IconPicker selected={choice.newIcon} onSelect={choice.setNewIcon} />
					<ColorPicker
						selected={choice.newColor}
						onSelect={choice.setNewColor}
					/>
				</View>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	group: {gap: 8},
});
