import {useState} from 'react';
import {
	Alert,
	type AlertButton,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {BottomSheet} from '../bottom-sheet';
import {ColorPicker} from '../color-picker';
import {columnGlyph} from '../column-icons';
import {IconPicker} from '../icon-picker';
import {
	addColumn,
	columnNameProblem,
	deleteColumn,
	updateColumn,
} from '../library';
import {edit, newId, useRegularLibrary} from '../library-store';
import {useColors} from '../theme';
import {Button, Field, IconButton} from '../ui';

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
	const store = useRegularLibrary();
	const [name, setName] = useState(column?.name ?? '');
	const [icon, setIcon] = useState(column?.icon ?? '');
	const [color, setColor] = useState(column?.color ?? '');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');
	// A name that is not allowed is only reported once it was typed, so an empty new form does not start in error.
	const nameProblem =
		name === '' && !column
			? undefined
			: columnNameProblem(store, name, column?.id);

	const save = async () => {
		if (columnNameProblem(store, name, column?.id)) {
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
		if (!column) {
			return;
		}

		const others = store.bookmarkColumns.filter(
			(entry) => entry.id !== column.id,
		);
		const count = store.bookmarks.filter(
			(bookmark) => bookmark.columnId === column.id,
		).length;
		const target = others.find((entry) => entry.isDefault) ?? others[0];
		const finish = async (moveTo: string | null) => {
			await edit((current) =>
				deleteColumn(current, column.id, moveTo, Date.now()),
			);
			onDone();
		};

		const noun = count === 1 ? 'bookmark' : 'bookmarks';
		const buttons: AlertButton[] = [{text: 'Cancel', style: 'cancel'}];
		if (count > 0 && target) {
			buttons.push({
				text: `Move ${count} to ${target.name}`,
				onPress: () => void finish(target.id),
			});
		}

		if (count > 0 && !target) {
			// The only column: its bookmarks have nowhere to go but the Unfiled bucket.
			buttons.push({
				text: `Keep ${count} unfiled`,
				onPress: () => void finish(''),
			});
		}

		buttons.push({
			text: count === 0 ? 'Delete' : `Delete ${count} ${noun}`,
			style: 'destructive',
			onPress: () => void finish(null),
		});

		Alert.alert(
			`Delete ${column.name}?`,
			count === 0
				? 'The column is empty.'
				: `It holds ${count} ${noun}. Move them to another column, or delete them with it.`,
			buttons,
		);
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{column ? 'Edit column' : 'New column'}
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
					disabled={Boolean(columnNameProblem(store, name, column?.id))}
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
