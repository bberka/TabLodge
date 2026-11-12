import type {ReactNode} from 'react';
import {
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	type TextInputProps,
	View,
} from 'react-native';
import {TARGET, useColors} from './theme';

export function Button({
	label,
	onPress,
	kind = 'primary',
	disabled = false,
}: {
	label: string;
	onPress: () => void;
	kind?: 'primary' | 'plain' | 'danger';
	disabled?: boolean;
}) {
	const colors = useColors();
	const filled = kind === 'primary';
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{disabled}}
			disabled={disabled}
			style={[
				styles.button,
				{
					backgroundColor: filled ? colors.accent : 'transparent',
					borderColor: filled ? colors.accent : colors.border,
					opacity: disabled ? 0.5 : 1,
				},
			]}
			onPress={onPress}
		>
			<Text
				style={{
					color: filled
						? colors.onAccent
						: kind === 'danger'
							? colors.danger
							: colors.accent,
					fontWeight: '600',
					fontSize: 15,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

export function Field({label, ...props}: TextInputProps & {label: string}) {
	const colors = useColors();
	return (
		<View style={styles.field}>
			<Text style={[styles.label, {color: colors.muted}]}>{label}</Text>
			<TextInput
				accessibilityLabel={label}
				placeholderTextColor={colors.muted}
				style={[
					styles.input,
					{
						color: colors.text,
						borderColor: colors.border,
						backgroundColor: colors.surface,
					},
				]}
				{...props}
			/>
		</View>
	);
}

/**
A row of single choice chips, such as the bookmark columns.
*/
export function Chips({
	items,
	selected,
	onSelect,
}: {
	items: Array<{id: string; name: string}>;
	selected: string;
	onSelect: (id: string) => void;
}) {
	const colors = useColors();
	return (
		<View accessibilityRole="tablist" style={styles.chips}>
			{items.map((item) => {
				const on = item.id === selected;
				return (
					<Pressable
						key={item.id}
						accessibilityRole="tab"
						accessibilityState={{selected: on}}
						style={[
							styles.chip,
							{
								backgroundColor: on ? colors.accent : colors.surface,
								borderColor: on ? colors.accent : colors.border,
							},
						]}
						onPress={() => {
							onSelect(item.id);
						}}
					>
						<Text style={{color: on ? colors.onAccent : colors.text}}>
							{item.name}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

export function Empty({children}: {children: ReactNode}) {
	const colors = useColors();
	return <Text style={[styles.empty, {color: colors.muted}]}>{children}</Text>;
}

const styles = StyleSheet.create({
	button: {
		minHeight: TARGET,
		paddingHorizontal: 18,
		borderRadius: 24,
		borderWidth: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	field: {gap: 4},
	label: {fontSize: 13},
	input: {
		minHeight: TARGET,
		borderWidth: 1,
		borderRadius: 10,
		paddingHorizontal: 12,
		fontSize: 16,
	},
	chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
	chip: {
		minHeight: 40,
		paddingHorizontal: 14,
		borderRadius: 20,
		borderWidth: 1,
		justifyContent: 'center',
	},
	empty: {padding: 24, textAlign: 'center', fontSize: 15, lineHeight: 22},
});
