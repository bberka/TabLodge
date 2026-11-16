import {useEffect, useRef, type ReactNode} from 'react';
import {
	Animated,
	Easing,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {motion} from './motion';
import {soften, TARGET, useColors, useShape} from './theme';
import {Icon, type IconName} from './widgets';

/**
One column or folder as the list view draws it.
*/
export type FolderEntry = {
	id: string;
	name: string;
	count: number;
	glyph: IconName;
	tint: string;
};

/**
The look every row shares: a bordered pill that darkens while pressed, or takes the given fill.
*/
function useRowStyle() {
	const colors = useColors();
	const shape = useShape();
	return (pressed: boolean, fill?: string, border?: string) => [
		styles.row,
		{
			borderRadius: shape.chipRadius,
			borderColor: border ?? colors.border,
			backgroundColor: pressed ? colors.pressed : (fill ?? colors.surface),
		},
	];
}

/**
Slides its content in from the side it is given, so the list arrives from the left (as if coming back) and an opened
folder's bar from the right.
*/
function SlideIn({
	from,
	children,
}: {
	from: 'left' | 'right';
	children: ReactNode;
}) {
	const shift = useRef(new Animated.Value(from === 'left' ? -28 : 28)).current;
	useEffect(() => {
		Animated.timing(shift, {
			toValue: 0,
			duration: motion(240),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: true,
		}).start();
	}, [shift]);
	return (
		<Animated.View style={{transform: [{translateX: shift}]}}>
			{children}
		</Animated.View>
	);
}

const countLabel = (entry: FolderEntry, noun: string) =>
	`${entry.count} ${entry.count === 1 ? noun : `${noun}s`}`;

/**
Every column or folder as one row each, with its icon, name, and count, ending in a row that makes a new one. Tapping a
row opens it, and holding it asks for its menu.
*/
export function FolderList({
	entries,
	noun,
	newLabel,
	onOpen,
	onNew,
	onMenu,
}: {
	entries: FolderEntry[];
	/**
	What the entries hold, singular: bookmark or session.
	*/
	noun: string;
	newLabel: string;
	onOpen: (id: string) => void;
	onNew: () => void;
	onMenu: (id: string) => void;
}) {
	const colors = useColors();
	const rowStyle = useRowStyle();
	return (
		<SlideIn from="left">
			<View style={styles.list}>
				{entries.map((entry) => (
					<Pressable
						key={entry.id}
						accessibilityRole="button"
						accessibilityLabel={`${entry.name}, ${countLabel(entry, noun)}`}
						accessibilityHint="Opens it"
						accessibilityActions={[{name: 'more', label: 'More actions'}]}
						style={({pressed}) => rowStyle(pressed)}
						onAccessibilityAction={() => {
							onMenu(entry.id);
						}}
						onLongPress={() => {
							onMenu(entry.id);
						}}
						onPress={() => {
							onOpen(entry.id);
						}}
					>
						<View style={[styles.tile, {backgroundColor: soften(entry.tint)}]}>
							<Icon name={entry.glyph} size={20} color={entry.tint} />
						</View>
						<Text numberOfLines={1} style={[styles.name, {color: colors.text}]}>
							{entry.name}
						</Text>
						<Text style={{color: colors.muted}}>{entry.count}</Text>
						<Icon name="chevron-forward" size={18} color={colors.muted} />
					</Pressable>
				))}
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={newLabel}
					style={({pressed}) => rowStyle(pressed)}
					onPress={onNew}
				>
					<View style={[styles.tile, {backgroundColor: soften(colors.accent)}]}>
						<Icon name="add" size={20} color={colors.accent} />
					</View>
					<Text style={[styles.name, {color: colors.accent}]}>{newLabel}</Text>
				</Pressable>
			</View>
		</SlideIn>
	);
}

/**
The bar above one opened column or folder in the list view: its name and count, and a way back to the list. Holding it
asks for the same menu as holding the row did.
*/
export function FolderBack({
	entry,
	noun,
	label,
	onBack,
	onMenu,
}: {
	entry: FolderEntry;
	noun: string;
	/**
	What the way back is called, such as All columns.
	*/
	label: string;
	onBack: () => void;
	onMenu: () => void;
}) {
	const colors = useColors();
	const rowStyle = useRowStyle();
	return (
		<SlideIn from="right">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${label}. Showing ${entry.name}, ${countLabel(entry, noun)}`}
				accessibilityHint="Goes back to the list"
				accessibilityActions={[{name: 'more', label: 'More actions'}]}
				style={({pressed}) => rowStyle(pressed, soften(entry.tint), entry.tint)}
				onAccessibilityAction={onMenu}
				onLongPress={onMenu}
				onPress={onBack}
			>
				<Icon name="chevron-back" size={20} color={colors.text} />
				<Icon name={entry.glyph} size={18} color={entry.tint} />
				<Text
					numberOfLines={1}
					style={[styles.name, {color: entry.tint, fontWeight: '600'}]}
				>
					{entry.name}
				</Text>
				<Text style={{color: colors.muted}}>{entry.count}</Text>
			</Pressable>
		</SlideIn>
	);
}

const styles = StyleSheet.create({
	list: {gap: 8},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: TARGET,
		paddingHorizontal: 12,
		paddingVertical: 4,
		borderWidth: 1,
		overflow: 'hidden',
	},
	tile: {
		width: 32,
		height: 32,
		borderRadius: 10,
		alignItems: 'center',
		justifyContent: 'center',
	},
	name: {flex: 1},
});
