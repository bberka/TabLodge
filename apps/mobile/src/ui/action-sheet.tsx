import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from './bottom-sheet';
import {TARGET, useColors} from './theme';
import {Icon, type IconName} from './widgets';

export type SheetAction = {
	key?: string;
	icon: IconName;
	image?: string;
	label: string;
	hint?: string;
	color?: string;
	destructive?: boolean;
	onPress: () => void;
};

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
