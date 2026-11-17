import {StyleSheet, Text, View} from 'react-native';
import {SEARCH_TIPS} from '../../../extension/src/shared/search-query';
import {BottomSheet, SheetHeader} from '../ui/bottom-sheet';
import {useColors} from '../ui/theme';

/**
The search operators in a drawer, opened from the search bar's help button. The phone has no open tabs, so `in:open`
is left out.
*/
export function SearchTipsSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet visible={visible} label="Search tips" onClose={onClose}>
			<View style={styles.body}>
				<SheetHeader title="Search tips" onClose={onClose} />
				{SEARCH_TIPS.filter((tip) => !tip.browserOnly).map((tip) => (
					<View key={tip.example} accessible style={styles.row}>
						<Text style={[styles.example, {color: colors.text}]}>
							{tip.example}
						</Text>
						<Text style={[styles.meaning, {color: colors.muted}]}>
							{tip.meaning}
						</Text>
					</View>
				))}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 16, paddingBottom: 24, gap: 6},
	row: {flexDirection: 'row', alignItems: 'baseline', gap: 12},
	example: {fontFamily: 'monospace', fontSize: 14, minWidth: 150},
	meaning: {fontSize: 14, flexShrink: 1},
});
