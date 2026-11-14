import {requireNativeModule} from 'expo';

type TablodgeCrypto = {
	unwrapKey(envelope: string, credential: string): Promise<string | null>;
	openSealed(
		key: string,
		iv: string,
		cipher: string,
		name: string,
	): Promise<string | null>;
};

const native = requireNativeModule<TablodgeCrypto>('TablodgeCrypto');

/**
Opens the envelope that wraps a private library's sync key (PBKDF2-SHA-256 into AES-GCM). Returns the key as base64,
or null for a wrong PIN or password.
*/
export const unwrapKey = async (envelope: string, credential: string) =>
	native.unwrapKey(envelope, credential);

/**
Opens one sealed record value with the sync key. The record key is authenticated, so a value moved elsewhere fails.
Returns the JSON text, or null when it does not open.
*/
export const openSealed = async (
	key: string,
	iv: string,
	cipher: string,
	name: string,
) => native.openSealed(key, iv, cipher, name);
