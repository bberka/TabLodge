import {
	getLibrary,
	setSyncedSetting,
	subscribeLibrary,
} from '../library/library-store';
import {
	adoptPreferences,
	getChangedAt,
	getPreferences,
	clearLegacySiteIcons,
	getLegacySiteIcons,
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

export function startPreferencesSync(): void {
	const legacy = getLegacySiteIcons();
	if (legacy && getLibrary().settings.siteIcons !== legacy) {
		void setSyncedSetting('siteIcons', legacy)
			.then(clearLegacySiteIcons)
			.catch(() => undefined);
	} else {
		clearLegacySiteIcons();
	}

	watchLocalChanges(settle);
	subscribeLibrary(settle);
	settle();
}
