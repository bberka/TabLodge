import {useEffect, useRef} from 'react';
import {AccessibilityInfo, Animated} from 'react-native';

// Every animation in the app runs at this fraction of its drawn out length, so the app feels quick.
const SPEED = 0.65;
const SPRING_TENSION = 1.5;
const SPRING_FRICTION = 1.2;

// Android's "Remove animations" (and iOS's Reduce Motion) turn this on; the app then jumps straight to the end state.
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

/**
A duration in milliseconds, shortened for the app's pace, or 0 when the system asks for no animations.
*/
export function motion(base: number): number {
	watch();
	return reduced ? 0 : Math.round(base * SPEED);
}

/**
A spring toward `toValue`, stiffer than React Native's default so it settles fast. With the system's reduced motion it
becomes an instant jump.
*/
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

/**
Fades a screen's content back in each time `key` changes, but not when it first shows, so going between a list and one
item of it is not a hard cut.
*/
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
