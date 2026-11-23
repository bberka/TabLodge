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

export const unwrapKey = async (envelope: string, credential: string) =>
	native.unwrapKey(envelope, credential);

export const openSealed = async (
	key: string,
	iv: string,
	cipher: string,
	name: string,
) => native.openSealed(key, iv, cipher, name);

export const generateKey = (): string => native.generateKey();

export const wrapKey = async (key: string, credential: string) =>
	native.wrapKey(key, credential);

export const sealValue = async (key: string, name: string, json: string) => {
	const [iv, ct] = await native.sealValue(key, name, json);
	return {iv, ct};
};
