import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from './bottom-sheet';
import {TARGET, useColors} from './theme';
import {Icon, type IconName} from './widgets';

export type SheetAction = {
	/**
	Tells rows apart when two can share a label, such as two browsers with one name. Defaults to the label.
	*/
	key?: string;
	icon: IconName;
	/**
	A picture drawn in place of the icon, such as an app's own icon as a `data:` address.
	*/
	image?: string;
	label: string;
	/**
	One line under the label, for an action that needs a word of explanation.
	*/
	hint?: string;
	/**
	The icon's color, for an action that has one of its own (the swipe actions' colors). Defaults to the accent.
	*/
	color?: string;
	/**
	Drawn in the danger color, for an action that removes something.
	*/
	destructive?: boolean;
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
						key={action.key ?? action.label}
						accessibilityRole="button"
						accessibilityLabel={action.label}
						accessibilityHint={action.hint}
						style={({pressed}) => [
							styles.row,
							{backgroundColor: pressed ? colors.pressed : 'transparent'},
						]}
						onPress={() => {
							onClose();
							action.onPress();
						}}
					>
						{action.image ? (
							<Image source={{uri: action.image}} style={styles.image} />
						) : (
							<Icon
								name={action.icon}
								size={24}
								color={
									action.destructive
										? colors.danger
										: (action.color ?? colors.accent)
								}
							/>
						)}
						<View style={styles.texts}>
							<Text
								style={{
									color: action.destructive ? colors.danger : colors.text,
									fontSize: 16,
								}}
							>
								{action.label}
							</Text>
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
		borderRadius: 12,
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
		paddingHorizontal: 20,
		paddingVertical: 8,
	},
	texts: {flex: 1, gap: 2},
	image: {width: 24, height: 24, borderRadius: 6},
});
