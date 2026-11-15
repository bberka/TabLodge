/*
The phone's preferences, as far as the private library reads them. Kept on `globalThis` so a test that loads the app's
modules again still shares one object with them.
*/
const globals = globalThis as {__phonePrefs?: Record<string, unknown>};
globals.__phonePrefs ??= {
	syncPrivate: true,
	privateLockMode: 'manual',
	privateLockMinutes: 5,
};
export const prefs = globals.__phonePrefs;
export const getPreferences = () => prefs;
export const backupPreferences = () => ({look: 'material'});
export const restored: unknown[] = [];
export const restorePreferences = (value: unknown) => {
	restored.push(value);
};
