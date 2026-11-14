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

// How long after a keyboard event the window is asked again, once the keyboard has stopped moving.
const VERIFY_AFTER_MS = 500;

// While the keyboard is believed open, the window is asked this often whether it still is, since Android sometimes
// closes it without saying so.
const POLL_MS = 500;

let height = 0;
let watching = false;
let poller: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
// An animated copy of the height, for layout that follows the keyboard. It feeds layout, so it runs on the JS thread.
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

	Animated.timing(inset, {
		toValue: next,
		duration: motion(220),
		easing: Easing.out(Easing.cubic),
		useNativeDriver: false,
	}).start();
}

function watch(): void {
	if (watching) {
		return;
	}

	watching = true;
	// Whatever the events said, the window has the last word a moment after they settle.
	const verify = () => {
		setTimeout(settleKeyboard, VERIFY_AFTER_MS);
	};

	AppState.addEventListener('change', (state) => {
		if (state === 'active') {
			settleKeyboard();
		}
	});
	Keyboard.addListener('keyboardDidShow', (event) => {
		// The reported height stops at the navigation bar, but the keyboard is drawn behind it: what it covers is
		// everything from its top edge to the bottom of the screen.
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

/**
Android does not always report the keyboard closing, for example when the input that had it goes away with a drawer, and
a keyboard that is thought to be open leaves the next drawer or dialog floating in the middle of the screen. This asks
the window how tall the keyboard is and corrects what is believed, in either direction. Without native support it
falls back to the one thing that is certain: with no input focused there is no keyboard.
*/
export function settleKeyboard(): void {
	const actual = nativeKeyboardHeight();
	if (actual === undefined) {
		if (height > 0 && !TextInput.State.currentlyFocusedInput()) {
			setHeight(0);
		}

		return;
	}

	if (height > 0 && actual === 0) {
		setHeight(0);
	} else if (height === 0 && actual > 0) {
		setHeight(actual);
	}
}

/**
How tall the on-screen keyboard is now, or 0 while it is closed. Changes in one step; a list uses it as bottom room so
its last rows can scroll clear of the keyboard.
*/
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

/**
The keyboard's height as an animated value that eases in and out with it, for a layout that must move smoothly, such as
the room a drawer leaves for the keyboard.
*/
export function keyboardInset(): Animated.Value {
	watch();
	return inset;
}

/**
The room a screen leaves at its bottom: the keyboard's height while it is open, otherwise `space`, which is what the
tab bar takes. The tab bar is out of the way while the keyboard is up, so the two never add up.
*/
export function useRoomBelow(space: number): number {
	const keyboard = useKeyboardHeight();
	return keyboard > 0 ? keyboard : space;
}
