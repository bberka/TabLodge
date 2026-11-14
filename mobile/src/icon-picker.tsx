import {memo, useMemo, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {searchIconInfos} from '../../src/app/icon-meta';
import {BottomSheet} from './bottom-sheet';
import {columnGlyph} from './column-icons';
import {TARGET, useColors} from './theme';
import {Button, Empty, Field, Icon} from './ui';

const COLUMNS = 4;
const HEIGHT = 340;

const label = (id: string) => id.replaceAll('-', ' ');

/**
The icons that match a search, in rows, so the list draws the first few rows and the rest as they are scrolled to.
Drawing about a hundred buttons at once held up the drawer that shows them.
*/
function rowsFor(query: string) {
	const icons = searchIconInfos(query);
	return Array.from({length: Math.ceil(icons.length / COLUMNS)}, (_, row) =>
		icons.slice(row * COLUMNS, (row + 1) * COLUMNS),
	);
}

function IconSheet({
	visible,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	selected: string;
	onSelect: (id: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const [query, setQuery] = useState('');
	const rows = useMemo(() => rowsFor(query), [query]);
	return (
		<BottomSheet visible={visible} label="Choose an icon" onClose={onClose}>
			<View style={styles.sheet}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Choose an icon
				</Text>
				<Field
					label="Search icons"
					icon="search"
					placeholder="Name or topic, like work or travel"
					value={query}
					autoCapitalize="none"
					autoCorrect={false}
					onChangeText={setQuery}
					onClear={() => {
						setQuery('');
					}}
				/>
				{rows.length === 0 ? (
					<View style={styles.none}>
						<Empty icon="search" title="No icon matches">
							Try another word, or a topic such as travel or money.
						</Empty>
					</View>
				) : (
					<FlatList
						accessibilityRole="radiogroup"
						data={rows}
						extraData={selected}
						keyExtractor={(row) => row[0]?.id ?? ''}
						style={styles.list}
						keyboardShouldPersistTaps="handled"
						initialNumToRender={4}
						maxToRenderPerBatch={4}
						windowSize={5}
						renderItem={({item: row}) => (
							<View style={styles.row}>
								{row.map(({id}) => {
									const on = id === selected;
									return (
										<Pressable
											key={id}
											accessibilityRole="radio"
											accessibilityLabel={label(id)}
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
												onSelect(id);
												onClose();
											}}
										>
											<Icon
												name={columnGlyph(id)}
												size={24}
												color={on ? colors.accent : colors.text}
											/>
											<Text
												numberOfLines={1}
												style={[
													styles.name,
													{color: on ? colors.accent : colors.muted},
												]}
											>
												{label(id)}
											</Text>
										</Pressable>
									);
								})}
								{Array.from({length: COLUMNS - row.length}, (_, index) => (
									<View key={`gap-${index}`} style={styles.gap} />
								))}
							</View>
						)}
					/>
				)}
				{selected !== '' && (
					<Button
						kind="plain"
						label="Use the default icon"
						onPress={() => {
							onSelect('');
							onClose();
						}}
					/>
				)}
			</View>
		</BottomSheet>
	);
}

/**
A button showing the icon a column has, which opens a drawer to search the icons and choose one.
*/
function IconPickerView({
	selected,
	onSelect,
}: {
	selected: string;
	onSelect: (id: string) => void;
}) {
	const colors = useColors();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Icon, ${selected === '' ? 'default' : label(selected)}`}
				accessibilityHint="Opens a list of icons to search"
				android_ripple={{color: colors.pressed}}
				style={[styles.button, {borderColor: colors.border}]}
				onPress={() => {
					setOpen(true);
				}}
			>
				<Icon name={columnGlyph(selected)} size={24} color={colors.accent} />
				<Text style={[styles.value, {color: colors.text}]}>
					{selected === '' ? 'Default icon' : label(selected)}
				</Text>
				<Icon name="chevron-forward" size={18} color={colors.muted} />
			</Pressable>
			<IconSheet
				visible={open}
				selected={selected}
				onSelect={onSelect}
				onClose={() => {
					setOpen(false);
				}}
			/>
		</>
	);
}

// Typing in the name field must not draw the drawer again.
export const IconPicker = memo(IconPickerView);

const styles = StyleSheet.create({
	button: {
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingHorizontal: 14,
		borderWidth: 1,
		borderRadius: 12,
	},
	value: {flex: 1, fontSize: 16, textTransform: 'capitalize'},
	sheet: {gap: 12, paddingHorizontal: 20, paddingBottom: 8},
	title: {fontSize: 20, fontWeight: '700'},
	// A fixed height, so the drawer is the same size before the rows are drawn and after.
	list: {height: HEIGHT, flexGrow: 0},
	none: {height: HEIGHT},
	row: {flexDirection: 'row'},
	cell: {
		flex: 1,
		height: 68,
		gap: 4,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 12,
		borderWidth: 1,
		paddingHorizontal: 2,
	},
	gap: {flex: 1, height: 68},
	name: {fontSize: 11, textTransform: 'capitalize'},
});
