/*
Keeps the app's own settings in step between phones that share a library. They travel in the library's `mobileApp`
setting, which the extension keeps untouched, so a second phone picks them up when it first syncs. A phone only
sends its settings when the user changes one (or turns this on), and only takes what arrives, so nothing loops.
*/
import {getLibrary, setSyncedSetting, subscribeLibrary} from './library-store';
import {
	getPreferences,
	readSyncedPreferences,
	setPreferences,
	syncedPreferences,
	watchLocalChanges,
} from './preferences';

function adoptFromLibrary(): void {
	const prefs = getPreferences();
	if (!prefs.syncSettings) {
		return;
	}

	const remote = readSyncedPreferences(getLibrary().settings.mobileApp);
	const changed = Object.fromEntries(
		Object.entries(remote).filter(
			([key, value]) => prefs[key as keyof typeof prefs] !== value,
		),
	);
	if (Object.keys(changed).length > 0) {
		setPreferences(changed, true);
	}
}

/**
Call once at startup, after the preferences and the library have loaded.
*/
export function startPreferencesSync(): void {
	watchLocalChanges((change) => {
		const prefs = getPreferences();
		const synced = syncedPreferences(prefs);
		const touched = Object.keys(change).some(
			(key) => key === 'syncSettings' || Object.hasOwn(synced, key),
		);
		if (prefs.syncSettings && touched) {
			void setSyncedSetting('mobileApp', syncedPreferences(prefs));
		}
	});
	subscribeLibrary(adoptFromLibrary);
	adoptFromLibrary();
}
