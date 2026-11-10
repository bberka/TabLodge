// Password-based encryption with Web Crypto only (no dependency, so it works on the page and in the worker).
// PBKDF2-SHA-256 turns the credential into an AES-GCM-256 key; the result is a versioned, self-describing
// envelope, so the work factor or the algorithm can change later without breaking old files.
//
// Envelope, version 1 (all integers big-endian):
//   0   4  magic "TLEN"
//   4   1  version (1)
//   5   1  KDF id (1 = PBKDF2-SHA-256)
//   6   4  KDF iterations
//   10  1  salt length (16)
//   11  1  IV length (12)
//   12  s  salt (random per encryption)
//   12+s i IV (random per encryption)
//   ..  n  AES-GCM ciphertext followed by its 16-byte tag
// The whole header is passed to AES-GCM as additional data, so changing any header byte fails authentication.
// The credential is normalized to NFKC before use, so the same text typed on another keyboard still matches.
// Nothing derived from the credential, and no hint, is ever written into the envelope.
import {type Credential, validateCredential} from './passcode';

export type EnvelopeErrorCode =
	/**
	The bytes do not start with the envelope magic.
	*/
	| 'not-encrypted'
	/**
	A version, algorithm or work factor this build does not read.
	*/
	| 'unsupported'
	/**
	Cut short or otherwise not shaped like an envelope.
	*/
	| 'damaged'
	/**
	Authentication failed: the credential is wrong, or the file was changed. The two cannot be told apart.
	*/
	| 'wrong-credential'
	/**
	The credential given for encryption breaks the limits in passcode.ts.
	*/
	| 'invalid-credential';

export class EnvelopeError extends Error {
	constructor(
		readonly code: EnvelopeErrorCode,
		message: string,
	) {
		super(message);
	}
}

const MAGIC = [0x54, 0x4c, 0x45, 0x4e]; // "TLEN"
const VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
/**
Work factor written by this build (OWASP's 2023 figure for PBKDF2-HMAC-SHA256). Raise it here; old files keep their own.
*/
export const ENVELOPE_MIN_ITERATIONS = 600_000;
// A file may ask for more than we write, but a hostile one must not tie up the page for minutes.
const MAX_ACCEPTED_ITERATIONS = 20_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FIXED_HEADER_BYTES = 12;
// Longer than any credential this app accepts; anything beyond cannot be the right one.
const MAX_DECRYPT_CREDENTIAL_LENGTH = 1024;

const WRONG = 'The PIN or password is wrong, or the file has been changed.';

/**
True when the bytes start with the envelope magic.
*/
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

/**
Encrypts `data` with the credential. Throws EnvelopeError('invalid-credential') when the credential breaks the PIN or password limits.
*/
export async function encryptBytes(
	data: Uint8Array,
	credential: Credential,
): Promise<Uint8Array> {
	const problem = validateCredential(credential.kind, credential.value);
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

type ParsedEnvelope = {
	header: Uint8Array<ArrayBuffer>;
	salt: Uint8Array<ArrayBuffer>;
	iv: Uint8Array<ArrayBuffer>;
	iterations: number;
	body: Uint8Array<ArrayBuffer>;
};

/**
Checks the shape of an envelope before any key work and splits it into its parts. Throws the same EnvelopeErrors a decryption does.
*/
function parseEnvelope(envelope: Uint8Array): ParsedEnvelope {
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

	return {
		header: envelope.slice(0, headerLength),
		salt: envelope.slice(FIXED_HEADER_BYTES, FIXED_HEADER_BYTES + saltLength),
		iv: envelope.slice(FIXED_HEADER_BYTES + saltLength, headerLength),
		iterations,
		body: envelope.slice(headerLength),
	};
}

function parseForCredential(
	envelope: Uint8Array,
	credential: string,
): ParsedEnvelope {
	// Checked in this order so a damaged file is still reported as damaged whatever was typed.
	if (credential.length > MAX_DECRYPT_CREDENTIAL_LENGTH) {
		parseEnvelope(envelope);
		throw new EnvelopeError('wrong-credential', WRONG);
	}

	return parseEnvelope(envelope);
}

async function openWithKey(
	parsed: ParsedEnvelope,
	key: CryptoKey,
): Promise<Uint8Array> {
	try {
		return new Uint8Array(
			await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: parsed.iv,
					additionalData: parsed.header,
					tagLength: TAG_BYTES * 8,
				},
				key,
				parsed.body,
			),
		);
	} catch {
		throw new EnvelopeError('wrong-credential', WRONG);
	}
}

/**
Decrypts an envelope. Returns all of the data or throws an EnvelopeError; never partial output.
A wrong credential and a changed file both give 'wrong-credential', so a caller learns nothing more from the failure.
*/
export async function decryptBytes(
	envelope: Uint8Array,
	credential: string,
): Promise<Uint8Array> {
	const parsed = parseForCredential(envelope, credential);
	let key: CryptoKey;
	try {
		key = await deriveKey(
			credential,
			parsed.salt,
			parsed.iterations,
			'decrypt',
		);
	} catch {
		throw new EnvelopeError('wrong-credential', WRONG);
	}

	return openWithKey(parsed, key);
}

// A session key: the AES key the credential derives, kept as raw bytes so a feature that stays unlocked for a while
// (locked storage) can open and reseal its data without asking again. Whoever holds the bytes can open every envelope
// made with the same salt, so callers keep them in memory only (browser session storage) and never write them out.
export type SessionKey = Uint8Array;

async function deriveRawKey(
	credential: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<SessionKey> {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(credential.normalize('NFKC')),
		'PBKDF2',
		false,
		['deriveBits'],
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{name: 'PBKDF2', hash: 'SHA-256', salt, iterations},
			material,
			256,
		),
	);
}

async function importSessionKey(
	key: SessionKey,
	usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new Uint8Array(key),
		{name: 'AES-GCM'},
		false,
		[usage],
	);
}

/**
Like `decryptBytes`, and also returns the session key so the data can be resealed without the credential.
*/
export async function decryptBytesKeepingKey(
	envelope: Uint8Array,
	credential: string,
): Promise<{data: Uint8Array; key: SessionKey}> {
	const parsed = parseForCredential(envelope, credential);
	const key = await deriveRawKey(credential, parsed.salt, parsed.iterations);
	return {
		data: await openWithKey(parsed, await importSessionKey(key, 'decrypt')),
		key,
	};
}

/**
Decrypts with a session key from `decryptBytesKeepingKey` or `encryptBytesKeepingKey`. Same errors as `decryptBytes`.
*/
export async function decryptBytesWithKey(
	envelope: Uint8Array,
	key: SessionKey,
): Promise<Uint8Array> {
	const parsed = parseEnvelope(envelope);
	let imported: CryptoKey;
	try {
		imported = await importSessionKey(key, 'decrypt');
	} catch {
		throw new EnvelopeError('wrong-credential', WRONG);
	}

	return openWithKey(parsed, imported);
}

/**
Like `encryptBytes`, and also returns the session key that opens the result.
*/
export async function encryptBytesKeepingKey(
	data: Uint8Array,
	credential: Credential,
): Promise<{envelope: Uint8Array; key: SessionKey}> {
	const problem = validateCredential(credential.kind, credential.value);
	if (problem) {
		throw new EnvelopeError('invalid-credential', problem);
	}

	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const key = await deriveRawKey(
		credential.value,
		salt,
		ENVELOPE_MIN_ITERATIONS,
	);
	return {
		envelope: await sealWithKey(data, key, salt, ENVELOPE_MIN_ITERATIONS),
		key,
	};
}

/**
Encrypts again under a session key, keeping the salt and work factor of `previous` (the envelope the key came from) and drawing a fresh nonce.
*/
export async function encryptBytesWithKey(
	data: Uint8Array,
	key: SessionKey,
	previous: Uint8Array,
): Promise<Uint8Array> {
	const {salt, iterations} = parseEnvelope(previous);
	return sealWithKey(data, key, salt, iterations);
}

async function sealWithKey(
	data: Uint8Array,
	key: SessionKey,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const header = new Uint8Array(FIXED_HEADER_BYTES + salt.length + IV_BYTES);
	header.set(MAGIC, 0);
	header[4] = VERSION;
	header[5] = KDF_PBKDF2_SHA256;
	new DataView(header.buffer).setUint32(6, iterations);
	header[10] = salt.length;
	header[11] = IV_BYTES;
	header.set(salt, FIXED_HEADER_BYTES);
	header.set(iv, FIXED_HEADER_BYTES + salt.length);
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{name: 'AES-GCM', iv, additionalData: header, tagLength: TAG_BYTES * 8},
			await importSessionKey(key, 'encrypt'),
			new Uint8Array(data),
		),
	);
	const envelope = new Uint8Array(header.length + sealed.length);
	envelope.set(header, 0);
	envelope.set(sealed, header.length);
	return envelope;
}
