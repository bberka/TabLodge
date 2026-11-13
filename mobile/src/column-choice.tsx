import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {columnGlyph, useChipLook} from './column-icons';
import {IconPicker} from './icon-picker';
import {addColumn, columnViews, DEFAULT_COLUMN_ID} from './library';
import {edit, newId, useLibrary} from './library-store';
import {getPreferences} from './preferences';
import {useColors} from './theme';
import {Chips, Field} from './ui';

// The selector's last entry; choosing it asks for a name and an icon.
const NEW_COLUMN = '__new-column__';

/**
The state of a column selector: the existing columns plus a "New column" entry. `resolve` makes the new column when
that entry is chosen and returns where to save.
*/
export function useColumnChoice(initial = '') {
	const store = useLibrary();
	const columns = columnViews(store).filter((column) =>
		store.bookmarkColumns.some((own) => own.id === column.id),
	);
	const [picked, setPicked] = useState(initial);
	const [newName, setNewName] = useState('');
	const [newIcon, setNewIcon] = useState('');

	const creating = picked === NEW_COLUMN || columns.length === 0;
	const columnId = columns.some((column) => column.id === picked)
		? picked
		: (columns.find((column) => column.id === getPreferences().lastColumnId)
				?.id ??
			columns.find((column) => column.id === DEFAULT_COLUMN_ID)?.id ??
			columns[0]?.id ??
			DEFAULT_COLUMN_ID);

	return {
		columns,
		creating,
		columnId,
		setPicked,
		newName,
		setNewName,
		newIcon,
		setNewIcon,
		/**
		A new column was chosen but has no name yet.
		*/
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
			await edit((current) =>
				addColumn(current, name, id, Date.now(), newIcon),
			);
			return {id, name};
		},
	};
}

/**
The selector itself: column chips, and a name and icon only once "New column" is chosen.
*/
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
				</View>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	group: {gap: 8},
});
