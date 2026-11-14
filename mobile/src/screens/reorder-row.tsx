import {StyleSheet, Text, View} from 'react-native';
import type {Bookmark} from '../../../src/app/types';
import {hostOf} from '../library';
import {SiteIcon} from '../site-icon';
import {TARGET, useColors} from '../theme';
import {IconButton} from '../ui';

/**
A bookmark while the column is being put in order: its title, and buttons that move it. Moving by buttons works
without dragging, so a long column can be ordered with a screen reader or a switch.
*/
export function ReorderRow({
	bookmark,
	first,
	last,
	onTop,
	onUp,
	onDown,
}: {
	bookmark: Bookmark;
	first: boolean;
	last: boolean;
	onTop: () => void;
	onUp: () => void;
	onDown: () => void;
}) {
	const colors = useColors();
	const host = hostOf(bookmark.url);
	const title = bookmark.title || host;
	return (
		<View style={[styles.row, {borderColor: colors.border}]}>
			<SiteIcon host={host} size={32} />
			<View style={styles.texts}>
				<Text numberOfLines={1} style={{color: colors.text}}>
					{title}
				</Text>
				<Text numberOfLines={1} style={{color: colors.muted, fontSize: 13}}>
					{host}
				</Text>
			</View>
			<IconButton
				icon="arrow-up-circle-outline"
				label={`Move ${title} to the top`}
				disabled={first}
				onPress={onTop}
			/>
			<IconButton
				icon="chevron-up"
				label={`Move ${title} up`}
				disabled={first}
				onPress={onUp}
			/>
			<IconButton
				icon="chevron-down"
				label={`Move ${title} down`}
				disabled={last}
				onPress={onDown}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	row: {
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		paddingLeft: 16,
		paddingRight: 4,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	texts: {flex: 1},
});
