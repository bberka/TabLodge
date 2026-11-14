import {useSyncExternalStore} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';

// How far a list has to move before the bar reacts, so a finger's jitter does not flip it.
const STEP = 8;
// Near the top the bar is always full.
const TOP = 24;

let scrolledDown = false;
let lastY = 0;
const listeners = new Set<() => void>();

function set(next: boolean): void {
	if (next === scrolledDown) {
		return;
	}

	scrolledDown = next;
	for (const listener of listeners) {
		listener();
	}
}

/**
Pass as a list's `onScroll`: scrolling down marks the page as scrolled, scrolling up or reaching the top clears it.
*/
export function trackScroll(
	event: NativeSyntheticEvent<NativeScrollEvent>,
): void {
	const y = Math.max(event.nativeEvent.contentOffset.y, 0);
	const delta = y - lastY;
	if (y <= TOP) {
		set(false);
	} else if (delta > STEP) {
		set(true);
	} else if (delta < -STEP) {
		set(false);
	}

	if (Math.abs(delta) > STEP || y <= TOP) {
		lastY = y;
	}
}

/**
Forgets the scroll position, for when another screen comes up.
*/
export function resetScroll(): void {
	lastY = 0;
	set(false);
}

export const isScrolledDown = (): boolean => scrolledDown;

export const useScrolledDown = (): boolean =>
	useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, isScrolledDown);
