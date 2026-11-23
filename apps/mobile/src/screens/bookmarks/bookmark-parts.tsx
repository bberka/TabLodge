import {memo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {openLink} from '../../platform/open-links';
import type {Bookmark} from '../../../../extension/src/shared/types';
import {BottomSheet} from '../../ui/bottom-sheet';
import {useChipLook} from '../../ui/column-icons';
import {hostOf} from '../../library/store-shape';
import {linkToOpen, rowText} from '../../library/links';
import {rowActionLook} from '../../library/row-actions';
import {type RowAction, usePreferences} from '../../settings/preferences';
import {type SwipeAction, SwipeRow} from '../../ui/swipe-row';
import {useLinkSettings} from '../../library/use-link-settings';
import {TARGET, useColors, useShape} from '../../ui/theme';
import {Button, Chips, Icon, type IconName} from '../../ui/widgets';
import {BookmarkIcon, spokenKind} from '../../ui/bookmark-icon';
import {SaveLinkForm} from '../save/save-link';
import {NoteText} from '../../ui/note-text';
import {
	firstPassage,
	spokenNote,
} from '../../../../extension/src/shared/note-links';
import {RowTags, spokenTags} from './tags';

function BookmarkRowView({
	bookmark,
	selecting,
	checked,
	onToggle,
	onSelect,
	onEdit,
	onMove,
	onDelete,
}: {
	bookmark: Bookmark;
	selecting: boolean;
	checked: boolean;
	onToggle: (bookmark: Bookmark) => void;
	onSelect: (bookmark: Bookmark) => void;
	onEdit: (bookmark: Bookmark) => void;
	onMove: (bookmark: Bookmark) => void;
	onDelete: (bookmark: Bookmark) => void;
}) {
	const colors = useColors();
	const shape = useShape();
	const prefs = usePreferences();
	const settings = useLinkSettings();
	const host = hostOf(bookmark.url);
	const text = rowText(bookmark, settings);
	const compact = settings.bookmarkDensity === 'compact';
	const open = () => {
		openLink(linkToOpen(bookmark.url, settings));
	};

	const openPassage = (url: string) => {
		openLink(linkToOpen(url, settings));
	};

	const passage = firstPassage(bookmark.notes ?? '');

	const toggle = () => {
		onToggle(bookmark);
	};

	const select = () => {
		onSelect(bookmark);
	};

	const edit = () => {
		onEdit(bookmark);
	};

	const run: Record<RowAction, (() => void) | undefined> = {
		none: undefined,
		open,
		edit,
		move() {
			onMove(bookmark);
		},
		delete() {
			onDelete(bookmark);
		},
	};
	const swipe = (action: RowAction): SwipeAction | undefined => {
		const onTrigger = run[action];
		return onTrigger && {...rowActionLook(action, colors), onTrigger};
	};

	return (
		<SwipeRow
			disabled={selecting}
			left={swipe(prefs.swipeRight)}
			right={swipe(prefs.swipeLeft)}
		>
			<Pressable
				accessibilityRole={selecting ? 'checkbox' : 'link'}
				accessibilityState={selecting ? {checked} : undefined}
				accessibilityLabel={`${spokenKind(bookmark.url)}${text.main}, ${text.sub ?? host}${text.insecure ? ', not secure' : ''}${bookmark.notes ? `, note: ${spokenNote(bookmark.notes)}` : ''}${spokenTags(bookmark)}`}
				accessibilityHint={selecting ? undefined : 'Opens the link'}
				accessibilityActions={[
					{name: 'open', label: 'Open in browser'},
					{name: 'select', label: 'More actions'},
					{name: 'edit', label: 'Edit'},
					{name: 'move', label: 'Move to column'},
					{name: 'delete', label: 'Delete'},
					...(passage ? [{name: 'passage', label: passage.name}] : []),
				]}
				style={({pressed}) => [
					styles.row,
					compact && styles.compact,
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
							select();
							break;
						}

						case 'edit': {
							edit();
							break;
						}

						case 'move': {
							run.move?.();
							break;
						}

						case 'delete': {
							run.delete?.();
							break;
						}

						case 'passage': {
							if (passage) {
								openPassage(passage.url);
							}

							break;
						}

						default:
					}
				}}
				onPress={selecting ? toggle : prefs.tapAction === 'edit' ? edit : open}
				onLongPress={selecting ? toggle : select}
			>
				{selecting ? (
					<Icon
						name={checked ? 'checkmark-circle' : 'ellipse-outline'}
						size={28}
						color={checked ? colors.accent : colors.muted}
					/>
				) : (
					<BookmarkIcon url={bookmark.url} size={compact ? 32 : 40} />
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
					{bookmark.notes && (
						<NoteText
							notes={bookmark.notes}
							numberOfLines={compact ? 1 : 2}
							style={[styles.notes, {color: colors.muted}]}
							onOpen={selecting ? undefined : openPassage}
						/>
					)}
					<RowTags bookmark={bookmark} />
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

export const BookmarkRow = memo(BookmarkRowView);

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

export function ActionBar({
	actions,
}: {
	actions: Array<{
		icon: IconName;
		label: string;
		onPress: () => void;
		disabled: boolean;
		color?: string;
	}>;
}) {
	const colors = useColors();
	const insets = useSafeAreaInsets();
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
			{actions.map((action) => (
				<ActionButton key={action.label} {...action} />
			))}
		</View>
	);
}

export function SelectionBar({
	count,
	canMove,
	onOpen,
	onEdit,
	onShare,
	onMove,
	onSendToPrivate,
	onDelete,
}: {
	count: number;
	canMove: boolean;
	onOpen: () => void;
	onEdit: () => void;
	onShare: () => void;
	onMove: () => void;
	onSendToPrivate?: () => void;
	onDelete: () => void;
}) {
	const colors = useColors();
	const isNone = count === 0;
	return (
		<ActionBar
			actions={[
				{
					icon: 'albums-outline',
					label: 'Open',
					disabled: isNone,
					onPress: onOpen,
				},
				{
					icon: 'create-outline',
					label: 'Edit',
					disabled: count !== 1,
					onPress: onEdit,
				},
				{
					icon: 'share-outline',
					label: 'Share',
					disabled: isNone,
					onPress: onShare,
				},
				{
					icon: 'folder-open-outline',
					label: 'Move',
					disabled: isNone || !canMove,
					onPress: onMove,
				},
				...(onSendToPrivate
					? [
							{
								icon: 'lock-closed-outline' as const,
								label: 'To private',
								disabled: isNone,
								onPress: onSendToPrivate,
							},
						]
					: []),
				{
					icon: 'trash-outline',
					label: 'Delete',
					color: colors.danger,
					disabled: isNone,
					onPress: onDelete,
				},
			]}
		/>
	);
}

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
	notes: {fontSize: 13},
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

export function EditSheet({
	bookmark,
	onClose,
}: {
	bookmark?: Bookmark;
	onClose: () => void;
}) {
	return (
		<BottomSheet
			scroll={false}
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
