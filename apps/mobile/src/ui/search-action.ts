import {useSyncExternalStore} from 'react';

let action: (() => void) | undefined;
const listeners = new Set<() => void>();

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

export function useSearchAction(): (() => void) | undefined {
	return useSyncExternalStore(subscribe, () => action);
}

let searching = false;
const searchListeners = new Set<() => void>();

export function setSearching(next: boolean): void {
	searching = next;
	for (const listener of searchListeners) {
		listener();
	}
}

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

export function requestSearch(): void {
	searchWanted = true;
	for (const listener of wantListeners) {
		listener();
	}
}

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

export function takeSearchRequest(): boolean {
	const wanted = searchWanted;
	searchWanted = false;
	return wanted;
}
