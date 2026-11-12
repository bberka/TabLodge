import {Ionicons} from '@expo/vector-icons';
import {type ComponentProps, type ReactNode, useState} from 'react';
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	type TextInputProps,
	useColorScheme,
	View,
} from 'react-native';
import {avatarColor, TARGET, useColors} from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
	name,
	size = 22,
	color,
}: {
	name: IconName;
	size?: number;
	color?: string;
}) {
	const colors = useColors();
	return <Ionicons name={name} size={size} color={color ?? colors.text} />;
}

export function Button({
	label,
	onPress,
	kind = 'primary',
	icon,
	disabled = false,
	loading = false,
}: {
	label: string;
	onPress: () => void;
	kind?: 'primary' | 'plain' | 'danger';
	icon?: IconName;
	disabled?: boolean;
	loading?: boolean;
}) {
	const colors = useColors();
	const inactive = disabled || loading;
	const filled = kind === 'primary';
	const ink = filled
		? colors.onAccent
		: kind === 'danger'
			? colors.danger
			: colors.accent;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{disabled: inactive, busy: loading}}
			disabled={inactive}
			android_ripple={{color: `${ink}33`}}
			style={({pressed}) => [
				styles.button,
				{
					backgroundColor: filled
						? colors.accent
						: pressed
							? colors.pressed
							: 'transparent',
					borderColor: filled ? colors.accent : colors.border,
					opacity: disabled ? 0.45 : pressed && filled ? 0.85 : 1,
				},
			]}
			onPress={onPress}
		>
			{loading ? (
				<ActivityIndicator color={ink} />
			) : (
				icon && <Icon name={icon} size={20} color={ink} />
			)}
			<Text style={[styles.buttonLabel, {color: ink}]}>{label}</Text>
		</Pressable>
	);
}

export function IconButton({
	icon,
	label,
	onPress,
	color,
	disabled = false,
}: {
	icon: IconName;
	label: string;
	onPress: () => void;
	color?: string;
	disabled?: boolean;
}) {
	const colors = useColors();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{disabled}}
			disabled={disabled}
			android_ripple={{color: colors.pressed, radius: TARGET / 2}}
			style={({pressed}) => [
				styles.iconButton,
				{
					backgroundColor: pressed ? colors.pressed : 'transparent',
					opacity: disabled ? 0.45 : 1,
				},
			]}
			onPress={onPress}
		>
			<Icon name={icon} color={color} />
		</Pressable>
	);
}

export function Field({
	label,
	icon,
	error,
	onClear,
	...props
}: TextInputProps & {
	label: string;
	icon?: IconName;
	error?: string;
	onClear?: () => void;
}) {
	const colors = useColors();
	const [focused, setFocused] = useState(false);
	const border = error
		? colors.danger
		: focused
			? colors.accent
			: colors.border;
	return (
		<View style={styles.field}>
			<Text
				style={[styles.label, {color: error ? colors.danger : colors.muted}]}
			>
				{label}
			</Text>
			<View
				style={[
					styles.inputBox,
					{
						borderColor: border,
						borderWidth: focused || error ? 2 : 1,
						backgroundColor: colors.surface,
					},
				]}
			>
				{icon && <Icon name={icon} size={20} color={colors.muted} />}
				<TextInput
					accessibilityLabel={label}
					placeholderTextColor={colors.muted}
					style={[styles.input, {color: colors.text}]}
					onFocus={() => {
						setFocused(true);
					}}
					onBlur={() => {
						setFocused(false);
					}}
					{...props}
				/>
				{onClear && Boolean(props.value) && (
					<IconButton
						icon="close-circle"
						label={`Clear ${label}`}
						onPress={onClear}
					/>
				)}
			</View>
			{error && (
				<Text
					accessibilityLiveRegion="polite"
					style={{color: colors.danger, fontSize: 13}}
				>
					{error}
				</Text>
			)}
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
	items: Array<{id: string; name: string; count?: number}>;
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
						android_ripple={{color: colors.pressed}}
						style={({pressed}) => [
							styles.chip,
							{
								backgroundColor: on
									? colors.accentSoft
									: pressed
										? colors.pressed
										: colors.surface,
								borderColor: on ? colors.accent : colors.border,
							},
						]}
						onPress={() => {
							onSelect(item.id);
						}}
					>
						{on && <Icon name="checkmark" size={16} color={colors.accent} />}
						<Text
							style={{
								color: on ? colors.accent : colors.text,
								fontWeight: on ? '600' : '400',
							}}
						>
							{item.name}
							{item.count === undefined ? '' : `  ${item.count}`}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/**
A round letter badge for a site, in a color taken from its host name.
*/
export function Avatar({host, size = 40}: {host: string; size?: number}) {
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[
				styles.avatar,
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: avatarColor(host, scheme),
				},
			]}
		>
			<Text
				style={{color: '#ffffff', fontWeight: '700', fontSize: size * 0.42}}
			>
				{(/[\da-z]/i.exec(host)?.[0] ?? '?').toUpperCase()}
			</Text>
		</View>
	);
}

export function Header({
	title,
	subtitle,
	right,
}: {
	title: string;
	subtitle?: string;
	right?: ReactNode;
}) {
	const colors = useColors();
	return (
		<View style={styles.header}>
			<View style={styles.headerText}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{title}
				</Text>
				{subtitle && <Text style={{color: colors.muted}}>{subtitle}</Text>}
			</View>
			{right}
		</View>
	);
}

export function Card({children}: {children: ReactNode}) {
	const colors = useColors();
	return (
		<View
			style={[
				styles.card,
				{backgroundColor: colors.surface, borderColor: colors.border},
			]}
		>
			{children}
		</View>
	);
}

export function Empty({
	icon,
	title,
	children,
	action,
}: {
	icon: IconName;
	title: string;
	children?: ReactNode;
	action?: ReactNode;
}) {
	const colors = useColors();
	return (
		<View style={styles.empty}>
			<View style={[styles.emptyIcon, {backgroundColor: colors.accentSoft}]}>
				<Icon name={icon} size={32} color={colors.accent} />
			</View>
			<Text style={[styles.emptyTitle, {color: colors.text}]}>{title}</Text>
			{children === undefined ? null : (
				<Text style={[styles.emptyText, {color: colors.muted}]}>
					{children}
				</Text>
			)}
			{action}
		</View>
	);
}

const styles = StyleSheet.create({
	button: {
		minHeight: TARGET,
		paddingHorizontal: 20,
		borderRadius: 24,
		borderWidth: 1,
		flexDirection: 'row',
		gap: 8,
		alignItems: 'center',
		justifyContent: 'center',
		overflow: 'hidden',
	},
	buttonLabel: {fontWeight: '600', fontSize: 15},
	iconButton: {
		width: TARGET,
		height: TARGET,
		borderRadius: TARGET / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
	field: {gap: 4},
	label: {fontSize: 13},
	inputBox: {
		minHeight: TARGET,
		borderRadius: 12,
		paddingHorizontal: 12,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	input: {flex: 1, fontSize: 16, minHeight: TARGET},
	chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
	chip: {
		minHeight: 40,
		paddingHorizontal: 14,
		borderRadius: 20,
		borderWidth: 1,
		flexDirection: 'row',
		gap: 6,
		alignItems: 'center',
		overflow: 'hidden',
	},
	avatar: {alignItems: 'center', justifyContent: 'center'},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 8,
		gap: 8,
	},
	headerText: {flex: 1, gap: 2},
	title: {fontSize: 26, fontWeight: '700'},
	card: {borderWidth: 1, borderRadius: 16, padding: 16, gap: 12},
	empty: {padding: 32, alignItems: 'center', gap: 12},
	emptyIcon: {
		width: 72,
		height: 72,
		borderRadius: 36,
		alignItems: 'center',
		justifyContent: 'center',
	},
	emptyTitle: {fontSize: 18, fontWeight: '600', textAlign: 'center'},
	emptyText: {textAlign: 'center', fontSize: 15, lineHeight: 22},
});
