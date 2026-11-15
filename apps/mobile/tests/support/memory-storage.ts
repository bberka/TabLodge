/*
The phone's key-value storage in memory. The map lives on `globalThis` so a test can load the app's modules again,
the way a restart does, and find what was saved.
*/
const globals = globalThis as {__phoneStorage?: Map<string, string>};
globals.__phoneStorage ??= new Map();
export const memory = globals.__phoneStorage;

export const PRIVATE_KEY_KEY = 'tablodge.private.syncKey';

export async function readJson(key: string): Promise<unknown> {
	const text = memory.get(key);
	return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

export async function writeJson(key: string, value: unknown): Promise<void> {
	memory.set(key, JSON.stringify(value));
}

export async function removeKeys(keys: string[]): Promise<void> {
	for (const key of keys) {
		memory.delete(key);
	}
}
