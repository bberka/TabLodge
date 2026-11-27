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

export async function readRaw(key: string): Promise<string | undefined> {
	const hold = holds.read.get(key);
	if (hold) {
		holds.read.delete(key);
		await hold;
	}

	return memory.get(key);
}

export async function readJson(key: string): Promise<unknown> {
	const text = await readRaw(key);
	if (!text) {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
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

export const failRemoval = globals.__phoneFailRemoval;

export const failWrite = globals.__phoneFailWrite;

export const holds = globals.__phoneHolds;

export async function removeKeys(keys: string[]): Promise<void> {
	for (const key of keys) {
		if (failRemoval.has(key)) {
			throw new Error('storage failed');
		}

		memory.delete(key);
	}
}
