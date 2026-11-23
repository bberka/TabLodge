import {useSyncExternalStore} from 'react';
import type {Jump} from './search-elsewhere';

let pending: Jump | undefined;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) {
		listener();
	}
};

export function requestJump(jump: Jump): void {
	pending = jump;
	emit();
}

export function takeJump<T extends Jump['screen']>(
	screen: T,
): Extract<Jump, {screen: T}> | undefined {
	if (pending?.screen !== screen) {
		return undefined;
	}

	const jump = pending as Extract<Jump, {screen: T}>;
	pending = undefined;
	return jump;
}

export function usePendingJump(): Jump | undefined {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => pending,
	);
}
