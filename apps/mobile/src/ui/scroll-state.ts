import {useSyncExternalStore} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';

const STEP = 8;
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
