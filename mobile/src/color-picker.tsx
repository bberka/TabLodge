import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ACCENTS, isColumnColor} from '../../src/shared/accent-colors';
import {TARGET, useColors} from './theme';
import {Field, Icon} from './ui';

const SWATCH = 40;
const HEX = /^#[\da-f]{6}$/i;

/**
The colors a bookmark column can have: the extension's accent palette, plus any `#rrggbb`. Choosing the selected one
again, or None, clears it. The value is a preset id or a lower case hex, the same text the extension stores.
*/
export function ColorPicker({
	selected,
	onSelect,
}: {
	selected: string;
	onSelect: (color: string) => void;
}) {
	const colors = useColors();
	const [typed, setTyped] = useState(() =>
		isColumnColor(selected) && selected.startsWith('#') ? selected : '',
	);
	const custom = typed !== '' && !HEX.test(typed);
	return (
		<View style={styles.group}>
			<View accessibilityRole="radiogroup" style={styles.swatches}>
				<Pressable
					accessibilityRole="radio"
					accessibilityLabel="No color"
					accessibilityState={{selected: selected === ''}}
					hitSlop={4}
					style={[
						styles.swatch,
						{
							borderColor: selected === '' ? colors.accent : colors.border,
							backgroundColor: colors.surface,
						},
					]}
					onPress={() => {
						setTyped('');
						onSelect('');
					}}
				>
					<Icon name="ban-outline" size={20} color={colors.muted} />
				</Pressable>
				{ACCENTS.map((accent) => {
					const on = selected === accent.id;
					return (
						<Pressable
							key={accent.id}
							accessibilityRole="radio"
							accessibilityLabel={accent.label}
							accessibilityState={{selected: on}}
							hitSlop={4}
							style={[
								styles.swatch,
								{
									backgroundColor: accent.hex,
									borderColor: on ? colors.text : 'transparent',
								},
							]}
							onPress={() => {
								setTyped('');
								onSelect(on ? '' : accent.id);
							}}
						>
							{on && <Icon name="checkmark" size={20} color="#ffffff" />}
						</Pressable>
					);
				})}
			</View>
			<Field
				label="Custom color"
				placeholder="#6254d7"
				value={typed}
				autoCapitalize="none"
				autoCorrect={false}
				maxLength={7}
				error={custom ? 'Use a color like #6254d7.' : undefined}
				onChangeText={(text) => {
					const value = text.startsWith('#') || text === '' ? text : `#${text}`;
					setTyped(value);
					if (HEX.test(value)) {
						onSelect(value.toLowerCase());
					}
				}}
			/>
			{typed === '' && selected !== '' && !isColumnColor(selected) && (
				<Text style={{color: colors.muted}}>This color is not available.</Text>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	group: {gap: 12},
	swatches: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
	swatch: {
		width: Math.max(SWATCH, TARGET - 8),
		height: Math.max(SWATCH, TARGET - 8),
		borderRadius: 999,
		borderWidth: 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
});
