import {type Credential, validateCredential} from './passcode';

export type EnvelopeErrorCode =
	| 'not-encrypted'
	| 'unsupported'
	| 'damaged'
	| 'wrong-credential'
	| 'invalid-credential';

export class EnvelopeError extends Error {
	constructor(
		readonly code: EnvelopeErrorCode,
		message: string,
	) {
		super(message);
	}
}

const MAGIC = [0x54, 0x4c, 0x45, 0x4e];
const VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
export const ENVELOPE_MIN_ITERATIONS = 600_000;
const MAX_ACCEPTED_ITERATIONS = 20_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FIXED_HEADER_BYTES = 12;
const MAX_DECRYPT_CREDENTIAL_LENGTH = 1024;

const WRONG = 'The password is wrong, or the file has been changed.';

export function looksEncrypted(bytes: Uint8Array): boolean {
	return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

async function deriveKey(
	credential: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
	usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(credential.normalize('NFKC')),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{name: 'PBKDF2', hash: 'SHA-256', salt, iterations},
		material,
		{name: 'AES-GCM', length: 256},
		false,
		[usage],
	);
}

export async function encryptBytes(
	data: Uint8Array,
	credential: Credential,
): Promise<Uint8Array> {
	const problem = credential.verified
		? null
		: validateCredential(credential.value);
	if (problem) {
		throw new EnvelopeError('invalid-credential', problem);
	}

	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const header = new Uint8Array(FIXED_HEADER_BYTES + SALT_BYTES + IV_BYTES);
	header.set(MAGIC, 0);
	header[4] = VERSION;
	header[5] = KDF_PBKDF2_SHA256;
	new DataView(header.buffer).setUint32(6, ENVELOPE_MIN_ITERATIONS);
	header[10] = SALT_BYTES;
	header[11] = IV_BYTES;
	header.set(salt, FIXED_HEADER_BYTES);
	header.set(iv, FIXED_HEADER_BYTES + SALT_BYTES);
	const key = await deriveKey(
		credential.value,
		salt,
		ENVELOPE_MIN_ITERATIONS,
		'encrypt',
	);
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{name: 'AES-GCM', iv, additionalData: header, tagLength: TAG_BYTES * 8},
			key,
			new Uint8Array(data),
		),
	);
	const envelope = new Uint8Array(header.length + sealed.length);
	envelope.set(header, 0);
	envelope.set(sealed, header.length);
	return envelope;
}

export async function decryptBytes(
	envelope: Uint8Array,
	credential: string,
): Promise<Uint8Array> {
	if (!looksEncrypted(envelope)) {
		throw new EnvelopeError('not-encrypted', 'This file is not encrypted.');
	}

	const damaged = new EnvelopeError(
		'damaged',
		'This encrypted file is damaged.',
	);
	if (envelope.length < FIXED_HEADER_BYTES) {
		throw damaged;
	}

	if (envelope[4] !== VERSION) {
		throw new EnvelopeError(
			'unsupported',
			'This file was encrypted by a newer version of the app.',
		);
	}

	const view = new DataView(envelope.buffer, envelope.byteOffset);
	const iterations = view.getUint32(6);
	if (
		envelope[5] !== KDF_PBKDF2_SHA256 ||
		iterations < 1 ||
		iterations > MAX_ACCEPTED_ITERATIONS
	) {
		throw new EnvelopeError(
			'unsupported',
			'This file uses encryption settings this version cannot read.',
		);
	}

	const saltLength = envelope[10];
	const ivLength = envelope[11];
	const headerLength = FIXED_HEADER_BYTES + saltLength + ivLength;
	if (
		saltLength < 8 ||
		ivLength !== IV_BYTES ||
		envelope.length < headerLength + TAG_BYTES
	) {
		throw damaged;
	}

	if (credential.length > MAX_DECRYPT_CREDENTIAL_LENGTH) {
		throw new EnvelopeError('wrong-credential', WRONG);
	}

	const header = envelope.slice(0, headerLength);
	const salt = envelope.slice(
		FIXED_HEADER_BYTES,
		FIXED_HEADER_BYTES + saltLength,
	);
	const iv = envelope.slice(FIXED_HEADER_BYTES + saltLength, headerLength);
	try {
		const key = await deriveKey(credential, salt, iterations, 'decrypt');
		return new Uint8Array(
			await crypto.subtle.decrypt(
				{name: 'AES-GCM', iv, additionalData: header, tagLength: TAG_BYTES * 8},
				key,
				envelope.slice(headerLength),
			),
		);
	} catch {
		throw new EnvelopeError('wrong-credential', WRONG);
	}
}
