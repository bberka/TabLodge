import {
	readSyncedPreferences,
	SYNCED_KEYS,
	type Preferences,
} from './preference-schema';

export type MobileApp = Record<string, string | number | boolean>;
export type ChangedAt = Record<string, number>;

export const AT_PREFIX = 'at.';

export const NO_MOBILE_APP: MobileApp = {};

const timeOf = (app: MobileApp, key: string): number => {
	const time = app[AT_PREFIX + key];
	return typeof time === 'number' && time > 0 ? time : 0;
};

export type Settled = {
	adopt: Partial<Preferences>;
	adoptAt: ChangedAt;
	next: MobileApp;
};

export function settlePreferences(
	library: MobileApp | undefined,
	prefs: Preferences,
	at: ChangedAt,
): Settled {
	const remote = library ?? NO_MOBILE_APP;
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
