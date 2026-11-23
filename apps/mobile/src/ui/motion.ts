import {useEffect, useRef} from 'react';
import {AccessibilityInfo, Animated} from 'react-native';

const SPEED = 0.65;
const SPRING_TENSION = 1.5;
const SPRING_FRICTION = 1.2;

let reduced = false;
let watching = false;

function watch(): void {
	if (watching) {
		return;
	}

	watching = true;
	void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
		reduced = on;
	});
	AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
		reduced = on;
	});
}

export function motion(base: number): number {
	watch();
	return reduced ? 0 : Math.round(base * SPEED);
}

export function spring(
	value: Animated.Value,
	toValue: number,
	{
		friction = 7,
		tension = 40,
		native = true,
	}: {friction?: number; tension?: number; native?: boolean} = {},
): Animated.CompositeAnimation {
	watch();
	if (reduced) {
		return Animated.timing(value, {
			toValue,
			duration: 0,
			useNativeDriver: native,
		});
	}

	return Animated.spring(value, {
		toValue,
		friction: friction * SPRING_FRICTION,
		tension: tension * SPRING_TENSION,
		useNativeDriver: native,
	});
}

export function useCrossfade(key: unknown): Animated.Value {
	const opacity = useRef(new Animated.Value(1)).current;
	const firstRef = useRef(true);
	useEffect(() => {
		if (firstRef.current) {
			firstRef.current = false;
			return;
		}

		opacity.setValue(0);
		Animated.timing(opacity, {
			toValue: 1,
			duration: motion(220),
			useNativeDriver: true,
		}).start();
	}, [key, opacity]);
	return opacity;
}
