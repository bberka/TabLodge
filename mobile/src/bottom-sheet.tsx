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
	const colors = useColors();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const [mounted, setMounted] = useState(visible);
	const [height, setHeight] = useState(0);
	// 0 is open; `height` is fully below the screen.
	const slide = useRef(new Animated.Value(1000)).current;
	const scrim = useRef(new Animated.Value(0)).current;
	const lift = useRef(new Animated.Value(0)).current;
	const heightRef = useRef(0);
	heightRef.current = height;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	useEffect(() => {
		if (visible) {
			setMounted(true);
		}
	}, [visible]);

	useEffect(() => {
		if (!mounted) {
			return;
		}

		if (visible && height > 0) {
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
		} else if (!visible && height > 0) {
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
					setMounted(false);
				}
			});
		}
	}, [visible, mounted, height, slide, scrim]);

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
		<Modal
			transparent
			statusBarTranslucent
			navigationBarTranslucent
			visible={mounted}
			animationType="none"
			onRequestClose={onClose}
		>
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
		</Modal>
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
