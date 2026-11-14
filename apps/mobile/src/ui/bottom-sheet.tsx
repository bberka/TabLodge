import {type ReactNode, useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Modal,
	PanResponder,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {keyboardInset, settleKeyboard} from './keyboard';
import {motion, spring} from './motion';
import {useColors, useShape} from './theme';

const CLOSE_DRAG = 80;
const CLOSE_VELOCITY = 0.8;

/**
A drawer that slides up from the bottom and is only as tall as its content. A tap on the dimmed area, the Android
back button, a swipe down on the handle, or the content's own close button dismisses it; the parent owns `visible`.
While the keyboard is open the drawer shrinks to the room above it and its content scrolls. Content that is a scrolling
list itself passes `scroll={false}` to keep its own scrolling.
*/
export function BottomSheet({
	visible,
	onClose,
	label,
	scroll = true,
	children,
}: {
	visible: boolean;
	onClose: () => void;
	label: string;
	scroll?: boolean;
	children: ReactNode;
}) {
	// The drawer is only mounted while it is open or sliding away, so every opening starts from a clean state: nothing
	// measured, nothing animated, and so nothing left over from the last time to flash on the first frame.
	const [mounted, setMounted] = useState(visible);
	if (visible && !mounted) {
		setMounted(true);
	}

	if (!mounted) {
		return null;
	}

	return (
		<Modal
			hardwareAccelerated
			transparent
			statusBarTranslucent
			navigationBarTranslucent
			visible
			animationType="none"
			onRequestClose={onClose}
		>
			<Sheet
				open={visible}
				label={label}
				scroll={scroll}
				onClose={onClose}
				onGone={() => {
					setMounted(false);
				}}
			>
				{children}
			</Sheet>
		</Modal>
	);
}

function Sheet({
	open,
	onClose,
	onGone,
	label,
	scroll,
	children,
}: {
	open: boolean;
	onClose: () => void;
	onGone: () => void;
	label: string;
	scroll: boolean;
	children: ReactNode;
}) {
	const colors = useColors();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const [height, setHeight] = useState(0);
	// 0 is open; `height` is fully below the screen. It starts far below, and the sheet is hidden until measured.
	const slide = useRef(new Animated.Value(1000)).current;
	const scrim = useRef(new Animated.Value(0)).current;
	const keyboard = keyboardInset();
	const heightRef = useRef(0);
	heightRef.current = height;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const goneRef = useRef(onGone);
	goneRef.current = onGone;
	const openedRef = useRef(false);
	// A keyboard left over from an earlier input would push this drawer up for nothing.
	useEffect(() => {
		settleKeyboard();
		const timer = setTimeout(settleKeyboard, 400);
		return () => {
			clearTimeout(timer);
		};
	}, []);

	// The open animation runs once. The content can change size a moment after it is first measured (icons loading, a
	// scroll area settling), and restarting the slide for each of those made the drawer flicker.
	useEffect(() => {
		if (height === 0) {
			return;
		}

		if (open) {
			if (openedRef.current) {
				return;
			}

			openedRef.current = true;
			Animated.parallel([
				Animated.timing(slide, {
					toValue: 0,
					duration: motion(260),
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(scrim, {
					toValue: 1,
					duration: motion(260),
					useNativeDriver: true,
				}),
			]).start();
			return;
		}

		openedRef.current = false;
		Animated.parallel([
			Animated.timing(slide, {
				toValue: height,
				duration: motion(200),
				easing: Easing.in(Easing.cubic),
				useNativeDriver: true,
			}),
			Animated.timing(scrim, {
				toValue: 0,
				duration: motion(200),
				useNativeDriver: true,
			}),
		]).start(({finished}) => {
			if (finished) {
				goneRef.current();
			}
		});
	}, [open, height, slide, scrim]);

	// A drawer closed before it was ever measured has nothing to animate away.
	useEffect(() => {
		if (!open && heightRef.current === 0) {
			goneRef.current();
		}
	}, [open]);

	const drag = useRef(
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onPanResponderMove(_event, gesture) {
				slide.setValue(Math.max(0, gesture.dy));
			},
			onPanResponderRelease(_event, gesture) {
				if (gesture.dy > CLOSE_DRAG || gesture.vy > CLOSE_VELOCITY) {
					closeRef.current();
				} else {
					spring(slide, 0).start();
				}
			},
		}),
	).current;

	return (
		// The room the keyboard takes is padding here, so the drawer inside shrinks to what is left above it. It is a
		// layout value, so it animates on the JS thread, apart from the drawer's own slide on the native one.
		<Animated.View
			style={[
				styles.root,
				{paddingTop: insets.top + 8, paddingBottom: keyboard},
			]}
		>
			<Animated.View
				style={[styles.scrim, {opacity: scrim}]}
				importantForAccessibility="no"
			>
				<Pressable
					accessibilityLabel="Close"
					accessibilityRole="button"
					style={StyleSheet.absoluteFill}
					onPress={onClose}
				/>
			</Animated.View>
			<Animated.View
				accessibilityViewIsModal
				accessibilityLabel={label}
				style={[
					styles.sheet,
					{
						backgroundColor: colors.surface,
						borderTopLeftRadius: shape.sheetRadius,
						borderTopRightRadius: shape.sheetRadius,
						// Hidden until measured, so it does not flash at the wrong place.
						opacity: height > 0 ? 1 : 0,
						transform: [{translateY: slide}],
					},
				]}
				onLayout={(event) => {
					const next = event.nativeEvent.layout.height;
					if (!(next > 0 && Math.abs(next - heightRef.current) > 0.5)) {
						return;
					}

					// The first measurement places the sheet just below the screen before it is shown.
					if (heightRef.current === 0) {
						slide.setValue(next);
					}

					setHeight(next);
				}}
			>
				<Animated.View
					style={[
						styles.inner,
						{
							// The keyboard covers the bottom edge, so its room replaces the bottom inset.
							paddingBottom: keyboard.interpolate({
								inputRange: [0, 120],
								outputRange: [Math.max(insets.bottom, 16), 8],
								extrapolate: 'clamp',
							}),
						},
					]}
				>
					<View
						{...drag.panHandlers}
						accessible={false}
						style={styles.handleArea}
					>
						<View style={[styles.handle, {backgroundColor: colors.border}]} />
					</View>
					{scroll ? (
						<ScrollView
							bounces={false}
							keyboardShouldPersistTaps="handled"
							showsVerticalScrollIndicator={false}
							style={styles.scroll}
						>
							{children}
						</ScrollView>
					) : (
						<View style={styles.fill}>{children}</View>
					)}
				</Animated.View>
			</Animated.View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	root: {flex: 1, justifyContent: 'flex-end'},
	scrim: {
		...StyleSheet.absoluteFill,
		backgroundColor: 'rgba(0,0,0,0.45)',
	},
	sheet: {
		borderTopLeftRadius: 28,
		borderTopRightRadius: 28,
		maxHeight: '100%',
		elevation: 12,
	},
	// Shrinks with the drawer, so a tall body gives way to the keyboard and scrolls instead of running off the top.
	inner: {flexShrink: 1},
	scroll: {flexGrow: 0},
	fill: {flexShrink: 1},
	handleArea: {height: 28, alignItems: 'center', justifyContent: 'center'},
	handle: {width: 36, height: 4, borderRadius: 2},
});
