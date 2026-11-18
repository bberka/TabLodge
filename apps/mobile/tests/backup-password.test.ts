import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {backupPasswordNote} from '../src/transfer/backup-password';

test('only a backup looks at the password', () => {
	assert.deepEqual(backupPasswordNote(false, 'abc'), {});
	assert.deepEqual(backupPasswordNote(false, ''), {});
});

test('a blank backup password is optional and says nothing', () => {
	assert.deepEqual(backupPasswordNote(true, ''), {});
});

test('a password under 4 characters blocks, and says why', () => {
	const note = backupPasswordNote(true, 'abc');
	assert.match(note.problem ?? '', /at least 4/);
	assert.equal(note.hint, undefined);
});

test('a short or number-only password is allowed and gets a note, and a longer mixed one gets none', () => {
	for (const weak of ['abcd', '1234', '12345678']) {
		const note = backupPasswordNote(true, weak);
		assert.equal(note.problem, undefined, weak);
		assert.match(note.hint ?? '', /easy to guess/, weak);
	}

	assert.deepEqual(backupPasswordNote(true, 'a long enough phrase'), {});
});
