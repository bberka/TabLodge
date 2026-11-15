/*
Stands in for the phone's native TablodgeCryptoModule under Node. It follows the same contract as the Kotlin code
(modules/tablodge-crypto/android/.../TablodgeCryptoModule.kt) with Web Crypto, so the phone's JavaScript can be tested
against the extension's own envelope code. It cannot show that the Kotlin code itself is right: that needs a device.
The wrap work factor is kept low so a test does not wait on 600,000 rounds each time; the envelope records it, and the
extension's reader honors it.
*/
import {Buffer} from 'node:buffer';

const ITERATIONS = 1000;
const FIXED_HEADER = 12;
const SALT = 16;
const IV = 12;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

async function derive(credential: string, salt: Uint8Array, rounds: number) {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(credential.normalize('NFKC')),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: new Uint8Array(salt),
			iterations: rounds,
		},
		material,
		{name: 'AES-GCM', length: 256},
		false,
		['encrypt', 'decrypt'],
	);
}

export const generateKey = (): string =>
	b64(crypto.getRandomValues(new Uint8Array(32)));

export async function wrapKey(
	key: string,
	credential: string,
): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT));
	const iv = crypto.getRandomValues(new Uint8Array(IV));
	const header = new Uint8Array(FIXED_HEADER + SALT + IV);
	header.set([0x54, 0x4c, 0x45, 0x4e, 1, 1], 0);
	new DataView(header.buffer).setUint32(6, ITERATIONS);
	header[10] = SALT;
	header[11] = IV;
	header.set(salt, FIXED_HEADER);
	header.set(iv, FIXED_HEADER + SALT);
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{name: 'AES-GCM', iv, additionalData: header, tagLength: 128},
			await derive(credential, salt, ITERATIONS),
			unb64(key),
		),
	);
	return b64(new Uint8Array([...header, ...sealed]));
}

export async function unwrapKey(
	envelope: string,
	credential: string,
): Promise<string | null> {
	const bytes = unb64(envelope);
	if (bytes.length < FIXED_HEADER || bytes[0] !== 0x54) {
		throw new Error('damaged');
	}

	const rounds = new DataView(bytes.buffer, bytes.byteOffset).getUint32(6);
	const saltLength = bytes[10];
	const headerLength = FIXED_HEADER + saltLength + bytes[11];
	try {
		return b64(
			new Uint8Array(
				await crypto.subtle.decrypt(
					{
						name: 'AES-GCM',
						iv: bytes.slice(FIXED_HEADER + saltLength, headerLength),
						additionalData: bytes.slice(0, headerLength),
						tagLength: 128,
					},
					await derive(
						credential,
						bytes.slice(FIXED_HEADER, FIXED_HEADER + saltLength),
						rounds,
					),
					bytes.slice(headerLength),
				),
			),
		);
	} catch {
		return null;
	}
}

const aesKey = async (key: string) =>
	crypto.subtle.importKey('raw', unb64(key), {name: 'AES-GCM'}, false, [
		'encrypt',
		'decrypt',
	]);

export async function sealValue(key: string, name: string, json: string) {
	const iv = crypto.getRandomValues(new Uint8Array(IV));
	const sealed = await crypto.subtle.encrypt(
		{name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name)},
		await aesKey(key),
		new TextEncoder().encode(json),
	);
	return {iv: b64(iv), ct: b64(new Uint8Array(sealed))};
}

export async function openSealed(
	key: string,
	iv: string,
	cipher: string,
	name: string,
): Promise<string | null> {
	try {
		return new TextDecoder().decode(
			await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: unb64(iv),
					additionalData: new TextEncoder().encode(name),
				},
				await aesKey(key),
				unb64(cipher),
			),
		);
	} catch {
		return null;
	}
}
