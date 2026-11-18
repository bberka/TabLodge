/*
The phone's key-value storage in memory. The map lives on `globalThis` so a test can load the app's modules again,
the way a restart does, and find what was saved.
*/
const globals = globalThis as {
	__phoneStorage?: Map<string, string>;
	__phoneFailRemoval?: Set<string>;
	__phoneFailWrite?: Set<string>;
};
globals.__phoneStorage ??= new Map();
globals.__phoneFailRemoval ??= new Set();
globals.__phoneFailWrite ??= new Set();
export const memory = globals.__phoneStorage;

export const PRIVATE_KEY_KEY = 'tablodge.private.syncKey';

export async function readJson(key: string): Promise<unknown> {
	const text = memory.get(key);
	return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

export async function writeJson(key: string, value: unknown): Promise<void> {
	if (failWrite.has(key)) {
		throw new Error('storage failed');
	}

	memory.set(key, JSON.stringify(value));
}

/**
Keys whose removal fails, for a test of an erase that stops halfway.
*/
export const failRemoval = globals.__phoneFailRemoval;

/**
Keys whose write fails, for a test of an erase that cannot even start.
*/
export const failWrite = globals.__phoneFailWrite;

export async function removeKeys(keys: string[]): Promise<void> {
	for (const key of keys) {
		if (failRemoval.has(key)) {
			throw new Error('storage failed');
		}

		memory.delete(key);
	}
}
