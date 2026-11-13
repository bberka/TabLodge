import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {Bookmark} from '../../../src/app/types';
import {BottomSheet} from '../bottom-sheet';
import {useChipLook} from '../column-icons';
import {hostOf} from '../library';
import {linkToOpen, rowText} from '../links';
import {rowActionLook} from '../row-actions';
import {type RowAction, usePreferences} from '../preferences';
import {type SwipeAction, SwipeRow} from '../swipe-row';
import {useLinkSettings} from '../use-link-settings';
import {TARGET, useColors, useShape} from '../theme';
import {Button, Chips, Icon, type IconName} from '../ui';
import {SiteIcon} from '../site-icon';
import {SaveLinkForm} from './save-link';

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
	onMove,
	onDelete,
	readOnly = false,
}: {
	bookmark: Bookmark;
	/**
	The private library cannot be changed here: tapping opens, and there is no swipe or selection.
	*/
	readOnly?: boolean;
	selecting: boolean;
	checked: boolean;
	onToggle: () => void;
	onSelect: () => void;
	onEdit: () => void;
	onMove: () => void;
	onDelete: () => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const prefs = usePreferences();
	const settings = useLinkSettings();
	const host = hostOf(bookmark.url);
	const text = rowText(bookmark, settings);
	const open = () => {
		void Linking.openURL(linkToOpen(bookmark.url, settings));
	};

	const run: Record<RowAction, (() => void) | undefined> = {
		none: undefined,
		open,
		edit: onEdit,
		move: onMove,
		delete: onDelete,
	};
	const swipe = (action: RowAction): SwipeAction | undefined => {
		const onTrigger = run[action];
		return onTrigger && {...rowActionLook(action, colors), onTrigger};
	};

	return (
		<SwipeRow
			disabled={selecting || readOnly}
			left={readOnly ? undefined : swipe(prefs.swipeRight)}
			right={readOnly ? undefined : swipe(prefs.swipeLeft)}
		>
			<Pressable
				accessibilityRole={selecting ? 'checkbox' : 'link'}
				accessibilityState={selecting ? {checked} : undefined}
				accessibilityLabel={`${text.main}, ${text.sub ?? host}${text.insecure ? ', not secure' : ''}`}
				accessibilityHint={selecting ? undefined : 'Opens the link'}
				accessibilityActions={
					readOnly
						? [{name: 'open', label: 'Open in browser'}]
						: [
								{name: 'open', label: 'Open in browser'},
								{name: 'select', label: 'Select'},
								{name: 'edit', label: 'Edit'},
								{name: 'move', label: 'Move to column'},
								{name: 'delete', label: 'Delete'},
							]
				}
				android_ripple={shape.ios ? undefined : {color: colors.pressed}}
				style={({pressed}) => [
					styles.row,
					settings.bookmarkDensity === 'compact' && styles.compact,
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

						case 'move': {
							onMove();
							break;
						}

						case 'delete': {
							onDelete();
							break;
						}

						default:
					}
				}}
				onPress={
					selecting ? onToggle : prefs.tapAction === 'edit' ? onEdit : open
				}
				onLongPress={readOnly ? undefined : selecting ? onToggle : onSelect}
			>
				{selecting ? (
					<Icon
						name={checked ? 'checkmark-circle' : 'ellipse-outline'}
						size={28}
						color={checked ? colors.accent : colors.muted}
					/>
				) : (
					<SiteIcon host={host} />
				)}
				<View style={styles.texts}>
					<Text numberOfLines={2} style={[styles.title, {color: colors.text}]}>
						{text.main}
					</Text>
					{text.sub !== undefined && (
						<View style={styles.address}>
							{text.insecure && (
								<Icon name="lock-open-outline" size={13} color={colors.warn} />
							)}
							<Text
								numberOfLines={1}
								style={[styles.addressText, {color: colors.muted}]}
							>
								{text.sub}
							</Text>
						</View>
					)}
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
	columns: Array<{id: string; name: string; icon?: string; color?: string}>;
	onPick: (columnId: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const chipLook = useChipLook();
	return (
		<BottomSheet visible={visible} label="Move to column" onClose={onClose}>
			<View style={styles.moveBody}>
				<Text
					accessibilityRole="header"
					style={[styles.moveTitle, {color: colors.text}]}
				>
					Move {count} to
				</Text>
				<Chips
					items={columns.map((column) => chipLook(column))}
					selected=""
					onSelect={onPick}
				/>
				<Button label="Cancel" kind="plain" onPress={onClose} />
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	fab: {
		position: 'absolute',
		right: 16,
		width: 56,
		height: 56,
		borderRadius: 28,
		alignItems: 'center',
		justifyContent: 'center',
		elevation: 4,
	},
	row: {
		minHeight: TARGET + 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	compact: {minHeight: TARGET, paddingVertical: 4},
	texts: {flex: 1, gap: 2},
	address: {flexDirection: 'row', alignItems: 'center', gap: 4},
	addressText: {flexShrink: 1},
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

/**
The round plus button that opens the Add link drawer, on the Material look.
*/
export function AddButton({
	bottom,
	onPress,
}: {
	bottom: number;
	onPress: () => void;
}) {
	const colors = useColors();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Add link"
			android_ripple={{color: '#ffffff33'}}
			style={({pressed}) => [
				styles.fab,
				{
					// Clear of the tab bar below, whose own shadow would otherwise reach the button.
					bottom: bottom + 16,
					backgroundColor: colors.accent,
					opacity: pressed ? 0.85 : 1,
				},
			]}
			onPress={onPress}
		>
			<Icon name="add" size={28} color={colors.onAccent} />
		</Pressable>
	);
}

/**
The drawer for changing a bookmark's link, title, or column. It is open while a bookmark is given.
*/
export function EditSheet({
	bookmark,
	onClose,
}: {
	bookmark?: Bookmark;
	onClose: () => void;
}) {
	return (
		<BottomSheet
			visible={Boolean(bookmark)}
			label="Edit link"
			onClose={onClose}
		>
			{bookmark && (
				<SaveLinkForm
					key={bookmark.id}
					editing={bookmark}
					initialText={bookmark.url}
					initialTitle={bookmark.title}
					onDone={onClose}
				/>
			)}
		</BottomSheet>
	);
}
