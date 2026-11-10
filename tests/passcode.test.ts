import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	PIN_MAX_LENGTH,
	PIN_MIN_LENGTH,
	validateCredential,
} from '../src/app/passcode';

test('the limits are the documented ones', () => {
	assert.equal(PIN_MIN_LENGTH, 4);
	assert.equal(PIN_MAX_LENGTH, 8);
	assert.equal(PASSWORD_MIN_LENGTH, 8);
	assert.equal(PASSWORD_MAX_LENGTH, 128);
});

test('a PIN is 4 to 8 ASCII digits', () => {
	assert.equal(validateCredential('pin', '1234'), null);
	assert.equal(validateCredential('pin', '12345678'), null);
	assert.match(validateCredential('pin', '123') ?? '', /at least 4/);
	assert.match(validateCredential('pin', '123456789') ?? '', /at most 8/);
	assert.match(validateCredential('pin', '12a4') ?? '', /digits/);
	assert.match(validateCredential('pin', '12 34') ?? '', /digits/);
	// Arabic-Indic digits are digits to \d-style checks in some engines; a PIN allows 0 to 9 only.
	assert.match(validateCredential('pin', '١٢٣٤') ?? '', /digits/);
	assert.match(validateCredential('pin', '') ?? '', /Enter/);
});

test('a password is 8 to 128 characters of any kind', () => {
	assert.equal(validateCredential('password', 'a'.repeat(8)), null);
	assert.equal(
		validateCredential('password', `${'x'.repeat(4)} ${'y'.repeat(3)}!`),
		null,
	);
	assert.equal(validateCredential('password', 'x'.repeat(128)), null);
	assert.match(
		validateCredential('password', 'a'.repeat(7)) ?? '',
		/at least 8/,
	);
	assert.match(
		validateCredential('password', 'x'.repeat(129)) ?? '',
		/at most 128/,
	);
	assert.match(validateCredential('password', '') ?? '', /Enter/);
});

test('length counts characters, not UTF-16 units', () => {
	// Eight emoji are 16 UTF-16 units but 8 characters.
	assert.equal(validateCredential('password', '🔑'.repeat(8)), null);
	assert.match(
		validateCredential('password', '🔑'.repeat(7)) ?? '',
		/at least 8/,
	);
	assert.equal(validateCredential('password', '🔑'.repeat(128)), null);
	assert.match(
		validateCredential('password', '🔑'.repeat(129)) ?? '',
		/at most 128/,
	);
});
