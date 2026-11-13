import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {COLUMN_ICONS} from './column-icons';
import {TARGET, useColors} from './theme';
import {Icon} from './ui';

/**
A grid of the icons a bookmark column can have. Choosing the selected one again clears it.
*/
export function IconPicker({
	selected,
	onSelect,
}: {
	selected: string;
	onSelect: (id: string) => void;
}) {
	const colors = useColors();
	return (
		<ScrollView
			nestedScrollEnabled
			style={[styles.scroll, {borderColor: colors.border}]}
			keyboardShouldPersistTaps="handled"
		>
			<View accessibilityRole="radiogroup" style={styles.grid}>
				{COLUMN_ICONS.map(({id, glyph}) => {
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
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	scroll: {maxHeight: 188, borderWidth: 1, borderRadius: 12},
	grid: {flexDirection: 'row', flexWrap: 'wrap', padding: 4},
	cell: {
		width: TARGET,
		height: TARGET,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 12,
		borderWidth: 1,
	},
});
