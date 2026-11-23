import {useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Pressable,
	StyleSheet,
	TextInput,
	useWindowDimensions,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {usePreferences} from '../settings/preferences';
import {GlassBackdrop, useGlass} from './glass';
import {keyboardInset, useKeyboardHeight} from './keyboard';
import {motion} from './motion';
import {useBackAction} from './back-actions';
import {setSearching, setSearchAction} from './search-action';
import {useBarHeight} from './tab-bar';
import {useColors, useShape} from './theme';
import {Icon, IconButton, type IconName} from './widgets';

const SIZE = 52;

export const ROOM_FOR_BUTTONS = SIZE + 24;

export function useSearch() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const {floatingBar} = usePreferences();
	useBackAction(open, () => {
		setOpen(false);
		setQuery('');
	});
	useEffect(() => {
		setSearching(open);
		return () => {
			setSearching(false);
		};
	}, [open]);
	useEffect(() => {
		if (floatingBar) {
			return;
		}

		setSearchAction(() => {
			setOpen(true);
		});
		return () => {
			setSearchAction(undefined);
		};
	}, [floatingBar]);
	return {
		open,
		query,
		setQuery,
		show() {
			setOpen(true);
		},
		close() {
			setOpen(false);
			setQuery('');
		},
	};
}

function RoundButton({
	icon,
	label,
	primary = false,
	size,
	onPress,
}: {
	icon: IconName;
	label: string;
	primary?: boolean;
	size: Animated.Value | number;
	onPress: () => void;
}) {
	const colors = useColors();
	const glass = useGlass();
	return (
		<Animated.View
			style={[
				styles.button,
				{
					width: size,
					height: size,
					borderRadius:
						typeof size === 'number' ? size / 2 : Animated.divide(size, 2),
					backgroundColor: glass
						? 'transparent'
						: primary
							? colors.accent
							: colors.surface,
					borderColor: colors.border,
					borderWidth: primary || glass ? 0 : 1,
				},
			]}
		>
			{glass && (
				<GlassBackdrop
					kind={primary ? 'primary' : 'button'}
					tint={primary ? colors.accent : undefined}
				/>
			)}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				style={({pressed}) => [
					styles.fill,
					pressed && {
						backgroundColor: primary ? 'rgba(0, 0, 0, 0.15)' : colors.pressed,
					},
				]}
				onPress={onPress}
			>
				<Icon
					name={icon}
					size={primary ? 28 : 24}
					color={primary ? colors.onAccent : colors.text}
				/>
			</Pressable>
		</Animated.View>
	);
}

export function FloatingActions({
	bottom,
	onSearch,
	onAdd,
	onUp,
	buttonLabel = 'Add link',
}: {
	bottom: number;
	onSearch?: () => void;
	onAdd?: () => void;
	onUp?: () => void;
	buttonLabel?: string;
}) {
	const {floatingBar} = usePreferences();
	const insets = useSafeAreaInsets();
	const {barGap} = useShape();
	const barHeight = useBarHeight();
	const size = useRef(new Animated.Value(barHeight)).current;
	useEffect(() => {
		Animated.timing(size, {
			toValue: barHeight,
			duration: motion(260),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: false,
		}).start();
	}, [barHeight, size]);
	const each = floatingBar ? size : SIZE;
	const search = onSearch && floatingBar && (
		<RoundButton icon="search" label="Search" size={each} onPress={onSearch} />
	);
	const add = onAdd && (
		<View style={styles.pair}>
			{onUp && (
				<RoundButton
					icon="arrow-up"
					label="Scroll to top"
					size={each}
					onPress={onUp}
				/>
			)}
			<RoundButton
				primary
				icon="add"
				label={buttonLabel}
				size={each}
				onPress={onAdd}
			/>
		</View>
	);
	return (
		<View
			pointerEvents="box-none"
			style={[
				styles.row,
				floatingBar
					? {
							bottom: barGap + insets.bottom,
							flexDirection: 'column',
							alignItems: 'flex-end',
						}
					: {bottom: bottom + 16},
			]}
		>
			{floatingBar ? (
				<>
					{add}
					{search}
				</>
			) : (
				<>
					{search}
					{add}
				</>
			)}
		</View>
	);
}

export function SearchDock({
	label,
	placeholder,
	bottom,
	query,
	onChange,
	onClose,
	onTips,
	onUp,
}: {
	label: string;
	placeholder: string;
	bottom: number;
	query: string;
	onChange: (query: string) => void;
	onClose: () => void;
	onTips?: () => void;
	onUp?: () => void;
}) {
	const colors = useColors();
	const glassOn = useGlass();
	const keyboardOpen = useKeyboardHeight() > 0;
	const inset = keyboardInset();
	const insets = useSafeAreaInsets();
	const {barGap} = useShape();
	const {floatingBar} = usePreferences();
	const {width: screenWidth} = useWindowDimensions();
	const glass = glassOn;
	const rest = floatingBar ? barGap + insets.bottom : bottom;
	const dockBottom = keyboardOpen
		? Animated.add(inset, floatingBar ? 8 : 0)
		: rest;
	return (
		<>
			{onUp && (
				<Animated.View
					pointerEvents="box-none"
					style={[styles.row, {bottom: Animated.add(dockBottom, SIZE + 12)}]}
				>
					<RoundButton
						icon="arrow-up"
						label="Scroll to top"
						size={SIZE}
						onPress={onUp}
					/>
				</Animated.View>
			)}
			<Animated.View
				style={[
					styles.dock,
					floatingBar ? styles.floating : styles.banner,
					{
						width: floatingBar ? screenWidth - 32 : screenWidth,
						bottom: dockBottom,
						backgroundColor: glass ? 'transparent' : colors.surface,
						borderColor: colors.border,
					},
					glass && styles.noBorder,
				]}
			>
				{glass && <GlassBackdrop kind="search" />}
				<Icon name="search" size={22} color={colors.muted} />
				<View style={styles.inputBox}>
					<TextInput
						autoFocus
						accessibilityLabel={label}
						placeholder={placeholder}
						placeholderTextColor={colors.muted}
						value={query}
						autoCapitalize="none"
						autoCorrect={false}
						returnKeyType="search"
						style={[styles.input, {color: colors.text}]}
						onChangeText={onChange}
					/>
				</View>
				{query !== '' && (
					<IconButton
						icon="close-circle"
						label="Clear search"
						color={colors.muted}
						onPress={() => {
							onChange('');
						}}
					/>
				)}
				{onTips && (
					<IconButton
						icon="help-circle-outline"
						label="Search tips"
						color={colors.muted}
						onPress={onTips}
					/>
				)}
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Close search"
					style={({pressed}) => [
						styles.close,
						pressed && {backgroundColor: colors.pressed},
					]}
					onPress={onClose}
				>
					<Icon name="chevron-down" color={colors.text} />
				</Pressable>
			</Animated.View>
		</>
	);
}

const styles = StyleSheet.create({
	row: {
		position: 'absolute',
		right: 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
	},
	pair: {flexDirection: 'row', alignItems: 'center', gap: 12},
	button: {overflow: 'hidden', elevation: 3},
	fill: {flex: 1, alignItems: 'center', justifyContent: 'center'},
	dock: {
		position: 'absolute',
		height: SIZE,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingLeft: 18,
		paddingRight: 4,
	},
	floating: {
		right: 16,
		overflow: 'hidden',
		borderRadius: SIZE / 2,
		borderWidth: 1,
		elevation: 6,
	},
	noBorder: {borderWidth: 0},
	banner: {
		left: 0,
		right: 0,
		borderTopWidth: StyleSheet.hairlineWidth,
		elevation: 6,
	},
	inputBox: {flex: 1},
	input: {fontSize: 16, paddingVertical: 0},
	close: {
		width: SIZE,
		height: SIZE,
		borderRadius: SIZE / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
});
