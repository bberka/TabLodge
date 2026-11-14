import {useSyncExternalStore} from 'react';
import {Animated, Dimensions, Easing, Keyboard, TextInput} from 'react-native';
import {motion} from './motion';

let height = 0;
let watching = false;
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
	Keyboard.addListener('keyboardDidShow', (event) => {
		// The reported height stops at the navigation bar, but the keyboard is drawn behind it: what it covers is
		// everything from its top edge to the bottom of the screen.
		setHeight(
			Math.max(
				event.endCoordinates.height,
				Dimensions.get('screen').height - event.endCoordinates.screenY,
			),
		);
	});
	Keyboard.addListener('keyboardDidHide', () => {
		setHeight(0);
	});
}

/**
Android does not always report the keyboard closing, for example when the input that had it goes away with a drawer, and
a keyboard that is thought to be open leaves the next drawer or dialog floating in the middle of the screen. With no
input focused there can be no keyboard, so this puts the height back to 0. Call it a moment after something opens, once
an input that asks for focus has had it.
*/
export function settleKeyboard(): void {
	if (height > 0 && !TextInput.State.currentlyFocusedInput()) {
		setHeight(0);
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
