import {useSyncExternalStore} from 'react';
import {
	Animated,
	AppState,
	Dimensions,
	Easing,
	Keyboard,
	TextInput,
} from 'react-native';
import {nativeKeyboardHeight} from '../../modules/open-links';
import {motion} from './motion';

const VERIFY_AFTER_MS = 500;

const SNAP_AFTER_MS = 400;

const POLL_MS = 500;

let height = 0;
let watching = false;
let poller: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const inset = new Animated.Value(0);

function setHeight(next: number): void {
	if (next === height) {
		return;
	}

	height = next;
	for (const listener of listeners) {
		listener();
	}

	if (next > 0 && poller === undefined) {
		poller = setInterval(settleKeyboard, POLL_MS);
	} else if (next === 0 && poller !== undefined) {
		clearInterval(poller);
		poller = undefined;
	}

	inset.stopAnimation();
	Animated.timing(inset, {
		toValue: next,
		duration: motion(220),
		easing: Easing.out(Easing.cubic),
		useNativeDriver: false,
	}).start();
	setTimeout(() => {
		if (height === next) {
			inset.setValue(next);
		}
	}, SNAP_AFTER_MS);
}

function watch(): void {
	if (watching) {
		return;
	}

	watching = true;
	const verify = () => {
		setTimeout(settleKeyboard, VERIFY_AFTER_MS);
	};

	AppState.addEventListener('change', (state) => {
		if (state === 'active') {
			settleKeyboard();
		}
	});
	Keyboard.addListener('keyboardDidShow', (event) => {
		setHeight(
			Math.max(
				event.endCoordinates.height,
				Dimensions.get('screen').height - event.endCoordinates.screenY,
			),
		);
		verify();
	});
	Keyboard.addListener('keyboardDidHide', () => {
		setHeight(0);
		verify();
	});
}

export function settleKeyboard(): void {
	if (height > 0 && !TextInput.State.currentlyFocusedInput()) {
		setHeight(0);
		return;
	}

	const actual = nativeKeyboardHeight();
	if (actual === undefined) {
		return;
	}

	if (height > 0 && actual === 0) {
		setHeight(0);
	} else if (height === 0 && actual > 0) {
		setHeight(actual);
	}
}

export function useKeyboardHeight(): number {
	watch();
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => height,
	);
}

export function keyboardInset(): Animated.Value {
	watch();
	return inset;
}

export function useRoomBelow(space: number): number {
	const keyboard = useKeyboardHeight();
	return keyboard > 0 ? keyboard : space;
}
