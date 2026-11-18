/*
The phone's key-value storage in memory. The map lives on `globalThis` so a test can load the app's modules again,
the way a restart does, and find what was saved.
*/
const globals = globalThis as {
	__phoneStorage?: Map<string, string>;
	__phoneFailRemoval?: Set<string>;
	__phoneFailWrite?: Set<string>;
	__phoneHolds?: {
		read: Map<string, Promise<void>>;
		write: Map<string, Promise<void>>;
	};
};
globals.__phoneStorage ??= new Map();
globals.__phoneFailRemoval ??= new Set();
globals.__phoneFailWrite ??= new Set();
globals.__phoneHolds ??= {read: new Map(), write: new Map()};
export const memory = globals.__phoneStorage;

export const PRIVATE_KEY_KEY = 'tablodge.private.syncKey';

export async function readJson(key: string): Promise<unknown> {
	const hold = holds.read.get(key);
	if (hold) {
		holds.read.delete(key);
		await hold;
	}

	const text = memory.get(key);
	return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

export async function writeJson(key: string, value: unknown): Promise<void> {
	const hold = holds.write.get(key);
	if (hold) {
		holds.write.delete(key);
		await hold;
	}

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

/**
Keys whose next read or write waits for a promise, for a test that holds one storage operation.
*/
export const holds = globals.__phoneHolds;

export async function removeKeys(keys: string[]): Promise<void> {
	for (const key of keys) {
		if (failRemoval.has(key)) {
			throw new Error('storage failed');
		}

		memory.delete(key);
	}
}
