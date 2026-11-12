import {type ReactNode, useRef} from 'react';
import {Animated, PanResponder, StyleSheet, Text, View} from 'react-native';
import {useColors} from './theme';
import {Icon, type IconName} from './ui';

type SwipeAction = {
	label: string;
	icon: IconName;
	color: string;
	onTrigger: () => void;
};

const TRIGGER = 88;
const MAX = 140;

/**
A row that slides sideways to reveal an action: swipe right for `left`, swipe left for `right`. Passing the
threshold and letting go runs the action and the row springs back. Screen reader users get the same actions through
`accessibilityActions` on the row itself, so nothing depends on the gesture.
*/
export function SwipeRow({
	children,
	left,
	right,
	disabled = false,
}: {
	children: ReactNode;
	left?: SwipeAction;
	right?: SwipeAction;
	disabled?: boolean;
}) {
	const colors = useColors();
	const x = useRef(new Animated.Value(0)).current;
	const latestRef = useRef({left, right, disabled});
	latestRef.current = {left, right, disabled};

	const pan = useRef(
		PanResponder.create({
			onMoveShouldSetPanResponder: (_event, gesture) =>
				!latestRef.current.disabled &&
				Math.abs(gesture.dx) > 12 &&
				Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
			onPanResponderMove(_event, gesture) {
				const {left: l, right: r} = latestRef.current;
				const dx = gesture.dx > 0 ? (l ? gesture.dx : 0) : r ? gesture.dx : 0;
				x.setValue(Math.max(-MAX, Math.min(MAX, dx)));
			},
			onPanResponderRelease(_event, gesture) {
				const {left: l, right: r} = latestRef.current;
				if (gesture.dx > TRIGGER && l) {
					l.onTrigger();
				} else if (gesture.dx < -TRIGGER && r) {
					r.onTrigger();
				}

				Animated.spring(x, {
					toValue: 0,
					useNativeDriver: true,
					friction: 8,
				}).start();
			},
			onPanResponderTerminate() {
				Animated.spring(x, {toValue: 0, useNativeDriver: true}).start();
			},
		}),
	).current;

	const reveal = (action: SwipeAction | undefined, side: 'left' | 'right') => {
		if (!action) {
			return null;
		}

		const range = side === 'left' ? [0, TRIGGER] : [-TRIGGER, 0];
		return (
			<View
				pointerEvents="none"
				importantForAccessibility="no-hide-descendants"
				style={[
					StyleSheet.absoluteFill,
					styles.action,
					{
						backgroundColor: action.color,
						justifyContent: 'center',
						alignItems: side === 'left' ? 'flex-start' : 'flex-end',
					},
				]}
			>
				<Animated.View
					style={[
						styles.glyph,
						{
							opacity: x.interpolate({
								inputRange: range,
								outputRange: side === 'left' ? [0, 1] : [1, 0],
								extrapolate: 'clamp',
							}),
							transform: [
								{
									scale: x.interpolate({
										inputRange: range,
										outputRange: side === 'left' ? [0.7, 1.1] : [1.1, 0.7],
										extrapolate: 'clamp',
									}),
								},
							],
						},
					]}
				>
					<Icon name={action.icon} color="#ffffff" />
					<Text style={styles.label}>{action.label}</Text>
				</Animated.View>
			</View>
		);
	};

	return (
		<View style={styles.wrap}>
			{reveal(left, 'left')}
			{reveal(right, 'right')}
			<Animated.View
				{...pan.panHandlers}
				style={{
					backgroundColor: colors.background,
					transform: [{translateX: x}],
				}}
			>
				{children}
			</Animated.View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrap: {overflow: 'hidden'},
	action: {paddingHorizontal: 20},
	glyph: {alignItems: 'center', gap: 2},
	label: {color: '#ffffff', fontSize: 12, fontWeight: '600'},
});
