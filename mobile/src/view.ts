import {useSyncExternalStore} from 'react';

/**
Which library the screens show: the regular one, or the private windows' library (read only).
*/
export type View = 'regular' | 'private';

let current: View = 'regular';
const listeners = new Set<() => void>();

export function setView(view: View): void {
	current = view;
	for (const listener of listeners) {
		listener();
	}
}

export const useView = (): View =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);
