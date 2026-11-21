/*
Keeps the app's own settings in step between phones that share a library. They travel in the library's `mobileApp`
setting, which the extension keeps untouched, each beside the time it was last changed; `preference-merge.ts` decides
which side is newer. A phone sends a preference only when it changed here, and takes what is newer there, so nothing loops.
*/
import {
	getLibrary,
	setSyncedSetting,
	subscribeLibrary,
} from '../library/library-store';
import {
	adoptPreferences,
	getChangedAt,
	getPreferences,
	takeLegacySiteIcons,
	watchLocalChanges,
} from './preferences';
import {NO_MOBILE_APP, settlePreferences} from './preference-merge';

function settle(): void {
	const prefs = getPreferences();
	if (!prefs.syncSettings) {
		return;
	}

	const remote = getLibrary().settings.mobileApp ?? NO_MOBILE_APP;
	const {adopt, adoptAt, next} = settlePreferences(
		remote,
		prefs,
		getChangedAt(),
	);
	if (Object.keys(adopt).length > 0) {
		adoptPreferences(adopt, adoptAt);
	}

	if (next !== remote) {
		void setSyncedSetting('mobileApp', next);
	}
}

/**
Call once at startup, after the preferences and the library have loaded.
*/
export function startPreferencesSync(): void {
	const legacy = takeLegacySiteIcons();
	if (legacy && getLibrary().settings.siteIcons !== legacy) {
		void setSyncedSetting('siteIcons', legacy);
	}

	watchLocalChanges(settle);
	subscribeLibrary(settle);
	settle();
}
