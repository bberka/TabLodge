import {Pressable, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from './bottom-sheet';
import {TARGET, useColors} from './theme';
import {Icon, type IconName} from './ui';

export type SheetAction = {
	icon: IconName;
	label: string;
	/**
	One line under the label, for an action that needs a word of explanation.
	*/
	hint?: string;
	onPress: () => void;
};

/**
A drawer with a list of actions, each with an icon and a word, for the things a header has no room to name.
*/
export function ActionSheet({
	visible,
	title,
	actions,
	onClose,
}: {
	visible: boolean;
	title: string;
	actions: SheetAction[];
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet visible={visible} label={title} onClose={onClose}>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{title}
				</Text>
				{actions.map((action) => (
					<Pressable
						key={action.label}
						accessibilityRole="button"
						accessibilityLabel={action.label}
						android_ripple={{color: colors.pressed}}
						style={({pressed}) => [
							styles.row,
							{backgroundColor: pressed ? colors.pressed : 'transparent'},
						]}
						onPress={() => {
							onClose();
							action.onPress();
						}}
					>
						<Icon name={action.icon} size={24} color={colors.accent} />
						<View style={styles.texts}>
							<Text style={{color: colors.text, fontSize: 16}}>
								{action.label}
							</Text>
							{action.hint && (
								<Text style={{color: colors.muted}}>{action.hint}</Text>
							)}
						</View>
					</Pressable>
				))}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingBottom: 8},
	title: {
		fontSize: 20,
		fontWeight: '700',
		paddingHorizontal: 20,
		paddingBottom: 6,
	},
	row: {
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
		paddingHorizontal: 20,
		paddingVertical: 8,
	},
	texts: {flex: 1, gap: 2},
});
