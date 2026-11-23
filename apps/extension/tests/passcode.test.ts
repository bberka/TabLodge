import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	sameCredential,
	validateCredential,
	weakPasswordHint,
} from '../src/shared/passcode';

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
	assert.equal(validateCredential('🔑'.repeat(4)), null);
	assert.match(validateCredential('🔑'.repeat(3)) ?? '', /at least 4/);
	assert.equal(validateCredential('🔑'.repeat(128)), null);
	assert.match(validateCredential('🔑'.repeat(129)) ?? '', /at most 128/);
});

test('length is judged after the normalization the key is derived with, so the same text is judged the same', () => {
	assert.match(validateCredential('e\u0301e\u0301') ?? '', /at least 4/);
	assert.match(validateCredential('éé') ?? '', /at least 4/);
	assert.equal(validateCredential('e\u0301e\u0301e\u0301e\u0301'), null);
	assert.equal(validateCredential('éééé'), null);
	assert.match(validateCredential('ａｂｃ') ?? '', /at least 4/);
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
	assert.match(weakPasswordHint('🔑'.repeat(7)) ?? '', /easy to guess/);
	assert.equal(weakPasswordHint('🔑'.repeat(8)), null);
	assert.match(weakPasswordHint('١٢٣٤٥٦٧٨') ?? '', /easy to guess/);
	assert.match(weakPasswordHint('１２３４５６７８９０') ?? '', /easy to guess/);
});

test('two entries are the same password when they are the same text after the normalization the key uses', () => {
	assert.equal(sameCredential('１２３４', '1234'), true);
	assert.equal(sameCredential('é', 'e\u0301'), true);
	assert.equal(sameCredential('1234', '1235'), false);
	assert.equal(sameCredential('abc', 'ABC'), false);
});
