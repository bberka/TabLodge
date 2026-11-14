import {useEffect, useRef, useState} from 'react';
import {
	Animated,
	Keyboard,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {usePreferences} from './preferences';
import {BAR_HEIGHT, BAR_MARGIN, useColors} from './theme';
import {Icon, type IconName} from './ui';

export type BarTab<T extends string> = {
	id: T;
	label: string;
	icon: IconName;
	active: IconName;
};

const MATERIAL_HEIGHT = 80;
const IOS_HEIGHT = 49;

/**
How tall the bar is, including the space below it, so a screen can leave that much room at its bottom.
*/
export function useBarSpace(): number {
	const insets = useSafeAreaInsets();
	const {look, floatingBar} = usePreferences();
	const docked = look === 'ios' ? IOS_HEIGHT : MATERIAL_HEIGHT;
	return (floatingBar ? BAR_HEIGHT + BAR_MARGIN * 2 : docked) + insets.bottom;
}

/**
The bottom tab bar, in one of three forms: a Material navigation bar, an iOS tab bar, or a rounded bar that floats
above the content (either look). The selected tab animates, and the bar slides away while the keyboard is open or
when `hidden` is set.
*/
export function TabBar<T extends string>({
	tabs,
	selected,
	onSelect,
	hidden: forceHidden = false,
}: {
	tabs: Array<BarTab<T>>;
	selected: T;
	onSelect: (id: T) => void;
	hidden?: boolean;
}) {
	const colors = useColors();
	const insets = useSafeAreaInsets();
	const {look, floatingBar} = usePreferences();
	const ios = look === 'ios';
	const index = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === selected),
	);
	const [width, setWidth] = useState(0);
	const [keyboard, setKeyboard] = useState(false);
	const position = useRef(new Animated.Value(index)).current;
	const hide = useRef(new Animated.Value(0)).current;
	const pops = useRef(
		tabs.map((_, i) => new Animated.Value(i === index ? 1 : 0)),
	).current;

	useEffect(() => {
		Animated.spring(position, {
			toValue: index,
			useNativeDriver: true,
			friction: 9,
			tension: 90,
		}).start();
		for (const [i, pop] of pops.entries()) {
			Animated.spring(pop, {
				toValue: i === index ? 1 : 0,
				useNativeDriver: true,
				friction: 6,
				tension: 160,
			}).start();
		}
	}, [index, position, pops]);

	useEffect(() => {
		const show = Keyboard.addListener('keyboardDidShow', () => {
			setKeyboard(true);
		});
		const gone = Keyboard.addListener('keyboardDidHide', () => {
			setKeyboard(false);
		});
		return () => {
			show.remove();
			gone.remove();
		};
	}, []);

	const away = keyboard || forceHidden;
	useEffect(() => {
		Animated.timing(hide, {
			toValue: away ? 1 : 0,
			duration: 180,
			useNativeDriver: true,
		}).start();
	}, [away, hide]);

	const barHeight = floatingBar
		? BAR_HEIGHT
		: (ios ? IOS_HEIGHT : MATERIAL_HEIGHT) + insets.bottom;
	const travel = barHeight + (floatingBar ? BAR_MARGIN * 2 + insets.bottom : 0);
	const inner = Math.max(width - 12, 0);
	const tabWidth = inner / tabs.length;

	return (
		<Animated.View
			pointerEvents={away ? 'none' : 'box-none'}
			style={[
				floatingBar ? styles.floating : styles.docked,
				floatingBar && {bottom: BAR_MARGIN + insets.bottom},
				{
					opacity: hide.interpolate({
						inputRange: [0, 1],
						outputRange: [1, 0],
					}),
					transform: [
						{
							translateY: hide.interpolate({
								inputRange: [0, 1],
								outputRange: [0, travel],
							}),
						},
					],
				},
			]}
		>
			<View
				accessibilityRole="tablist"
				style={[
					styles.bar,
					{
						height: barHeight,
						backgroundColor: colors.surface,
						borderColor: colors.border,
					},
					floatingBar
						? styles.floatingBar
						: {
								borderTopWidth: StyleSheet.hairlineWidth,
								paddingBottom: insets.bottom,
							},
				]}
				onLayout={(event) => {
					setWidth(event.nativeEvent.layout.width);
				}}
			>
				{floatingBar && tabWidth > 0 && (
					<Animated.View
						style={[
							styles.slider,
							{
								width: tabWidth,
								backgroundColor: colors.accentSoft,
								transform: [
									{
										translateX: position.interpolate({
											inputRange: tabs.map((_, i) => i),
											outputRange: tabs.map((_, i) => i * tabWidth),
										}),
									},
								],
							},
						]}
					/>
				)}
				{tabs.map((tab, i) => {
					const on = tab.id === selected;
					const pop = pops[i];
					const ink = on ? colors.accent : colors.muted;
					return (
						<Pressable
							key={tab.id}
							accessibilityRole="tab"
							accessibilityState={{selected: on}}
							accessibilityLabel={tab.label}
							style={styles.tab}
							onPress={() => {
								onSelect(tab.id);
							}}
						>
							{!floatingBar && !ios && (
								<Animated.View
									style={[
										styles.indicator,
										{
											backgroundColor: colors.accentSoft,
											opacity: pop,
											transform: [
												{
													scaleX: pop.interpolate({
														inputRange: [0, 1],
														outputRange: [0.3, 1],
													}),
												},
											],
										},
									]}
								/>
							)}
							<Animated.View
								style={{
									transform: [
										{
											scale: pop.interpolate({
												inputRange: [0, 1],
												outputRange: [1, 1.15],
											}),
										},
									],
								}}
							>
								<Icon
									name={on ? tab.active : tab.icon}
									color={ink}
									size={ios ? 25 : 24}
								/>
							</Animated.View>
							<Text
								style={{
									color: ink,
									fontWeight: on && !ios ? '700' : '500',
									fontSize: ios ? 10 : 12,
								}}
							>
								{tab.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	docked: {position: 'absolute', left: 0, right: 0, bottom: 0},
	floating: {position: 'absolute', left: BAR_MARGIN, right: BAR_MARGIN},
	bar: {flexDirection: 'row', alignItems: 'center'},
	floatingBar: {
		borderRadius: BAR_HEIGHT / 2,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: 6,
		elevation: 8,
	},
	slider: {
		position: 'absolute',
		left: 6,
		top: 6,
		bottom: 6,
		borderRadius: (BAR_HEIGHT - 12) / 2,
	},
	tab: {
		flex: 1,
		alignSelf: 'stretch',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 2,
	},
	// Material 3's indicator sits behind the icon only.
	indicator: {
		position: 'absolute',
		top: 12,
		width: 64,
		height: 32,
		borderRadius: 16,
	},
});
