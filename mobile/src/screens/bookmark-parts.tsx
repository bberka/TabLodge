import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark} from '../../../src/app/types';
import {BottomSheet} from '../bottom-sheet';
import {hostOf} from '../library';
import {SwipeRow} from '../swipe-row';
import {TARGET, useColors, useShape} from '../theme';
import {Avatar, Button, Chips, Icon, type IconName} from '../ui';

/**
One bookmark: tap to open, swipe right to open or left to delete, long press to select. Screen reader users get
the same actions from the actions menu.
*/
export function BookmarkRow({
	bookmark,
	selecting,
	checked,
	onToggle,
	onSelect,
	onEdit,
	onDelete,
}: {
	bookmark: Bookmark;
	selecting: boolean;
	checked: boolean;
	onToggle: () => void;
	onSelect: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const host = hostOf(bookmark.url);
	const open = () => {
		void Linking.openURL(bookmark.url);
	};

	return (
		<SwipeRow
			disabled={selecting}
			left={{
				label: 'Open',
				icon: 'open-outline',
				color: colors.accent,
				onTrigger: open,
			}}
			right={{
				label: 'Delete',
				icon: 'trash-outline',
				color: colors.danger,
				onTrigger: onDelete,
			}}
		>
			<Pressable
				accessibilityRole={selecting ? 'checkbox' : 'link'}
				accessibilityState={selecting ? {checked} : undefined}
				accessibilityLabel={`${bookmark.title}, ${host}`}
				accessibilityHint={selecting ? undefined : 'Opens the link'}
				accessibilityActions={[
					{name: 'open', label: 'Open in browser'},
					{name: 'select', label: 'Select'},
					{name: 'edit', label: 'Edit'},
					{name: 'delete', label: 'Delete'},
				]}
				android_ripple={shape.ios ? undefined : {color: colors.pressed}}
				style={({pressed}) => [
					styles.row,
					{
						backgroundColor: checked
							? colors.accentSoft
							: pressed
								? colors.pressed
								: colors.background,
						borderColor: colors.border,
					},
				]}
				onAccessibilityAction={(event) => {
					switch (event.nativeEvent.actionName) {
						case 'open': {
							open();
							break;
						}

						case 'select': {
							onSelect();
							break;
						}

						case 'edit': {
							onEdit();
							break;
						}

						case 'delete': {
							onDelete();
							break;
						}

						default:
					}
				}}
				onPress={selecting ? onToggle : open}
				onLongPress={selecting ? onToggle : onSelect}
			>
				{selecting ? (
					<Icon
						name={checked ? 'checkmark-circle' : 'ellipse-outline'}
						size={28}
						color={checked ? colors.accent : colors.muted}
					/>
				) : (
					<Avatar host={host} />
				)}
				<View style={styles.texts}>
					<Text numberOfLines={2} style={[styles.title, {color: colors.text}]}>
						{bookmark.title}
					</Text>
					<Text numberOfLines={1} style={{color: colors.muted}}>
						{host}
					</Text>
				</View>
				{!selecting && (
					<Icon
						name={shape.ios ? 'chevron-forward' : 'open-outline'}
						size={18}
						color={colors.muted}
					/>
				)}
			</Pressable>
		</SwipeRow>
	);
}

function ActionButton({
	icon,
	label,
	onPress,
	disabled,
	color,
}: {
	icon: IconName;
	label: string;
	onPress: () => void;
	disabled: boolean;
	color?: string;
}) {
	const colors = useColors();
	const ink = color ?? colors.accent;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{disabled}}
			disabled={disabled}
			style={({pressed}) => [
				styles.action,
				{opacity: disabled ? 0.4 : pressed ? 0.6 : 1},
			]}
			onPress={onPress}
		>
			<Icon name={icon} color={ink} />
			<Text style={{color: ink, fontSize: 12, fontWeight: '600'}}>{label}</Text>
		</Pressable>
	);
}

/**
The bar shown while selecting: open, move, or delete what is picked.
*/
export function SelectionBar({
	count,
	canMove,
	onOpen,
	onEdit,
	onMove,
	onDelete,
}: {
	count: number;
	canMove: boolean;
	onOpen: () => void;
	onEdit: () => void;
	onMove: () => void;
	onDelete: () => void;
}) {
	const colors = useColors();
	const insets = useSafeAreaInsets();
	const none = count === 0;
	return (
		<View
			style={[
				styles.actions,
				{
					paddingBottom: insets.bottom,
					backgroundColor: colors.surface,
					borderColor: colors.border,
				},
			]}
		>
			<ActionButton
				icon="albums-outline"
				label="Open"
				disabled={none}
				onPress={onOpen}
			/>
			<ActionButton
				icon="create-outline"
				label="Edit"
				disabled={count !== 1}
				onPress={onEdit}
			/>
			<ActionButton
				icon="folder-open-outline"
				label="Move"
				disabled={none || !canMove}
				onPress={onMove}
			/>
			<ActionButton
				icon="trash-outline"
				label="Delete"
				color={colors.danger}
				disabled={none}
				onPress={onDelete}
			/>
		</View>
	);
}

/**
A drawer to pick the column the selected bookmarks go to.
*/
export function MoveSheet({
	visible,
	count,
	columns,
	onPick,
	onClose,
}: {
	visible: boolean;
	count: number;
	columns: Array<{id: string; name: string}>;
	onPick: (columnId: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet visible={visible} label="Move to column" onClose={onClose}>
			<View style={styles.moveBody}>
				<Text
					accessibilityRole="header"
					style={[styles.moveTitle, {color: colors.text}]}
				>
					Move {count} to
				</Text>
				<Chips items={columns} selected="" onSelect={onPick} />
				<Button label="Cancel" kind="plain" onPress={onClose} />
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	row: {
		minHeight: TARGET + 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	texts: {flex: 1, gap: 2},
	title: {fontSize: 16, fontWeight: '500'},
	actions: {
		position: 'absolute',
		left: 0,
		right: 0,
		bottom: 0,
		flexDirection: 'row',
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	action: {
		flex: 1,
		minHeight: 64,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 2,
	},
	moveBody: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	moveTitle: {fontSize: 20, fontWeight: '700'},
});
