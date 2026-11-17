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

/**
Every round button in the row, and the search drawer, share this size, so the add, search and menu buttons read as one set.
*/
const SIZE = 52;

/**
The room a list leaves at its end so the round buttons, or the search bar that takes their place, never hide its last
row: the bar's height and the gap around it.
*/
export const ROOM_FOR_BUTTONS = SIZE + 24;

/**
Search that opens from a button. `open` and `query` belong to the screen, which filters its own page by `query`.
*/
export function useSearch() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	// A docked tab bar holds the search button itself, so the screen on show hands it what to do.
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
	/**
	Its width and height; an animated value follows the tab bar as it shrinks.
	*/
	size: Animated.Value | number;
	onPress: () => void;
}) {
	const colors = useColors();
	const glass = useGlass();
	// A shell that animates its size, with the pressable filling it, since a pressable's style cannot be animated.
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

/**
The row of round buttons in a screen's bottom right corner: search and add, each only when its handler is given. `bottom` is the room the tab bar takes.
*/
export function FloatingActions({
	bottom,
	onSearch,
	onAdd,
	buttonLabel = 'Add link',
}: {
	bottom: number;
	onSearch?: () => void;
	onAdd?: () => void;
	buttonLabel?: string;
}) {
	// With a floating tab bar the search button sits in its row, at the right edge, as tall as the bar, and the add
	// button stacks above it at the same size. Both follow the bar's height as it shrinks. With a docked bar they are
	// a row of smaller buttons above it.
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
	// With a docked bar, the search button is in the bar.
	const search = onSearch && floatingBar && (
		<RoundButton icon="search" label="Search" size={each} onPress={onSearch} />
	);
	const add = onAdd && (
		<RoundButton
			primary
			icon="add"
			label={buttonLabel}
			size={each}
			onPress={onAdd}
		/>
	);
	return (
		// Clear of the tab bar below, whose own shadow would otherwise reach the buttons.
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

/**
The search input, a rounded bar that floats above the tab bar with room on both sides, riding just above the keyboard
while it is open. Closing it clears the search.
*/
export function SearchDock({
	label,
	placeholder,
	bottom,
	query,
	onChange,
	onClose,
	onTips,
}: {
	label: string;
	placeholder: string;
	bottom: number;
	query: string;
	onChange: (query: string) => void;
	onClose: () => void;
	/**
	Shows a help button at the end of the field that opens the search tips.
	*/
	onTips?: () => void;
}) {
	const colors = useColors();
	const glassOn = useGlass();
	const keyboardOpen = useKeyboardHeight() > 0;
	const inset = keyboardInset();
	const insets = useSafeAreaInsets();
	const {barGap} = useShape();
	// A floating tab bar gets a floating, rounded search bar; a docked one gets a banner across the screen.
	const {floatingBar} = usePreferences();
	const {width: screenWidth} = useWindowDimensions();
	// The floating tab bar is gone while searching, so the bar sits at the screen's bottom; a docked bar stays below it.
	// The banner of a docked bar is an edge of the screen, so only the floating forms are glass.
	const glass = glassOn;
	const rest = floatingBar ? barGap + insets.bottom : bottom;
	return (
		<Animated.View
			style={[
				styles.dock,
				floatingBar ? styles.floating : styles.banner,
				{
					width: floatingBar ? screenWidth - 32 : screenWidth,
					bottom: keyboardOpen
						? Animated.add(inset, floatingBar ? 8 : 0)
						: rest,
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
