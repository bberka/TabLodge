import {useState} from 'react';
import {Animated, Pressable, StyleSheet, TextInput, View} from 'react-native';
import {usePreferences} from '../settings/preferences';
import {keyboardInset, useKeyboardHeight} from './keyboard';
import {useColors} from './theme';
import {Icon, IconButton, type IconName} from './ui';

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
The row of round buttons in a screen's bottom right corner: the menu, search, and add, each only when its handler is
given. `bottom` is the room the tab bar takes.
*/
export function FloatingActions({
	bottom,
	onMenu,
	onSearch,
	onAdd,
	buttonLabel = 'Add link',
}: {
	bottom: number;
	onMenu?: () => void;
	onSearch?: () => void;
	onAdd?: () => void;
	buttonLabel?: string;
}) {
	return (
		// Clear of the tab bar below, whose own shadow would otherwise reach the buttons.
		<View pointerEvents="box-none" style={[styles.row, {bottom: bottom + 16}]}>
			{onMenu && (
				<RoundButton
					icon="ellipsis-horizontal"
					label="More actions"
					onPress={onMenu}
				/>
			)}
			{onSearch && (
				<RoundButton icon="search" label="Search" onPress={onSearch} />
			)}
			{onAdd && (
				<RoundButton primary icon="add" label={buttonLabel} onPress={onAdd} />
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
	return (
		<Animated.View
			style={[
				styles.dock,
				floatingBar ? styles.floating : styles.banner,
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
		left: 16,
		right: 16,
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
	input: {flex: 1, fontSize: 16, paddingVertical: 0},
	close: {
		width: SIZE,
		height: SIZE,
		borderRadius: SIZE / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
});
