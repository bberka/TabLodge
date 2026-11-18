import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	clampCredentialInput,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	STRONG_PASSWORD_LENGTH,
	validateCredential,
	weakPasswordHint,
} from '../src/shared/passcode';

test('the limits are the documented ones', () => {
	assert.equal(PASSWORD_MIN_LENGTH, 4);
	assert.equal(PASSWORD_MAX_LENGTH, 128);
	assert.equal(STRONG_PASSWORD_LENGTH, 8);
});

test('a password is 4 to 128 characters of any kind', () => {
	assert.equal(validateCredential('abcd'), null);
	assert.equal(validateCredential('1234'), null);
	assert.equal(validateCredential('12345678'), null);
	assert.equal(validateCredential(`${'x'.repeat(4)} ${'y'.repeat(3)}!`), null);
	assert.equal(validateCredential('x'.repeat(128)), null);
	assert.match(validateCredential('abc') ?? '', /at least 4/);
	assert.match(validateCredential('x'.repeat(129)) ?? '', /at most 128/);
	assert.match(validateCredential('') ?? '', /Enter a password/);
});

test('digits, letters, spaces and symbols are all fine, and nothing is trimmed', () => {
	assert.equal(validateCredential(' '.repeat(4)), null);
	assert.equal(validateCredential('12 34-ab5'), null);
	assert.equal(validateCredential('١٢٣٤'), null);
});

test('length counts characters, not UTF-16 units', () => {
	// Four emoji are 8 UTF-16 units but 4 characters.
	assert.equal(validateCredential('🔑'.repeat(4)), null);
	assert.match(validateCredential('🔑'.repeat(3)) ?? '', /at least 4/);
	assert.equal(validateCredential('🔑'.repeat(128)), null);
	assert.match(validateCredential('🔑'.repeat(129)) ?? '', /at most 128/);
});

test('a field stops input at the limit and keeps everything else', () => {
	assert.equal(clampCredentialInput('12 34-ab5'), '12 34-ab5');
	assert.equal(clampCredentialInput('a'.repeat(200)).length, 128);
	assert.equal(clampCredentialInput('abc'), 'abc');
});

test('an emoji password is capped by characters, not UTF-16 units', () => {
	const clamped = clampCredentialInput('😀'.repeat(200));
	assert.equal([...clamped].length, 128);
	assert.equal(validateCredential(clamped), null);
});

test('a short or number-only password gets a hint while it is typed, and a longer mixed one does not', () => {
	assert.equal(weakPasswordHint(''), null, 'nothing is said before typing');
	assert.match(weakPasswordHint('q'.repeat(4)) ?? '', /easy to guess/);
	assert.match(weakPasswordHint('q'.repeat(7)) ?? '', /easy to guess/);
	assert.match(weakPasswordHint('1234') ?? '', /easy to guess/);
	assert.match(weakPasswordHint('12345678901234') ?? '', /easy to guess/);
	assert.equal(weakPasswordHint('q'.repeat(8)), null);
	assert.equal(weakPasswordHint('correct horse battery'), null);
	assert.equal(weakPasswordHint('1234567a'), null);
	// Characters, not UTF-16 units.
	assert.match(weakPasswordHint('🔑'.repeat(7)) ?? '', /easy to guess/);
	assert.equal(weakPasswordHint('🔑'.repeat(8)), null);
});
