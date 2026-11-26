import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {hostIsExcluded} from '../src/shared/excluded-sites';
import {normalizeExcludedHost as normalizeInWorkerLibrary} from '../src/shared/library-normalize';

const workerSource = readFileSync(
	join(import.meta.dirname, '..', 'shell', 'service-worker.ts'),
	'utf8',
);

test('the service worker imports the shared excluded-sites matcher', () => {
	assert.match(
		workerSource,
		/import \{[^}]*\bhostIsExcluded\b[^}]*\} from '\.\.\/src\/shared\/excluded-sites';/,
	);
});

test('the service worker declares no local copy of the matcher', () => {
	assert.doesNotMatch(
		workerSource,
		/\b(function|const|let|var) hostIsExcluded\b/,
	);
});

test('the matcher gives the same answers for entries the worker normalizes', () => {
	const entries = [
		'https://*.Google.com:8443/x',
		'www.bank.example',
		'localhost:3000',
		'not a site',
	].map((value) => normalizeInWorkerLibrary(value));
	assert.deepEqual(entries, ['google.com', 'bank.example', 'localhost', null]);

	const covered = entries.filter((entry): entry is string => entry !== null);
	const cases: Array<[string, boolean]> = [
		['google.com', true],
		['gemini.google.com', true],
		['a.b.google.com', true],
		['notgoogle.com', false],
		['google.com.evil.example', false],
		['google.co.uk', false],
		['bank.example', true],
		['www.bank.example', true],
		['mail.bank.example', true],
		['localhost', true],
		['example.com', false],
	];
	for (const [host, expected] of cases) {
		assert.equal(hostIsExcluded(host, covered), expected, host);
	}
});

test('an empty exclusion list excludes nothing', () => {
	assert.equal(hostIsExcluded('google.com', []), false);
});
