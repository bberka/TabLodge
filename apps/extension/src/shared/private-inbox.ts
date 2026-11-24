import {fromBase64, toBase64} from './private-lock';
import {isRecord} from './library-values';
import {parseSentPayload, type SentPayload} from './send-to-private';

export const INBOX_PUBLIC_KEY = 'tablodge.sendprivate.key';
export const INBOX_ENTRY_PREFIX = 'tablodge.sendprivate.entry.';
export const INBOX_PRIVATE_KEY_NAME = 'sendprivate.key';

const CURVE = {name: 'ECDH', namedCurve: 'P-256'} as const;
const HKDF_INFO = 'TabLodge send to private v1';

export type InboxKeyPair = {v: 1; publicKey: string; privateKey: string};

export type InboxEntry = {v: 1; epk: string; iv: string; ct: string};

export const inboxEntryKey = (id: string) => INBOX_ENTRY_PREFIX + id;

export const isInboxEntryKey = (key: string) =>
	key.startsWith(INBOX_ENTRY_PREFIX);

export function parseInboxKeyPair(value: unknown): InboxKeyPair | undefined {
	return isRecord(value) &&
		value.v === 1 &&
		typeof value.publicKey === 'string' &&
		typeof value.privateKey === 'string'
		? {v: 1, publicKey: value.publicKey, privateKey: value.privateKey}
		: undefined;
}

export const parseInboxPublicKey = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined;

function parseInboxEntry(value: unknown): InboxEntry | undefined {
	return isRecord(value) &&
		value.v === 1 &&
		typeof value.epk === 'string' &&
		typeof value.iv === 'string' &&
		typeof value.ct === 'string'
		? {v: 1, epk: value.epk, iv: value.iv, ct: value.ct}
		: undefined;
}

export async function createInboxKeyPair(): Promise<InboxKeyPair> {
	const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
	return {
		v: 1,
		publicKey: toBase64(
			new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
		),
		privateKey: toBase64(
			new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
		),
	};
}

async function entryKey(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
	salt: Uint8Array<ArrayBuffer>,
	usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
	const shared = await crypto.subtle.deriveBits(
		{name: 'ECDH', public: publicKey},
		privateKey,
		256,
	);
	const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, [
		'deriveKey',
	]);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt,
			info: new TextEncoder().encode(HKDF_INFO),
		},
		material,
		{name: 'AES-GCM', length: 256},
		false,
		[usage],
	);
}

const importPublic = async (raw: string) =>
	crypto.subtle.importKey('raw', fromBase64(raw), CURVE, false, []);

const authenticated = (id: string, epk: string) =>
	new TextEncoder().encode(`${id}\n${epk}`);

export const payloadBody = (sent: SentPayload) =>
	sent.columns.length > 0 || sent.sessions.length > 0
		? {v: 2, ...sent}
		: {v: 1, links: sent.links};

export async function sealForInbox(
	publicKey: string,
	id: string,
	sent: SentPayload,
): Promise<InboxEntry> {
	const recipient = await importPublic(publicKey);
	const ephemeral = await crypto.subtle.generateKey(CURVE, true, [
		'deriveBits',
	]);
	const epk = toBase64(
		new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey)),
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await entryKey(
		ephemeral.privateKey,
		recipient,
		fromBase64(epk),
		'encrypt',
	);
	const ct = await crypto.subtle.encrypt(
		{name: 'AES-GCM', iv, additionalData: authenticated(id, epk)},
		key,
		new TextEncoder().encode(JSON.stringify(payloadBody(sent))),
	);
	return {v: 1, epk, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct))};
}

export async function openInboxEntry(
	pair: InboxKeyPair,
	id: string,
	stored: unknown,
): Promise<SentPayload | undefined> {
	const entry = parseInboxEntry(stored);
	if (!entry) {
		return undefined;
	}

	try {
		const privateKey = await crypto.subtle.importKey(
			'pkcs8',
			fromBase64(pair.privateKey),
			CURVE,
			false,
			['deriveBits'],
		);
		const key = await entryKey(
			privateKey,
			await importPublic(entry.epk),
			fromBase64(entry.epk),
			'decrypt',
		);
		const plain = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: fromBase64(entry.iv),
				additionalData: authenticated(id, entry.epk),
			},
			key,
			fromBase64(entry.ct),
		);
		const body: unknown = JSON.parse(new TextDecoder().decode(plain));
		return isRecord(body) && (body.v === 1 || body.v === 2)
			? parseSentPayload(body)
			: undefined;
	} catch {
		return undefined;
	}
}
