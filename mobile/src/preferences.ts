/*
Settings that belong to this phone only and never sync: how the app looks. Loaded once at startup; screens read
them with `usePreferences`.
*/
import {Platform} from 'react-native';
import {useSyncExternalStore} from 'react';
import {readJson, writeJson} from './storage';

export type Look = 'material' | 'ios';

type Preferences = {
	/**
	Which platform's design the app imitates. Defaults to the phone's own.
	*/
	look: Look;
	/**
	A rounded bar that floats above the content, instead of one fixed to the bottom edge.
	*/
	floatingBar: boolean;
	/**
	The column the last link was saved to, offered first next time.
	*/
	lastColumnId: string;
};

const KEY = 'tablodge.prefs';

const defaults: Preferences = {
	look: Platform.OS === 'ios' ? 'ios' : 'material',
	floatingBar: false,
	lastColumnId: '',
};

let current = defaults;
const listeners = new Set<() => void>();

export async function loadPreferences(): Promise<void> {
	const saved = await readJson(KEY);
	if (typeof saved !== 'object' || saved === null) {
		return;
	}

	const {look, floatingBar, lastColumnId} = saved as Partial<Preferences>;
	current = {
		look: look === 'ios' || look === 'material' ? look : defaults.look,
		floatingBar:
			typeof floatingBar === 'boolean' ? floatingBar : defaults.floatingBar,
		lastColumnId: typeof lastColumnId === 'string' ? lastColumnId : '',
	};
	for (const listener of listeners) {
		listener();
	}
}

export function setPreferences(change: Partial<Preferences>): void {
	current = {...current, ...change};
	for (const listener of listeners) {
		listener();
	}

	void writeJson(KEY, current);
}

export const getPreferences = (): Preferences => current;

export const usePreferences = (): Preferences =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);
