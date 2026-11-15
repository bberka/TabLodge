/*
Settles the phone's synced preferences against the library's `mobileApp` setting, so that for each preference the
latest change wins, whichever phone made it. Each synced value sits beside the time it was last changed, under
`at.<key>`. The library merges `mobileApp` as one record, so two phones that change different preferences while offline
would otherwise cost one of them its change. This phone compares each key with what the library holds, takes what is
newer, and sends back what is newer here. Clocks are the phones' own, so a phone with a wrong clock can win or lose.
*/
import {
	readSyncedPreferences,
	SYNCED_KEYS,
	type Preferences,
} from './preference-schema';

export type MobileApp = Record<string, string | number | boolean>;
export type ChangedAt = Record<string, number>;

export const AT_PREFIX = 'at.';

const timeOf = (app: MobileApp, key: string): number => {
	const time = app[AT_PREFIX + key];
	return typeof time === 'number' && time > 0 ? time : 0;
};

export type Settled = {
	/**
	Values to take from the library, with the time they were changed.
	*/
	adopt: Partial<Preferences>;
	adoptAt: ChangedAt;
	/**
	The `mobileApp` setting to write. It is the same object as `remote` when nothing here is newer.
	*/
	next: MobileApp;
};

/**
Compares every synced preference here with the library's. Equal times go to the library, so phones settle on one value.
A preference this phone never changed is never sent, and keys this version does not know stay as they are.
*/
export function settlePreferences(
	remote: MobileApp,
	prefs: Preferences,
	at: ChangedAt,
): Settled {
	const remoteValues = readSyncedPreferences(remote);
	const adopt: Record<string, unknown> = {};
	const adoptAt: ChangedAt = {};
	const sent: MobileApp = {};
	for (const key of SYNCED_KEYS) {
		const mine = at[key] ?? 0;
		const theirs = timeOf(remote, key);
		const value = remoteValues[key];
		if (value === undefined) {
			if (mine > 0) {
				sent[key] = prefs[key];
				sent[AT_PREFIX + key] = mine;
			}
		} else if (value !== prefs[key]) {
			if (theirs >= mine) {
				adopt[key] = value;
				adoptAt[key] = theirs;
			} else {
				sent[key] = prefs[key];
				sent[AT_PREFIX + key] = mine;
			}
		}
	}

	return {
		adopt,
		adoptAt,
		next: Object.keys(sent).length > 0 ? {...remote, ...sent} : remote,
	};
}
