/*
The phone's preferences, as far as the private library, the widget snapshot, and background sync read them. Kept on
`globalThis` so a test that loads the app's modules again still shares one object with them.
*/
const globals = globalThis as {
	__phonePrefs?: Record<string, unknown>;
	__phonePrefListeners?: Set<() => void>;
};
globals.__phonePrefs ??= {
	syncPrivate: true,
	privateLockMode: 'manual',
	privateLockMinutes: 5,
	openWith: 'system',
	openApp: '',
	backgroundSync: true,
};
export const prefs = globals.__phonePrefs;
export const getPreferences = () => prefs;
// The values above stand in for the saved ones.
export async function loadPreferences(): Promise<void> {}
globals.__phonePrefListeners ??= new Set();
const listeners = globals.__phonePrefListeners;
export function subscribePreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
Changes preferences the way the app does, telling whoever subscribed.
*/
export function setPreferences(change: Record<string, unknown>): void {
	Object.assign(prefs, change);
	for (const listener of listeners) {
		listener();
	}
}

export const backupPreferences = () => ({look: 'material'});
export const restored: unknown[] = [];
export const restorePreferences = (value: unknown) => {
	restored.push(value);
};
