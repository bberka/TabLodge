import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import type {LicenceEntry} from '../src/about/licence-data';
import {reflow, searchLicences} from '../src/about/licence-list';

const entry = (name: string, licence: string): LicenceEntry => ({
	name,
	version: '1.0.0',
	licence,
	text: 0,
});

const packages = [
	entry('@mozilla/readability', 'Apache-2.0'),
	entry('linkedom', 'ISC'),
	entry('androidx.core:core', 'Apache-2.0'),
];

test('the licence search matches every word against the name and licence', () => {
	const names = (query: string) =>
		searchLicences(packages, query).map(({name}) => name);
	assert.equal(searchLicences(packages, '  ').length, 3);
	assert.deepEqual(names('Readability'), ['@mozilla/readability']);
	assert.deepEqual(names('apache androidx'), ['androidx.core:core']);
	assert.deepEqual(names('gpl'), []);
});

test('licence text is reflowed into paragraphs and list items for a phone', () => {
	assert.equal(
		reflow(
			'Copyright (c) 2014\nFelix Böhm\n\n   Redistribution is permitted:\n * Redistributions of source\n   code keep this.\n\r\n1. Definitions.',
		),
		'Copyright (c) 2014 Felix Böhm\n\nRedistribution is permitted:\n* Redistributions of source code keep this.\n\n1. Definitions.',
	);
});
