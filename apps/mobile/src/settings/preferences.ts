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

export const resolveLook = (look: Look): 'material' | 'ios' => {
	if (look !== 'auto') {
		return look;
	}

	return Platform.OS === 'ios' ? 'ios' : 'material';
};

function applyTheme(theme: Theme) {
	Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
}

const KEY = 'tablodge.prefs';
const CHANGED_AT_KEY = 'tablodge.prefs.changed-at';

let current = defaults;
let legacySiteIcons: 'browser' | undefined;
let changedAt: ChangedAt = {};
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();

const isChangedAt = (value: unknown): value is ChangedAt =>
	typeof value === 'object' && value !== null;

export function loadPreferences(): Promise<void> {
	loaded ??= (async () => {
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
	})().catch((error: unknown) => {
		loaded = undefined;
		throw error;
	});
	return loaded;
}

export const getLegacySiteIcons = (): 'browser' | undefined => legacySiteIcons;

export function clearLegacySiteIcons(): void {
	if (!legacySiteIcons) {
		return;
	}

	legacySiteIcons = undefined;
	void writeJson(KEY, current);
}

const withLegacySiteIcons = (prefs: Preferences) =>
	legacySiteIcons ? {...prefs, siteIcons: 'off'} : prefs;

let onLocalChange: ((change: Partial<Preferences>) => void) | undefined;

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

	void writeJson(KEY, withLegacySiteIcons(current));
	void writeJson(CHANGED_AT_KEY, changedAt);
}

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

export function adoptPreferences(
	change: Partial<Preferences>,
	times: ChangedAt,
): void {
	changedAt = {...changedAt, ...times};
	apply(change);
}

export const getChangedAt = (): ChangedAt => changedAt;

export function resetPreferences(): void {
	setPreferences({
		...defaults,
		deviceName: current.deviceName,
		lastColumnId: current.lastColumnId,
		syncSettings: current.syncSettings,
		syncPrivate: current.syncPrivate,
	});
}

export function backupPreferences(): Omit<
	Preferences,
	'deviceName' | 'lastColumnId'
> {
	const {deviceName: _name, lastColumnId: _column, ...rest} = current;
	return rest;
}

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

export function subscribePreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export const usePreferences = (): Preferences =>
	useSyncExternalStore(subscribePreferences, () => current);
