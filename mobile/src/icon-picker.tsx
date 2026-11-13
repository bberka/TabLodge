import {memo} from 'react';
import {FlatList, Pressable, StyleSheet, View} from 'react-native';
import {COLUMN_ICONS} from './column-icons';
import {TARGET, useColors} from './theme';
import {Icon} from './ui';

const COLUMNS = 7;
const HEIGHT = 188;

// The icons in rows, so the list can draw the first few rows only and the rest as they are scrolled to. Drawing about a
// hundred buttons at once held up the drawer that shows them.
const ROWS = Array.from(
	{length: Math.ceil(COLUMN_ICONS.length / COLUMNS)},
	(_, row) => COLUMN_ICONS.slice(row * COLUMNS, (row + 1) * COLUMNS),
);

/**
A grid of the icons a bookmark column can have. Choosing the selected one again clears it.
*/
function IconPickerView({
	selected,
	onSelect,
}: {
	selected: string;
	onSelect: (id: string) => void;
}) {
	const colors = useColors();
	return (
		<FlatList
			nestedScrollEnabled
			accessibilityRole="radiogroup"
			data={ROWS}
			extraData={selected}
			keyExtractor={(row) => row[0]?.id ?? ''}
			style={[styles.list, {borderColor: colors.border}]}
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
			initialNumToRender={3}
			maxToRenderPerBatch={3}
			windowSize={5}
			renderItem={({item: row}) => (
				<View style={styles.row}>
					{row.map(({id, glyph}) => {
						const on = id === selected;
						return (
							<Pressable
								key={id}
								accessibilityRole="radio"
								accessibilityLabel={id.replaceAll('-', ' ')}
								accessibilityState={{selected: on}}
								style={({pressed}) => [
									styles.cell,
									{
										backgroundColor: on
											? colors.accentSoft
											: pressed
												? colors.pressed
												: 'transparent',
										borderColor: on ? colors.accent : 'transparent',
									},
								]}
								onPress={() => {
									onSelect(on ? '' : id);
								}}
							>
								<Icon
									name={glyph}
									size={22}
									color={on ? colors.accent : colors.text}
								/>
							</Pressable>
						);
					})}
					{Array.from({length: COLUMNS - row.length}, (_, index) => (
						<View key={`gap-${index}`} style={styles.cell} />
					))}
				</View>
			)}
		/>
	);
}

// Typing in the name field must not draw the grid again.
export const IconPicker = memo(IconPickerView);

const styles = StyleSheet.create({
	// A fixed height, so the drawer is the same size before the rows are drawn and after.
	list: {height: HEIGHT, flexGrow: 0, borderWidth: 1, borderRadius: 12},
	content: {padding: 4},
	row: {flexDirection: 'row'},
	cell: {
		flex: 1,
		height: TARGET,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 12,
		borderWidth: 1,
	},
});
