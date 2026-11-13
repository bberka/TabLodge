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
	/**
	Share the settings above, except this one, through sync, so phones that use one library look and behave alike.
	On by default, like the extension's portable settings. This choice itself stays on this phone.
	*/
	syncSettings: boolean;
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
	syncSettings: true,
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
		syncSettings,
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
		syncSettings:
			typeof syncSettings === 'boolean' ? syncSettings : defaults.syncSettings,
	};
	for (const listener of listeners) {
		listener();
	}
}

let onLocalChange: ((change: Partial<Preferences>) => void) | undefined;

/**
Registers what runs after the user changes a preference, so settings sync can send it without this module knowing.
*/
export function watchLocalChanges(
	callback: (change: Partial<Preferences>) => void,
): void {
	onLocalChange = callback;
}

/**
Changes preferences. `fromSync` marks values that came from another phone, which are not sent back.
*/
export function setPreferences(
	change: Partial<Preferences>,
	fromSync = false,
): void {
	current = {...current, ...change};
	for (const listener of listeners) {
		listener();
	}

	void writeJson(KEY, current);
	if (!fromSync) {
		onLocalChange?.(change);
	}
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

const SYNCED_KEYS = [
	'look',
	'floatingBar',
	'tapAction',
	'swipeRight',
	'swipeLeft',
	'cleanOnSave',
] as const;

/**
The preferences that sync, as the plain values the extension keeps for the phones.
*/
export function syncedPreferences(
	prefs: Preferences,
): Record<string, string | boolean> {
	return Object.fromEntries(SYNCED_KEYS.map((key) => [key, prefs[key]]));
}

/**
Reads synced preferences from another phone. Anything that is not a valid value is left out, so one bad entry never
changes the rest.
*/
export function readSyncedPreferences(value: unknown): Partial<Preferences> {
	if (typeof value !== 'object' || value === null) {
		return {};
	}

	const raw = value as Record<string, unknown>;
	const found: Partial<Preferences> = {};
	if (raw.look === 'ios' || raw.look === 'material') {
		found.look = raw.look;
	}

	if (typeof raw.floatingBar === 'boolean') {
		found.floatingBar = raw.floatingBar;
	}

	if (raw.tapAction === 'open' || raw.tapAction === 'edit') {
		found.tapAction = raw.tapAction;
	}

	const right = ROW_ACTIONS.find((action) => action === raw.swipeRight);
	if (right) {
		found.swipeRight = right;
	}

	const left = ROW_ACTIONS.find((action) => action === raw.swipeLeft);
	if (left) {
		found.swipeLeft = left;
	}

	if (typeof raw.cleanOnSave === 'boolean') {
		found.cleanOnSave = raw.cleanOnSave;
	}

	return found;
}
