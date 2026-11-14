import {useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Keyboard,
	Pressable,
	StyleSheet,
	Text,
	useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {motion, spring} from './motion';
import {usePreferences} from './preferences';
import {resetScroll, useScrolledDown} from './scroll-state';
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
const COMPACT_HEIGHT = 48;
const COMPACT_TAB_WIDTH = 56;
const BAR_PADDING = 6;

/**
How tall the bar is, including the space below it, so a screen can leave that much room at its bottom.
*/
export function useBarSpace(): number {
	const insets = useSafeAreaInsets();
	const {look, floatingBar, barSize} = usePreferences();
	const docked = look === 'ios' ? IOS_HEIGHT : MATERIAL_HEIGHT;
	// Small while scrolling floats over the content without changing the room the screens leave, so lists do not jump.
	const floating =
		(barSize === 'compact' ? COMPACT_HEIGHT : BAR_HEIGHT) + BAR_MARGIN * 2;
	return (floatingBar ? floating : docked) + insets.bottom;
}

/**
The bottom tab bar, in one of three forms: a Material navigation bar, an iOS tab bar, or a rounded bar that floats
above the content (either look). The selected tab animates, and the bar slides away while the keyboard is open or
when `hidden` is set. A floating bar grows and shrinks between full width and a small icon pill with one animation.
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
	const {width: screenWidth} = useWindowDimensions();
	const {look, floatingBar, barSize} = usePreferences();
	const scrolledDown = useScrolledDown();
	const small =
		floatingBar &&
		(barSize === 'compact' || (barSize === 'scroll' && scrolledDown));
	const ios = look === 'ios';
	const count = tabs.length;
	const index = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === selected),
	);
	const [keyboard, setKeyboard] = useState(false);
	// 0 is the full bar, 1 the small one. Width and height are layout, so this one runs on the JS thread.
	const shrink = useRef(new Animated.Value(small ? 1 : 0)).current;
	// The highlight slides on the JS thread too, because its offset depends on the animated tab width.
	const slide = useRef(new Animated.Value(index)).current;
	const hide = useRef(new Animated.Value(0)).current;
	const pops = useRef(
		tabs.map((_, i) => new Animated.Value(i === index ? 1 : 0)),
	).current;

	useEffect(() => {
		resetScroll();
	}, [selected]);

	useEffect(() => {
		Animated.timing(shrink, {
			toValue: small ? 1 : 0,
			duration: motion(260),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: false,
		}).start();
	}, [small, shrink]);

	useEffect(() => {
		spring(slide, index, {friction: 9, tension: 90, native: false}).start();
		for (const [i, pop] of pops.entries()) {
			spring(pop, i === index ? 1 : 0, {friction: 6, tension: 160}).start();
		}
	}, [index, slide, pops]);

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
			duration: motion(180),
			useNativeDriver: true,
		}).start();
	}, [away, hide]);

	const dockedHeight = (ios ? IOS_HEIGHT : MATERIAL_HEIGHT) + insets.bottom;
	const travel = floatingBar
		? BAR_HEIGHT + BAR_MARGIN * 2 + insets.bottom
		: dockedHeight;
	const fullWidth = screenWidth - BAR_MARGIN * 2;
	const smallWidth = COMPACT_TAB_WIDTH * count + BAR_PADDING * 2;
	const tabWidth = shrink.interpolate({
		inputRange: [0, 1],
		outputRange: [(fullWidth - BAR_PADDING * 2) / count, COMPACT_TAB_WIDTH],
	});
	const labelHeight = ios ? 12 : 16;
	const gone = {inputRange: [0, 1], outputRange: [1, 0]};

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
			<Animated.View
				accessibilityRole="tablist"
				style={[
					styles.bar,
					{backgroundColor: colors.surface, borderColor: colors.border},
					floatingBar
						? [
								styles.floatingBar,
								{
									width: shrink.interpolate({
										inputRange: [0, 1],
										outputRange: [fullWidth, smallWidth],
									}),
									height: shrink.interpolate({
										inputRange: [0, 1],
										outputRange: [BAR_HEIGHT, COMPACT_HEIGHT],
									}),
								},
							]
						: {
								height: dockedHeight,
								borderTopWidth: StyleSheet.hairlineWidth,
								paddingBottom: insets.bottom,
							},
				]}
			>
				{floatingBar && (
					<Animated.View
						style={[
							styles.slider,
							{
								width: tabWidth,
								backgroundColor: colors.accentSoft,
								left: Animated.add(
									BAR_PADDING,
									Animated.multiply(slide, tabWidth),
								),
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
							<Animated.View
								style={
									floatingBar
										? {
												overflow: 'hidden',
												opacity: shrink.interpolate(gone),
												height: shrink.interpolate({
													inputRange: [0, 1],
													outputRange: [labelHeight, 0],
												}),
												marginTop: shrink.interpolate({
													inputRange: [0, 1],
													outputRange: [2, 0],
												}),
											}
										: styles.label
								}
							>
								<Text
									numberOfLines={1}
									style={{
										color: ink,
										fontWeight: on && !ios ? '700' : '500',
										fontSize: ios ? 10 : 12,
									}}
								>
									{tab.label}
								</Text>
							</Animated.View>
						</Pressable>
					);
				})}
			</Animated.View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	docked: {position: 'absolute', left: 0, right: 0, bottom: 0},
	floating: {position: 'absolute', left: 0, right: 0, alignItems: 'center'},
	bar: {flexDirection: 'row', alignItems: 'center'},
	floatingBar: {
		borderRadius: BAR_HEIGHT / 2,
		borderWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: BAR_PADDING,
		elevation: 8,
	},
	slider: {
		position: 'absolute',
		top: BAR_PADDING,
		bottom: BAR_PADDING,
		borderRadius: BAR_HEIGHT / 2,
	},
	tab: {
		flex: 1,
		alignSelf: 'stretch',
		alignItems: 'center',
		justifyContent: 'center',
	},
	label: {marginTop: 2},
	// A pill behind the icon and its label, centered in the 80 high tab.
	indicator: {
		position: 'absolute',
		top: 12,
		width: 72,
		height: MATERIAL_HEIGHT - 24,
		borderRadius: (MATERIAL_HEIGHT - 24) / 2,
	},
});
