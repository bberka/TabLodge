import {type ReactNode, useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Keyboard,
	Modal,
	PanResponder,
	Pressable,
	StyleSheet,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useColors, useShape} from './theme';

const CLOSE_DRAG = 80;
const CLOSE_VELOCITY = 0.8;

/**
A drawer that slides up from the bottom and is only as tall as its content. A tap on the dimmed area, the Android
back button, a swipe down on the handle, or the content's own close button dismisses it; the parent owns `visible`.
*/
export function BottomSheet({
	visible,
	onClose,
	label,
	children,
}: {
	visible: boolean;
	onClose: () => void;
	label: string;
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
	children,
}: {
	open: boolean;
	onClose: () => void;
	onGone: () => void;
	label: string;
	children: ReactNode;
}) {
	const colors = useColors();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const [height, setHeight] = useState(0);
	// 0 is open; `height` is fully below the screen. It starts far below, and the sheet is hidden until measured.
	const slide = useRef(new Animated.Value(1000)).current;
	const scrim = useRef(new Animated.Value(0)).current;
	const lift = useRef(new Animated.Value(0)).current;
	const heightRef = useRef(0);
	heightRef.current = height;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const goneRef = useRef(onGone);
	goneRef.current = onGone;
	const openedRef = useRef(false);

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
					duration: 260,
					easing: Easing.out(Easing.cubic),
					useNativeDriver: true,
				}),
				Animated.timing(scrim, {
					toValue: 1,
					duration: 260,
					useNativeDriver: true,
				}),
			]).start();
			return;
		}

		openedRef.current = false;
		Animated.parallel([
			Animated.timing(slide, {
				toValue: height,
				duration: 200,
				easing: Easing.in(Easing.cubic),
				useNativeDriver: true,
			}),
			Animated.timing(scrim, {
				toValue: 0,
				duration: 200,
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

	// The keyboard lifts the sheet, since a Modal is not resized by the window.
	useEffect(() => {
		const show = Keyboard.addListener('keyboardDidShow', (event) => {
			Animated.timing(lift, {
				toValue: event.endCoordinates.height,
				duration: 180,
				useNativeDriver: true,
			}).start();
		});
		const hide = Keyboard.addListener('keyboardDidHide', () => {
			Animated.timing(lift, {
				toValue: 0,
				duration: 180,
				useNativeDriver: true,
			}).start();
		});
		return () => {
			show.remove();
			hide.remove();
		};
	}, [lift]);

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
					Animated.spring(slide, {
						toValue: 0,
						useNativeDriver: true,
					}).start();
				}
			},
		}),
	).current;

	return (
		<View style={styles.root}>
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
						paddingBottom: Math.max(insets.bottom, 16),
						// Hidden until measured, so it does not flash at the wrong place.
						opacity: height > 0 ? 1 : 0,
						transform: [{translateY: Animated.subtract(slide, lift)}],
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
				<View
					{...drag.panHandlers}
					accessible={false}
					style={styles.handleArea}
				>
					<View style={[styles.handle, {backgroundColor: colors.border}]} />
				</View>
				{children}
			</Animated.View>
		</View>
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
		maxHeight: '88%',
		elevation: 12,
	},
	handleArea: {height: 28, alignItems: 'center', justifyContent: 'center'},
	handle: {width: 36, height: 4, borderRadius: 2},
});
