import {useEffect, useRef} from 'react';
import {
	Animated,
	Easing,
	Pressable,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {resolveLook, usePreferences} from '../settings/preferences';
import {useKeyboardHeight} from './keyboard';
import {motion, spring} from './motion';
import {resetScroll, useScrolledDown} from './scroll-state';
import {useSearchAction} from './search-action';
import {BAR_HEIGHT, useColors, useShape} from './theme';
import {Icon, type IconName} from './ui';

export type BarTab<T extends string> = {
	id: T;
	label: string;
	icon: IconName;
	active: IconName;
};

// The docked bar is the same in both looks: tall enough that the icon and its name sit clear of the bar's edges inside
// the highlighted pill, which iOS's own 49 point bar was too short for.
const DOCKED_HEIGHT = 76;
const PILL_HEIGHT = 56;
// The small bar keeps a touch target as big as the round search and add buttons (52), and its icons grow a little to
// fill the room the labels leave.
const COMPACT_HEIGHT = 56;
const COMPACT_TAB_WIDTH = 68;
const COMPACT_ICON_SCALE = 1.2;
const BAR_PADDING = 6;

/**
How tall the bar is, including the space below it, so a screen can leave that much room at its bottom.
*/
export function useBarSpace(): number {
	const insets = useSafeAreaInsets();
	const {floatingBar, barSize} = usePreferences();
	const {barGap} = useShape();
	// Small while scrolling floats over the content without changing the room the screens leave, so lists do not jump.
	const floating =
		(barSize === 'compact' ? COMPACT_HEIGHT : BAR_HEIGHT) + barGap * 2;
	return (floatingBar ? floating : DOCKED_HEIGHT) + insets.bottom;
}

/**
The widest the round search button gets (the full bar's height); it sits in the floating bar's row, at the screen's right edge, and its distance
from that edge and from the bar. The bar leaves this much room on its right.
*/
const SIDE_BUTTON = BAR_HEIGHT;
const SIDE_MARGIN = 16;
const SIDE_GAP = 12;

/**
How tall the floating bar is now: the full bar's height, or the small bar's while it is small. The round buttons beside it
are as tall as the bar and follow it, so they stay level and the same size. A docked bar has no such row.
*/
export function useBarHeight(): number {
	const {floatingBar, barSize} = usePreferences();
	const scrolledDown = useScrolledDown();
	const small =
		floatingBar &&
		(barSize === 'compact' || (barSize === 'scroll' && scrolledDown));
	return small ? COMPACT_HEIGHT : BAR_HEIGHT;
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
	const {look: chosen, floatingBar, barSize} = usePreferences();
	const look = resolveLook(chosen);
	const {barGap} = useShape();
	const scrolledDown = useScrolledDown();
	const small =
		floatingBar &&
		(barSize === 'compact' || (barSize === 'scroll' && scrolledDown));
	// The names are hidden whenever the bar is small, and in the Icons only size, which keeps the bar's size.
	const unlabeled = small || (floatingBar && barSize === 'icons');
	const ios = look === 'ios';
	const count = tabs.length;
	const index = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === selected),
	);
	// The shared keyboard state is checked against the window, so a keyboard that closed unnoticed does not keep the bar away.
	const keyboard = useKeyboardHeight() > 0;
	const searchAction = useSearchAction();
	// 0 is the full bar, 1 the small one. Width and height are layout, so this one runs on the JS thread.
	const shrink = useRef(new Animated.Value(small ? 1 : 0)).current;
	// 0 shows the names under the icons, 1 hides them.
	const unlabel = useRef(new Animated.Value(unlabeled ? 1 : 0)).current;
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
		Animated.timing(unlabel, {
			toValue: unlabeled ? 1 : 0,
			duration: motion(260),
			easing: Easing.out(Easing.cubic),
			useNativeDriver: false,
		}).start();
	}, [unlabeled, unlabel]);

	useEffect(() => {
		spring(slide, index, {friction: 9, tension: 90, native: false}).start();
		for (const [i, pop] of pops.entries()) {
			spring(pop, i === index ? 1 : 0, {friction: 6, tension: 160}).start();
		}
	}, [index, slide, pops]);

	const away = keyboard || forceHidden;
	useEffect(() => {
		Animated.timing(hide, {
			toValue: away ? 1 : 0,
			duration: motion(180),
			useNativeDriver: true,
		}).start();
	}, [away, hide]);

	const dockedHeight = DOCKED_HEIGHT + insets.bottom;
	const travel = floatingBar
		? BAR_HEIGHT + barGap * 2 + insets.bottom
		: dockedHeight;
	// The floating bar leaves room on its right for the search button in its row.
	const sideRoom = SIDE_MARGIN + SIDE_BUTTON + SIDE_GAP;
	const fullWidth = screenWidth - barGap - sideRoom;
	const smallWidth = COMPACT_TAB_WIDTH * count + BAR_PADDING * 2;
	// The small bar sits in the middle of the screen; on a narrow one it moves left just enough to clear the search
	// button. The full bar starts at the screen's left margin.
	const smallLeft = Math.min(
		(screenWidth - smallWidth) / 2,
		screenWidth - SIDE_MARGIN - SIDE_BUTTON - 4 - smallWidth,
	);
	const tabWidth = shrink.interpolate({
		inputRange: [0, 1],
		outputRange: [(fullWidth - BAR_PADDING * 2) / count, COMPACT_TAB_WIDTH],
	});
	const labelHeight = ios ? 14 : 16;
	const gone = {inputRange: [0, 1], outputRange: [1, 0]};

	return (
		<Animated.View
			pointerEvents={away ? 'none' : 'box-none'}
			style={[
				floatingBar ? styles.floating : styles.docked,
				floatingBar && {bottom: barGap + insets.bottom, left: 0, right: 0},
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
									marginLeft: shrink.interpolate({
										inputRange: [0, 1],
										outputRange: [barGap, Math.max(barGap, smallLeft)],
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
							{!floatingBar && (
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
											scale: shrink.interpolate({
												inputRange: [0, 1],
												outputRange: [1, COMPACT_ICON_SCALE],
											}),
										},
									],
								}}
							>
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
							</Animated.View>
							<Animated.View
								style={
									floatingBar
										? {
												overflow: 'hidden',
												opacity: unlabel.interpolate(gone),
												height: unlabel.interpolate({
													inputRange: [0, 1],
													outputRange: [labelHeight, 0],
												}),
												marginTop: unlabel.interpolate({
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
										fontSize: ios ? 11 : 12,
									}}
								>
									{tab.label}
								</Text>
							</Animated.View>
						</Pressable>
					);
				})}
				{!floatingBar && searchAction && (
					// Search sits at the bar's right end, with the tabs on its left.
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Search"
						style={styles.tab}
						onPress={searchAction}
					>
						<Icon name="search" color={colors.muted} size={ios ? 25 : 24} />
						<View style={styles.label}>
							<Text
								numberOfLines={1}
								style={{
									color: colors.muted,
									fontWeight: '500',
									fontSize: ios ? 11 : 12,
								}}
							>
								Search
							</Text>
						</View>
					</Pressable>
				)}
			</Animated.View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	docked: {position: 'absolute', left: 0, right: 0, bottom: 0},
	floating: {position: 'absolute', alignItems: 'flex-start'},
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
	label: {marginTop: 3},
	// A pill behind the icon and its label, centered in the tab with room above and below.
	indicator: {
		position: 'absolute',
		top: (DOCKED_HEIGHT - PILL_HEIGHT) / 2,
		width: 80,
		height: PILL_HEIGHT,
		borderRadius: PILL_HEIGHT / 2,
	},
});
