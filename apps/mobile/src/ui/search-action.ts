import {useSyncExternalStore} from 'react';

let action: (() => void) | undefined;
const listeners = new Set<() => void>();

/**
Sets what the docked tab bar's search button does, or removes the button with `undefined`. The screen that is showing
registers its own search, so the button is there only where there is something to search.
*/
export function setSearchAction(next: (() => void) | undefined): void {
	action = next;
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
The search the current screen offers to the docked tab bar, if any.
*/
export function useSearchAction(): (() => void) | undefined {
	return useSyncExternalStore(subscribe, () => action);
}
