/*
Settings that belong to this phone only and never sync: how the app looks. Loaded once at startup; screens read
them with `usePreferences`.
*/
import {Platform} from 'react-native';
import {useSyncExternalStore} from 'react';
import {readJson, writeJson} from './storage';

export type Look = 'material' | 'ios';

/**
What a swipe on a bookmark does.
*/
export type RowAction = 'none' | 'open' | 'edit' | 'move' | 'delete';
export const ROW_ACTIONS: readonly RowAction[] = [
	'none',
	'open',
	'edit',
	'move',
	'delete',
];

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
	/**
	What tapping a bookmark does.
	*/
	tapAction: 'open' | 'edit';
	/**
	What swiping a bookmark to the right, and to the left, does.
	*/
	swipeRight: RowAction;
	swipeLeft: RowAction;
	/**
	Remove tracking parameters (utm_source and the like) from a link when it is saved.
	*/
	cleanOnSave: boolean;
};

const KEY = 'tablodge.prefs';

const defaults: Preferences = {
	look: Platform.OS === 'ios' ? 'ios' : 'material',
	floatingBar: false,
	lastColumnId: '',
	tapAction: 'open',
	swipeRight: 'delete',
	swipeLeft: 'edit',
	cleanOnSave: true,
};

const rowAction = (value: unknown, fallback: RowAction): RowAction =>
	ROW_ACTIONS.find((action) => action === value) ?? fallback;

let current = defaults;
const listeners = new Set<() => void>();

export async function loadPreferences(): Promise<void> {
	const saved = await readJson(KEY);
	if (typeof saved !== 'object' || saved === null) {
		return;
	}

	const {
		look,
		floatingBar,
		lastColumnId,
		tapAction,
		swipeRight,
		swipeLeft,
		cleanOnSave,
	} = saved as Partial<Preferences>;
	current = {
		look: look === 'ios' || look === 'material' ? look : defaults.look,
		floatingBar:
			typeof floatingBar === 'boolean' ? floatingBar : defaults.floatingBar,
		lastColumnId: typeof lastColumnId === 'string' ? lastColumnId : '',
		tapAction: tapAction === 'edit' ? 'edit' : 'open',
		swipeRight: rowAction(swipeRight, defaults.swipeRight),
		swipeLeft: rowAction(swipeLeft, defaults.swipeLeft),
		cleanOnSave:
			typeof cleanOnSave === 'boolean' ? cleanOnSave : defaults.cleanOnSave,
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
