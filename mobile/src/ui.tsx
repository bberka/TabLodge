import {Ionicons} from '@expo/vector-icons';
import {type ComponentProps, type ReactNode, useState} from 'react';
import {
	ActivityIndicator,
	Platform,
	Pressable,
	StyleSheet,
	Switch as NativeSwitch,
	Text,
	TextInput,
	type TextInputProps,
	useColorScheme,
	View,
} from 'react-native';
import {avatarColor, TARGET, useColors, useShape} from './theme';

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
	const shape = useShape();
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
			android_ripple={shape.ios ? undefined : {color: `${ink}33`}}
			style={({pressed}) => [
				styles.button,
				{
					minHeight: shape.buttonHeight,
					borderRadius: shape.buttonRadius,
					backgroundColor: filled
						? colors.accent
						: pressed && !shape.ios
							? colors.pressed
							: 'transparent',
					// IOS plain buttons are bare text; Material ones are outlined.
					borderColor: filled || shape.ios ? 'transparent' : colors.border,
					opacity: disabled ? 0.4 : pressed && (filled || shape.ios) ? 0.6 : 1,
				},
			]}
			onPress={onPress}
		>
			{loading ? (
				<ActivityIndicator color={ink} />
			) : (
				icon && <Icon name={icon} size={20} color={ink} />
			)}
			<Text
				style={[
					styles.buttonLabel,
					{
						color: ink,
						fontSize: shape.ios ? 17 : 15,
						fontWeight: shape.ios && !filled ? '400' : '600',
					},
				]}
			>
				{label}
			</Text>
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
	const shape = useShape();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{disabled}}
			disabled={disabled}
			android_ripple={
				shape.ios ? undefined : {color: colors.pressed, radius: TARGET / 2}
			}
			style={({pressed}) => [
				styles.iconButton,
				{
					backgroundColor:
						pressed && !shape.ios ? colors.pressed : 'transparent',
					opacity: disabled ? 0.4 : pressed && shape.ios ? 0.5 : 1,
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
	const shape = useShape();
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
					shape.ios
						? {
								borderRadius: shape.fieldRadius,
								borderColor: error ? colors.danger : 'transparent',
								borderWidth: error ? 1 : 0,
								backgroundColor: colors.pressed,
							}
						: {
								borderRadius: shape.fieldRadius,
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
	const shape = useShape();
	return (
		<View accessibilityRole="tablist" style={styles.chips}>
			{items.map((item) => {
				const on = item.id === selected;
				return (
					<Pressable
						key={item.id}
						accessibilityRole="tab"
						accessibilityState={{selected: on}}
						android_ripple={shape.ios ? undefined : {color: colors.pressed}}
						style={({pressed}) => [
							styles.chip,
							{
								borderRadius: shape.chipRadius,
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
						{on && !shape.ios && (
							<Icon name="checkmark" size={16} color={colors.accent} />
						)}
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

/**
A rounded surface. With `flush`, its children run edge to edge and are clipped to the corners, so a pressable row
inside highlights the whole width.
*/
export function Card({
	children,
	flush = false,
}: {
	children: ReactNode;
	flush?: boolean;
}) {
	const colors = useColors();
	const shape = useShape();
	return (
		<View
			style={[
				styles.card,
				flush && styles.flush,
				{
					borderRadius: shape.cardRadius,
					backgroundColor: colors.surface,
					borderColor: shape.ios ? 'transparent' : colors.border,
				},
			]}
		>
			{children}
		</View>
	);
}

/**
A native-looking switch: the system one on Android, and a drawn iOS one (green track, white knob) when the app
imitates iOS, since React Native's Android switch cannot look like it.
*/
export function Switch({
	value,
	onValueChange,
	label,
}: {
	value: boolean;
	onValueChange: (value: boolean) => void;
	label: string;
}) {
	const colors = useColors();
	const shape = useShape();
	if (shape.ios && Platform.OS !== 'ios') {
		return (
			<Pressable
				accessibilityRole="switch"
				accessibilityLabel={label}
				accessibilityState={{checked: value}}
				style={[
					styles.iosTrack,
					{backgroundColor: value ? '#34c759' : colors.border},
				]}
				onPress={() => {
					onValueChange(!value);
				}}
			>
				<View
					style={[
						styles.iosKnob,
						{alignSelf: value ? 'flex-end' : 'flex-start'},
					]}
				/>
			</Pressable>
		);
	}

	return (
		<NativeSwitch
			accessibilityLabel={label}
			value={value}
			trackColor={{
				true: shape.ios ? '#34c759' : colors.accent,
				false: colors.border,
			}}
			thumbColor={
				Platform.OS === 'android'
					? value
						? colors.onAccent
						: colors.muted
					: undefined
			}
			onValueChange={onValueChange}
		/>
	);
}

/**
Pick one of a few options: a Material segmented button row, or an iOS segmented control.
*/
export function Segmented<T extends string>({
	items,
	selected,
	onSelect,
	label,
}: {
	items: Array<{id: T; name: string}>;
	selected: T;
	onSelect: (id: T) => void;
	label: string;
}) {
	const colors = useColors();
	const shape = useShape();
	return (
		<View
			accessibilityRole="radiogroup"
			accessibilityLabel={label}
			style={[
				styles.segmented,
				shape.ios
					? {backgroundColor: colors.pressed, borderRadius: 9, padding: 2}
					: {borderColor: colors.border, borderWidth: 1, borderRadius: 20},
			]}
		>
			{items.map((item) => {
				const on = item.id === selected;
				return (
					<Pressable
						key={item.id}
						accessibilityRole="radio"
						accessibilityState={{checked: on}}
						style={[
							styles.segment,
							{
								borderRadius: shape.ios ? 7 : 18,
								backgroundColor: on
									? shape.ios
										? colors.surface
										: colors.accentSoft
									: 'transparent',
							},
						]}
						onPress={() => {
							onSelect(item.id);
						}}
					>
						<Text
							style={{
								color: on && !shape.ios ? colors.accent : colors.text,
								fontWeight: on ? '600' : '400',
							}}
						>
							{item.name}
						</Text>
					</Pressable>
				);
			})}
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
	flush: {padding: 0, gap: 0, overflow: 'hidden'},
	iosTrack: {
		width: 51,
		height: 31,
		borderRadius: 16,
		padding: 2,
		justifyContent: 'center',
	},
	iosKnob: {
		width: 27,
		height: 27,
		borderRadius: 14,
		backgroundColor: '#ffffff',
		elevation: 2,
	},
	segmented: {flexDirection: 'row'},
	segment: {
		flex: 1,
		minHeight: 36,
		alignItems: 'center',
		justifyContent: 'center',
	},
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
