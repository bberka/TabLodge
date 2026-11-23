import {type ReactNode, useEffect, useRef, useState} from 'react';
import {
	Animated,
	Easing,
	Modal,
	PanResponder,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {keyboardInset, settleKeyboard} from './keyboard';
import {motion, spring} from './motion';
import {useColors, useShape} from './theme';
import {IconButton} from './widgets';

const CLOSE_DRAG = 80;
const CLOSE_VELOCITY = 0.8;

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
	useEffect(() => {
		settleKeyboard();
		const timer = setTimeout(settleKeyboard, 400);
		return () => {
			clearTimeout(timer);
		};
	}, []);

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
						opacity: height > 0 ? 1 : 0,
						transform: [{translateY: slide}],
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
				<Animated.View
					style={[
						styles.inner,
						{
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

export function SheetHeader({
	title,
	onClose,
}: {
	title: string;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<View style={styles.header}>
			<Text
				accessibilityRole="header"
				style={[styles.title, {color: colors.text}]}
			>
				{title}
			</Text>
			<IconButton icon="close" label="Close" onPress={onClose} />
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
		maxHeight: '100%',
		elevation: 12,
	},
	inner: {flexShrink: 1},
	scroll: {flexGrow: 0},
	fill: {flexShrink: 1},
	handleArea: {height: 28, alignItems: 'center', justifyContent: 'center'},
	handle: {width: 36, height: 4, borderRadius: 2},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {fontSize: 20, fontWeight: '700'},
});
