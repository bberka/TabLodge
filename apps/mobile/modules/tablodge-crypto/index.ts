import {requireNativeModule} from 'expo';

type TablodgeCrypto = {
	unwrapKey(envelope: string, credential: string): Promise<string | null>;
	openSealed(
		key: string,
		iv: string,
		cipher: string,
		name: string,
	): Promise<string | null>;
	generateKey(): string;
	wrapKey(key: string, credential: string): Promise<string>;
	sealValue(key: string, name: string, json: string): Promise<string[]>;
};

const native = requireNativeModule<TablodgeCrypto>('TablodgeCrypto');

/**
Opens the envelope that wraps a private library's sync key (PBKDF2-SHA-256 into AES-GCM). Returns the key as base64,
or null for a wrong password.
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

/**
A new random 256-bit data key, as base64.
*/
export const generateKey = (): string => native.generateKey();

/**
Wraps a data key in the credential envelope, the format `unwrapKey` and the extension read. Returns it as base64.
*/
export const wrapKey = async (key: string, credential: string) =>
	native.wrapKey(key, credential);

/**
Seals one record value (JSON text) with the data key. The record's key name is authenticated, so a value moved
elsewhere fails to open. Returns the base64 iv and ciphertext.
*/
export const sealValue = async (key: string, name: string, json: string) => {
	const [iv, ct] = await native.sealValue(key, name, json);
	return {iv, ct};
};
