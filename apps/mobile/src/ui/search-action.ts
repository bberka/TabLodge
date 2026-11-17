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

let searching = false;
const searchListeners = new Set<() => void>();

/**
Marks whether a screen's search is open, so a floating tab bar can step aside for it.
*/
export function setSearching(next: boolean): void {
	searching = next;
	for (const listener of searchListeners) {
		listener();
	}
}

/**
Whether a search is open now.
*/
export function useSearching(): boolean {
	return useSyncExternalStore(
		(listener) => {
			searchListeners.add(listener);
			return () => {
				searchListeners.delete(listener);
			};
		},
		() => searching,
	);
}

let searchWanted = false;
const wantListeners = new Set<() => void>();

/**
Asks Bookmarks to open its search, for the Quick Settings tile. Bookmarks takes the request once it shows.
*/
export function requestSearch(): void {
	searchWanted = true;
	for (const listener of wantListeners) {
		listener();
	}
}

/**
Whether a search was asked for and not yet taken.
*/
export function useSearchWanted(): boolean {
	return useSyncExternalStore(
		(listener) => {
			wantListeners.add(listener);
			return () => {
				wantListeners.delete(listener);
			};
		},
		() => searchWanted,
	);
}

/**
Takes the waiting search request: true once, then false until the next one.
*/
export function takeSearchRequest(): boolean {
	const wanted = searchWanted;
	searchWanted = false;
	return wanted;
}
