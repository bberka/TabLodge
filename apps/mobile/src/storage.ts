/*
Where the app keeps things. The server token goes to the Android keystore (expo-secure-store); the library and the
sync bookkeeping go to SQLite, which has none of AsyncStorage's size limit.
*/
import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import {SYNC_CONFIG_KEY} from '../../extension/src/shared/sync/client';

/**
The private library's sync key, kept in the Android keystore beside the server token.
*/
export const PRIVATE_KEY_KEY = 'tablodge.private.syncKey';
const SECURE_KEYS = new Set([SYNC_CONFIG_KEY, PRIVATE_KEY_KEY]);

// SecureStore keys allow letters, digits, dots, dashes, and underscores only.
const secure = (key: string) => key.replaceAll(/[^\w\-.]/g, '_');

export async function readJson(key: string): Promise<unknown> {
	const text = SECURE_KEYS.has(key)
		? await SecureStore.getItemAsync(secure(key))
		: await Storage.getItem(key);
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
	const text = JSON.stringify(value);
	await (SECURE_KEYS.has(key)
		? SecureStore.setItemAsync(secure(key), text)
		: Storage.setItem(key, text));
}

export async function removeKeys(keys: string[]): Promise<void> {
	await Promise.all(
		keys.map(async (key) => {
			await (SECURE_KEYS.has(key)
				? SecureStore.deleteItemAsync(secure(key))
				: Storage.removeItem(key));
		}),
	);
}
