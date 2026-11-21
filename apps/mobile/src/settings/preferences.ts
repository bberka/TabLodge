/*
The phone's current preferences: loaded once at startup, saved on every change, and read by screens with
`usePreferences`. What each preference is, and which ones sync, is in `preference-schema.ts`; keeping them in step
between phones is `preferences-sync.ts`.
*/
import {Appearance, Platform} from 'react-native';
import {useSyncExternalStore} from 'react';
import {readJson, writeJson} from '../platform/storage';
import {
	defaults,
	legacySiteIconsOf,
	parsePreferences,
	SYNCED_KEYS,
	type Look,
	type Preferences,
	type Theme,
} from './preference-schema';
import type {ChangedAt} from './preference-merge';

export * from './preference-schema';

/**
The look to draw: the one chosen, or for Automatic the phone's own: iOS on an iPhone, and Material on Android.
*/
export const resolveLook = (look: Look): 'material' | 'ios' => {
	if (look !== 'auto') {
		return look;
	}

	return Platform.OS === 'ios' ? 'ios' : 'material';
};

/**
Makes the whole app, and the system dialogs it opens, follow the chosen theme; `system` hands the choice back to the phone.
*/
function applyTheme(theme: Theme) {
	// `unspecified` hands the choice back to the phone.
	Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
}

const KEY = 'tablodge.prefs';
const CHANGED_AT_KEY = 'tablodge.prefs.changed-at';

let current = defaults;
let legacySiteIcons: 'browser' | undefined;
// When this phone last changed each synced preference, or took it from another phone. Settings sync compares these.
let changedAt: ChangedAt = {};
const listeners = new Set<() => void>();

const isChangedAt = (value: unknown): value is ChangedAt =>
	typeof value === 'object' && value !== null;

export async function loadPreferences(): Promise<void> {
	const savedAt = await readJson(CHANGED_AT_KEY);
	changedAt = isChangedAt(savedAt)
		? Object.fromEntries(
				Object.entries(savedAt).filter(
					([, time]) => typeof time === 'number' && time > 0,
				),
			)
		: {};
	const saved = await readJson(KEY);
	if (typeof saved !== 'object' || saved === null) {
		return;
	}

	legacySiteIcons = legacySiteIconsOf(
		(saved as Record<string, unknown>).siteIcons,
	);
	current = parsePreferences(saved);
	applyTheme(current.theme);
	for (const listener of listeners) {
		listener();
	}
}

export function takeLegacySiteIcons(): 'browser' | undefined {
	const found = legacySiteIcons;
	if (found) {
		legacySiteIcons = undefined;
		void writeJson(KEY, current);
	}

	return found;
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

function apply(change: Partial<Preferences>): void {
	current = {...current, ...change};
	if (change.theme) {
		applyTheme(change.theme);
	}

	for (const listener of listeners) {
		listener();
	}

	void writeJson(KEY, current);
	void writeJson(CHANGED_AT_KEY, changedAt);
}

/**
Changes preferences, as the user's own choice: a synced one is stamped with the time and sent to the other phones.
*/
export function setPreferences(change: Partial<Preferences>): void {
	const now = Date.now();
	for (const key of SYNCED_KEYS) {
		if (Object.hasOwn(change, key)) {
			changedAt = {...changedAt, [key]: now};
		}
	}

	apply(change);
	onLocalChange?.(change);
}

/**
Takes preferences that came from another phone, with the times they were changed there. They are not sent back.
*/
export function adoptPreferences(
	change: Partial<Preferences>,
	times: ChangedAt,
): void {
	changedAt = {...changedAt, ...times};
	apply(change);
}

export const getChangedAt = (): ChangedAt => changedAt;

/**
Puts every preference back to its default. This phone's name, the column last saved to, and whether settings sync stay.
*/
export function resetPreferences(): void {
	setPreferences({
		...defaults,
		deviceName: current.deviceName,
		lastColumnId: current.lastColumnId,
		syncSettings: current.syncSettings,
		syncPrivate: current.syncPrivate,
	});
}

/**
Every preference worth keeping in a backup: all but this phone's name and the column last saved to.
*/
export function backupPreferences(): Omit<
	Preferences,
	'deviceName' | 'lastColumnId'
> {
	const {deviceName: _name, lastColumnId: _column, ...rest} = current;
	return rest;
}

/**
Puts the preferences of a backup back, as one change. This phone's name and last column stay.
*/
export function restorePreferences(value: unknown): void {
	if (typeof value !== 'object' || value === null) {
		return;
	}

	const {
		deviceName: _name,
		lastColumnId: _column,
		...rest
	} = parsePreferences(value);
	setPreferences(rest);
}

export const getPreferences = (): Preferences => current;

/**
Calls `listener` after every change to the preferences, from this phone, another one, or a restore.
*/
export function subscribePreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export const usePreferences = (): Preferences =>
	useSyncExternalStore(subscribePreferences, () => current);
