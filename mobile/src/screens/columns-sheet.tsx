import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../bottom-sheet';
import {columnGlyph, useChipLook} from '../column-icons';
import {moveColumn} from '../library';
import {edit, useRegularLibrary} from '../library-store';
import {soften, TARGET, useColors} from '../theme';
import {Button, Icon, IconButton} from '../ui';

export type ColumnRow = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	count: number;
};

/**
Every column in one list, so they can be opened, put in order, and changed without scrolling the chips. Tapping a row
shows that column; the arrows move it one place; the pencil opens its form.
*/
export function ColumnsSheet({
	visible,
	columns,
	selected,
	onClose,
	onPick,
	onEdit,
	onNew,
}: {
	visible: boolean;
	columns: ColumnRow[];
	selected: string;
	onClose: () => void;
	onPick: (id: string) => void;
	onEdit: (id: string) => void;
	onNew: () => void;
}) {
	const colors = useColors();
	const chipLook = useChipLook();
	const store = useRegularLibrary();
	const real = new Set(store.bookmarkColumns.map((column) => column.id));
	return (
		<BottomSheet visible={visible} label="Columns" onClose={onClose}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Columns
				</Text>
				<IconButton icon="close" label="Close" onPress={onClose} />
			</View>
			<ScrollView
				style={styles.list}
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled"
			>
				{columns.map((column, index) => {
					const look = chipLook(column);
					const own = real.has(column.id);
					const position = store.bookmarkColumns.findIndex(
						(entry) => entry.id === column.id,
					);
					return (
						<View key={column.id} style={styles.row}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`${column.name}, ${column.count} ${column.count === 1 ? 'bookmark' : 'bookmarks'}${column.id === selected ? ', showing' : ''}`}
								accessibilityHint="Shows this column"
								android_ripple={{color: colors.pressed}}
								style={styles.main}
								onPress={() => {
									onPick(column.id);
									onClose();
								}}
							>
								<View
									style={[styles.tile, {backgroundColor: soften(look.tint)}]}
								>
									<Icon
										name={columnGlyph(column.icon)}
										size={22}
										color={look.tint}
									/>
								</View>
								<View style={styles.texts}>
									<Text
										numberOfLines={1}
										style={{
											color: colors.text,
											fontWeight: column.id === selected ? '700' : '400',
										}}
									>
										{column.name}
									</Text>
									<Text style={{color: colors.muted, fontSize: 13}}>
										{column.count}{' '}
										{column.count === 1 ? 'bookmark' : 'bookmarks'}
									</Text>
								</View>
							</Pressable>
							{own && (
								<>
									<IconButton
										icon="chevron-up"
										label={`Move ${column.name} earlier`}
										disabled={position <= 0}
										onPress={() => {
											void edit((current) =>
												moveColumn(current, column.id, -1, Date.now()),
											);
										}}
									/>
									<IconButton
										icon="chevron-down"
										label={`Move ${column.name} later`}
										disabled={index >= store.bookmarkColumns.length - 1}
										onPress={() => {
											void edit((current) =>
												moveColumn(current, column.id, 1, Date.now()),
											);
										}}
									/>
									<IconButton
										icon="create-outline"
										label={`Edit ${column.name}`}
										onPress={() => {
											onEdit(column.id);
										}}
									/>
								</>
							)}
						</View>
					);
				})}
			</ScrollView>
			<View style={styles.footer}>
				<Button label="New column" icon="add" onPress={onNew} />
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	top: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {fontSize: 20, fontWeight: '700'},
	list: {flexGrow: 0},
	content: {paddingHorizontal: 12, paddingVertical: 4},
	row: {flexDirection: 'row', alignItems: 'center'},
	main: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: TARGET + 8,
		paddingHorizontal: 8,
		borderRadius: 12,
	},
	tile: {
		width: 40,
		height: 40,
		borderRadius: 12,
		alignItems: 'center',
		justifyContent: 'center',
	},
	texts: {flex: 1},
	footer: {paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8},
});
