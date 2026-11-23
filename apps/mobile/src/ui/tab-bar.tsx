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
import {GlassBackdrop, useGlass} from './glass';
import {useKeyboardHeight} from './keyboard';
import {motion, spring} from './motion';
import {resetScroll, useScrolledDown} from './scroll-state';
import {useSearching, useSearchAction} from './search-action';
import {BAR_HEIGHT, useColors, useShape} from './theme';
import {Icon, type IconName} from './widgets';

export type BarTab<T extends string> = {
	id: T;
	label: string;
	icon: IconName;
	active: IconName;
};

const DOCKED_HEIGHT = 76;
const PILL_HEIGHT = 56;
const COMPACT_HEIGHT = 56;
const COMPACT_TAB_WIDTH = 68;
const COMPACT_ICON_SCALE = 1.2;
const BAR_PADDING = 6;

export function useBarSpace(): number {
	const insets = useSafeAreaInsets();
	const {floatingBar, barSize} = usePreferences();
	const {barGap} = useShape();
	const floating =
		(barSize === 'compact' ? COMPACT_HEIGHT : BAR_HEIGHT) + barGap * 2;
	return (floatingBar ? floating : DOCKED_HEIGHT) + insets.bottom;
}

const SIDE_BUTTON = BAR_HEIGHT;
const SIDE_MARGIN = 16;
const SIDE_GAP = 12;

export function useBarHeight(): number {
	const {floatingBar, barSize} = usePreferences();
	const scrolledDown = useScrolledDown();
	const small =
		floatingBar &&
		(barSize === 'compact' || (barSize === 'scroll' && scrolledDown));
	return small ? COMPACT_HEIGHT : BAR_HEIGHT;
}

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
	const {look: chosen, floatingBar, barSize, barLabels} = usePreferences();
	const look = resolveLook(chosen);
	const {barGap} = useShape();
	const scrolledDown = useScrolledDown();
	const small =
		floatingBar &&
		(barSize === 'compact' || (barSize === 'scroll' && scrolledDown));
	const ios = look === 'ios';
	const glass = useGlass() && floatingBar;
	const count = tabs.length;
	const index = Math.max(
		0,
		tabs.findIndex((tab) => tab.id === selected),
	);
	const keyboard = useKeyboardHeight() > 0;
	const searchAction = useSearchAction();
	const shrink = useRef(new Animated.Value(small ? 1 : 0)).current;
	const shown = (i: number) =>
		!small &&
		(barLabels === 'always' || (barLabels === 'active' && i === index));
	const labels = useRef(
		tabs.map((_, i) => new Animated.Value(shown(i) ? 1 : 0)),
	).current;
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
		for (const [i, label] of labels.entries()) {
			Animated.timing(label, {
				toValue:
					!small &&
					(barLabels === 'always' || (barLabels === 'active' && i === index))
						? 1
						: 0,
				duration: motion(220),
				easing: Easing.out(Easing.cubic),
				useNativeDriver: false,
			}).start();
		}
	}, [small, barLabels, index, labels]);

	useEffect(() => {
		spring(slide, index, {friction: 9, tension: 90, native: false}).start();
		for (const [i, pop] of pops.entries()) {
			spring(pop, i === index ? 1 : 0, {friction: 6, tension: 160}).start();
		}
	}, [index, slide, pops]);

	const searching = useSearching() && floatingBar;
	const away = keyboard || forceHidden || searching;
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
	const sideRoom = SIDE_MARGIN + SIDE_BUTTON + SIDE_GAP;
	const fullWidth = screenWidth - barGap - sideRoom;
	const smallWidth = COMPACT_TAB_WIDTH * count + BAR_PADDING * 2;
	const smallLeft = Math.min(
		(screenWidth - smallWidth) / 2,
		screenWidth - SIDE_MARGIN - SIDE_BUTTON - 4 - smallWidth,
	);
	const tabWidth = shrink.interpolate({
		inputRange: [0, 1],
		outputRange: [(fullWidth - BAR_PADDING * 2) / count, COMPACT_TAB_WIDTH],
	});
	const labelHeight = ios ? 14 : 16;

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
					{
						backgroundColor: glass ? 'transparent' : colors.surface,
						borderColor: colors.border,
					},
					glass && styles.glass,
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
				{glass && <GlassBackdrop kind="bar" />}
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
								style={{
									overflow: 'hidden',
									opacity: labels[i],
									height: labels[i].interpolate({
										inputRange: [0, 1],
										outputRange: [0, labelHeight],
									}),
									marginTop: labels[i].interpolate({
										inputRange: [0, 1],
										outputRange: [0, floatingBar ? 2 : 3],
									}),
								}}
							>
								<Text
									numberOfLines={1}
									maxFontSizeMultiplier={1}
									style={{
										color: ink,
										fontWeight: on && !ios ? '700' : '500',
										fontSize: ios ? 11 : 12,
										lineHeight: labelHeight,
									}}
								>
									{tab.label}
								</Text>
							</Animated.View>
						</Pressable>
					);
				})}
				{!floatingBar && searchAction && (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Search"
						style={styles.tab}
						onPress={searchAction}
					>
						<Icon name="search" color={colors.muted} size={ios ? 25 : 24} />
						{barLabels === 'always' && (
							<View style={styles.label}>
								<Text
									numberOfLines={1}
									maxFontSizeMultiplier={1}
									style={{
										color: colors.muted,
										fontWeight: '500',
										fontSize: ios ? 11 : 12,
										lineHeight: labelHeight,
									}}
								>
									Search
								</Text>
							</View>
						)}
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
	glass: {overflow: 'hidden', borderWidth: 0, elevation: 4},
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
	indicator: {
		position: 'absolute',
		top: (DOCKED_HEIGHT - PILL_HEIGHT) / 2,
		width: 80,
		height: PILL_HEIGHT,
		borderRadius: PILL_HEIGHT / 2,
	},
});
