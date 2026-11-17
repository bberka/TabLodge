import {StyleSheet, Text, View} from 'react-native';
import {SEARCH_TIPS} from '../../../extension/src/shared/search-query';
import {useColors} from '../ui/theme';

/**
The search operators, shown at the top of a screen while its search is open and still empty.
*/
export function SearchTips() {
	const colors = useColors();
	return (
		<View style={styles.box}>
			<Text
				accessibilityRole="header"
				style={[styles.title, {color: colors.muted}]}
			>
				Search tips
			</Text>
			{SEARCH_TIPS.map((tip) => (
				<Text key={tip.example} style={{color: colors.muted}}>
					<Text style={[styles.example, {color: colors.text}]}>
						{tip.example}
					</Text>
					{`  ${tip.meaning}`}
				</Text>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	box: {paddingHorizontal: 16, paddingVertical: 8, gap: 2},
	title: {fontSize: 13, fontWeight: '700', paddingBottom: 2},
	example: {fontFamily: 'monospace'},
});
