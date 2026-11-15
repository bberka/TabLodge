import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {columnNameProblem} from '../../../../extension/src/shared/bookmark-rules';
import type {Store} from '../../../../extension/src/shared/types';
import {BottomSheet, SheetHeader} from '../../ui/bottom-sheet';
import {ColorPicker} from '../../ui/color-picker';
import {columnGlyph} from '../../ui/column-icons';
import {IconPicker} from '../../ui/icon-picker';
import {
	addColumn,
	deleteColumn,
	restoreColumn,
	updateColumn,
} from '../../library/library';
import {showSnack} from '../../ui/snackbar';
import {edit, newId, useLibrary} from '../../library/library-store';
import {trashDeleted} from '../../library/trash-store';
import {useColors} from '../../ui/theme';
import {Button, Field} from '../../ui/ui';

/**
Deletes a column at once and offers Undo. Its bookmarks move to another column; with no other column they stay unfiled.
`onDeleted` runs right after.
*/
export function confirmDeleteColumn(
	store: Store,
	column: {id: string; name: string},
	onDeleted: () => void,
): void {
	const whole = store.bookmarkColumns.find((entry) => entry.id === column.id);
	if (!whole) {
		return;
	}

	const own = store.bookmarks.filter(
		(bookmark) => bookmark.columnId === column.id,
	);
	const others = store.bookmarkColumns.filter(
		(entry) => entry.id !== column.id,
	);
	const target = others.find((entry) => entry.isDefault) ?? others[0];
	void edit((current) =>
		deleteColumn(current, column.id, target?.id ?? '', Date.now()),
	);
	void trashDeleted([{kind: 'column', column: whole, bookmarks: own}]);
	onDeleted();
	showSnack(`Deleted ${column.name}`, {
		label: 'Undo',
		run() {
			void edit((current) => restoreColumn(current, whole, own, Date.now()));
		},
	});
}

type Editing = {id: string; name: string; icon?: string; color?: string};

function ColumnForm({
	column,
	onDone,
}: {
	/**
	The column to change, or nothing to make a new one.
	*/
	column?: Editing;
	/**
	Called when the drawer should close; `id` is the column that was made or changed.
	*/
	onDone: (id?: string) => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const [name, setName] = useState(column?.name ?? '');
	const [icon, setIcon] = useState(column?.icon ?? '');
	const [color, setColor] = useState(column?.color ?? '');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');
	// A name that is not allowed is only reported once it was typed, so an empty new form does not start in error.
	const nameProblem =
		name === '' && !column
			? undefined
			: columnNameProblem(store.bookmarkColumns, name, column?.id);

	const save = async () => {
		if (columnNameProblem(store.bookmarkColumns, name, column?.id)) {
			return;
		}

		setSaving(true);
		setProblem('');
		try {
			const id = column?.id ?? newId();
			await edit((current) =>
				column
					? updateColumn(current, id, {name, icon, color}, Date.now())
					: addColumn(current, name, id, Date.now(), icon, color),
			);
			onDone(id);
		} catch {
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	const remove = () => {
		if (column) {
			confirmDeleteColumn(store, column, onDone);
		}
	};

	return (
		<View style={styles.screen}>
			<SheetHeader
				title={column ? 'Edit column' : 'New column'}
				onClose={() => {
					onDone();
				}}
			/>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				<Field
					label="Name"
					icon={columnGlyph(icon)}
					value={name}
					maxLength={60}
					error={nameProblem}
					onChangeText={setName}
				/>
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>Icon</Text>
					<IconPicker selected={icon} onSelect={setIcon} />
				</View>
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>Color</Text>
					<ColorPicker selected={color} onSelect={setColor} />
				</View>
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={Boolean(
						columnNameProblem(store.bookmarkColumns, name, column?.id),
					)}
					loading={saving}
					onPress={() => void save()}
				/>
				{column && (
					<Button
						label="Delete column"
						kind="danger"
						icon="trash-outline"
						onPress={remove}
					/>
				)}
			</ScrollView>
		</View>
	);
}

/**
The drawer for making a bookmark column, or changing one's name, icon, and color, or deleting it. Pass the column to
change, or nothing for a new one.
*/
export function ColumnSheet({
	visible,
	column,
	onClose,
}: {
	visible: boolean;
	column?: Editing;
	onClose: (id?: string) => void;
}) {
	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label={column ? 'Edit column' : 'New column'}
			onClose={() => {
				onClose();
			}}
		>
			{visible && (
				<ColumnForm
					key={column?.id ?? 'new'}
					column={column}
					onDone={onClose}
				/>
			)}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	screen: {flexShrink: 1},
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
});
