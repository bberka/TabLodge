import {type ComponentRef, useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Pressable,
	StyleSheet,
	TextInput,
	useWindowDimensions,
} from 'react-native';
import {usePreferences} from '../settings/preferences';
import {keyboardInset, useKeyboardHeight} from './keyboard';
import {motion} from './motion';
import {useColors} from './theme';
import {useScrolledDown} from './scroll-state';
import {useBarDrop} from './tab-bar';
import {Icon, IconButton, type IconName} from './ui';

/**
Every round button in the row, and the search drawer, share this size, so the add, search and menu buttons read as one set.
*/
const SIZE = 52;
// The floating search bar when it has shrunk: the search icon and the close arrow.
const SMALL_SEARCH_WIDTH = 120;

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
	onPress,
}: {
	icon: IconName;
	label: string;
	primary?: boolean;
	onPress: () => void;
}) {
	const colors = useColors();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			style={({pressed}) => [
				styles.button,
				primary
					? {
							backgroundColor: colors.accent,
							opacity: pressed ? 0.85 : 1,
						}
					: {
							backgroundColor: pressed ? colors.pressed : colors.surface,
							borderColor: colors.border,
							borderWidth: 1,
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
	// The row eases down with the tab bar when that shrinks, instead of staying high above it.
	const drop = useBarDrop();
	const shift = useRef(new Animated.Value(drop)).current;
	useEffect(() => {
		Animated.timing(shift, {
			toValue: drop,
			duration: motion(260),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: true,
		}).start();
	}, [drop, shift]);
	return (
		// Clear of the tab bar below, whose own shadow would otherwise reach the buttons.
		<Animated.View
			pointerEvents="box-none"
			style={[
				styles.row,
				{bottom: bottom + 16, transform: [{translateY: shift}]},
			]}
		>
			{onSearch && (
				<RoundButton icon="search" label="Search" onPress={onSearch} />
			)}
			{onAdd && (
				<RoundButton primary icon="add" label={buttonLabel} onPress={onAdd} />
			)}
		</Animated.View>
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
}: {
	label: string;
	placeholder: string;
	bottom: number;
	query: string;
	onChange: (query: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const keyboardOpen = useKeyboardHeight() > 0;
	const inset = keyboardInset();
	// A floating tab bar gets a floating, rounded search bar; a docked one gets a banner across the screen.
	const {floatingBar} = usePreferences();
	// While the page scrolls and the input has no focus, the floating bar shrinks to a small pill, as the tab bar does.
	const {width: screenWidth} = useWindowDimensions();
	const scrolledDown = useScrolledDown();
	const [focused, setFocused] = useState(true);
	const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
	// Android keeps an input focused after Back hides the keyboard, so a closed keyboard counts as no focus too.
	const idle = !focused || !keyboardOpen;
	const small = floatingBar && scrolledDown && idle && query === '';
	const shrink = useRef(new Animated.Value(small ? 1 : 0)).current;
	useEffect(() => {
		Animated.timing(shrink, {
			toValue: small ? 1 : 0,
			duration: motion(260),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: false,
		}).start();
	}, [small, shrink]);
	return (
		<Animated.View
			style={[
				styles.dock,
				floatingBar ? styles.floating : styles.banner,
				floatingBar && {
					width: shrink.interpolate({
						inputRange: [0, 1],
						outputRange: [screenWidth - 32, SMALL_SEARCH_WIDTH],
					}),
				},
				{
					bottom: floatingBar
						? keyboardOpen
							? Animated.add(inset, 8)
							: bottom + 8
						: keyboardOpen
							? inset
							: bottom,
					backgroundColor: colors.surface,
					borderColor: colors.border,
				},
			]}
		>
			<Icon name="search" size={22} color={colors.muted} />
			<Animated.View
				style={[
					styles.inputBox,
					{
						opacity: shrink.interpolate({
							inputRange: [0, 1],
							outputRange: [1, 0],
						}),
					},
				]}
			>
				<TextInput
					ref={inputRef}
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
					onFocus={() => {
						setFocused(true);
					}}
					onBlur={() => {
						setFocused(false);
					}}
				/>
			</Animated.View>
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
			{small && (
				// The small pill opens the full bar again and puts the cursor back in it.
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`${label}, expand`}
					style={styles.expand}
					onPress={() => {
						// Blurred first, so an input that kept its focus shows the keyboard again.
						inputRef.current?.blur();
						inputRef.current?.focus();
					}}
				/>
			)}
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
	button: {
		width: SIZE,
		height: SIZE,
		borderRadius: SIZE / 2,
		alignItems: 'center',
		justifyContent: 'center',
		elevation: 3,
	},
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
	banner: {
		left: 0,
		right: 0,
		borderTopWidth: StyleSheet.hairlineWidth,
		elevation: 6,
	},
	inputBox: {flex: 1},
	input: {fontSize: 16, paddingVertical: 0},
	expand: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0},
	close: {
		width: SIZE,
		height: SIZE,
		borderRadius: SIZE / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
});
