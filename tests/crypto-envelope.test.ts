import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	EnvelopeError,
	ENVELOPE_MIN_ITERATIONS,
	decryptBytes,
	encryptBytes,
	looksEncrypted,
} from '../src/app/crypto-envelope';

const plain = new TextEncoder().encode(
	'{"secret":"https://example.com/private"}',
);
const password = {kind: 'password', value: 'correct horse battery'} as const;

async function failure(run: Promise<unknown>) {
	let caught: unknown;
	await run.catch((error: unknown) => {
		caught = error;
	});
	assert.ok(caught instanceof EnvelopeError, 'expected an EnvelopeError');
	return caught;
}

test('encrypting then decrypting returns the same bytes', async () => {
	const envelope = await encryptBytes(plain, password);
	assert.equal(looksEncrypted(envelope), true);
	assert.deepEqual(await decryptBytes(envelope, password.value), plain);
});

test('a PIN round-trips and empty data is allowed', async () => {
	const envelope = await encryptBytes(new Uint8Array(), {
		kind: 'pin',
		value: '2468',
	});
	assert.deepEqual(await decryptBytes(envelope, '2468'), new Uint8Array());
});

test('the envelope hides the data and names no credential', async () => {
	const envelope = await encryptBytes(plain, password);
	const text = new TextDecoder('latin1').decode(envelope);
	assert.equal(text.includes('secret'), false);
	assert.equal(text.includes('example.com'), false);
	assert.equal(text.includes(password.value), false);
});

test('two encryptions of the same data differ', async () => {
	const first = await encryptBytes(plain, password);
	const second = await encryptBytes(plain, password);
	assert.notDeepEqual(first, second);
	assert.deepEqual(await decryptBytes(first, password.value), plain);
	assert.deepEqual(await decryptBytes(second, password.value), plain);
});

test('the header records the version and a work factor at the minimum or above', async () => {
	const envelope = await encryptBytes(plain, password);
	assert.equal(envelope[4], 1);
	const iterations = new DataView(
		envelope.buffer,
		envelope.byteOffset,
	).getUint32(6);
	assert.ok(iterations >= 600_000);
	assert.equal(ENVELOPE_MIN_ITERATIONS, 600_000);
});

test('a wrong credential fails with one clean error', async () => {
	const envelope = await encryptBytes(plain, password);
	const error = await failure(decryptBytes(envelope, 'wrong horse battery'));
	assert.equal(error.code, 'wrong-credential');
	const empty = await failure(decryptBytes(envelope, ''));
	assert.equal(empty.code, 'wrong-credential');
	const long = await failure(decryptBytes(envelope, 'x'.repeat(100_000)));
	assert.equal(long.code, 'wrong-credential');
});

test('flipping any byte after the magic is rejected', async () => {
	const envelope = await encryptBytes(plain, password);
	for (const index of [
		5,
		7,
		12,
		20,
		envelope.length - 20,
		envelope.length - 1,
	]) {
		const damaged = envelope.slice();
		damaged[index] = (damaged[index] + 1) % 256;

		const error = await failure(decryptBytes(damaged, password.value));
		assert.ok(
			['wrong-credential', 'damaged', 'unsupported'].includes(error.code),
			`byte ${index}: ${error.code}`,
		);
	}
});

test('truncated input is rejected as damaged', async () => {
	const envelope = await encryptBytes(plain, password);
	for (const length of [0, 3, 8, 20, 31]) {
		const error = await failure(
			decryptBytes(envelope.slice(0, length), password.value),
		);
		assert.ok(['not-encrypted', 'damaged'].includes(error.code));
	}

	const cut = await failure(
		decryptBytes(envelope.slice(0, -1), password.value),
	);
	assert.equal(cut.code, 'wrong-credential');
});

test('plain bytes are not an envelope', async () => {
	assert.equal(looksEncrypted(plain), false);
	const error = await failure(decryptBytes(plain, password.value));
	assert.equal(error.code, 'not-encrypted');
});

test('an unknown version is refused before any key work', async () => {
	const envelope = await encryptBytes(plain, password);
	const future = envelope.slice();
	future[4] = 99;
	const error = await failure(decryptBytes(future, password.value));
	assert.equal(error.code, 'unsupported');
	const kdf = envelope.slice();
	kdf[5] = 9;
	assert.equal(
		(await failure(decryptBytes(kdf, password.value))).code,
		'unsupported',
	);
});

test('a hostile work factor is refused rather than run', async () => {
	const envelope = await encryptBytes(plain, password);
	const hostile = envelope.slice();
	new DataView(hostile.buffer).setUint32(6, 0xff_ff_ff_ff);
	assert.equal(
		(await failure(decryptBytes(hostile, password.value))).code,
		'unsupported',
	);
});

test('encrypting refuses a credential outside the limits', async () => {
	await failure(encryptBytes(plain, {kind: 'pin', value: '12'}));
	await failure(encryptBytes(plain, {kind: 'pin', value: 'abcd'}));
	await failure(encryptBytes(plain, {kind: 'password', value: 'short'}));
	await failure(
		encryptBytes(plain, {kind: 'password', value: 'x'.repeat(129)}),
	);
});

test('the same password typed in composed or decomposed form decrypts', async () => {
	const composed = 'café-passwort';
	const decomposed = 'café-passwort';
	const envelope = await encryptBytes(plain, {
		kind: 'password',
		value: composed,
	});
	assert.deepEqual(await decryptBytes(envelope, decomposed), plain);
});
