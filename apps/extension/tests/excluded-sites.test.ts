import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	hostIsExcluded,
	normalizeExcludedHost,
	parseExcludedLines,
} from '../src/app/excluded-sites';

test('entries normalize to a lower-case host', () => {
	const cases: Array<[string, string | null]> = [
		['google.com', 'google.com'],
		['  Google.COM  ', 'google.com'],
		['https://google.com', 'google.com'],
		['https://google.com:8080/path?q=1', 'google.com'],
		['*.google.com', 'google.com'],
		['https://*.google.com/x', 'google.com'],
		['www.google.com', 'google.com'],
		['mail.google.com', 'mail.google.com'],
		['localhost:3000', 'localhost'],
		['http://[::1]:8080/', '[::1]'],
		['bücher.example', 'xn--bcher-kva.example'],
		['', null],
		['intranet', null],
		['chrome://settings', null],
		['ftp://example.com', null],
		['not a site', null],
	];
	for (const [input, expected] of cases) {
		assert.equal(normalizeExcludedHost(input), expected, input);
	}

	assert.equal(normalizeExcludedHost(undefined), null);
});

test('an entry covers its host and subdomains, never siblings or look-alikes', () => {
	const entries = ['google.com'];
	assert.equal(hostIsExcluded('google.com', entries), true);
	assert.equal(hostIsExcluded('gemini.google.com', entries), true);
	assert.equal(hostIsExcluded('a.b.google.com', entries), true);
	assert.equal(hostIsExcluded('notgoogle.com', entries), false);
	assert.equal(hostIsExcluded('google.com.evil.example', entries), false);
	assert.equal(hostIsExcluded('google.co.uk', entries), false);
	// A subdomain entry covers only its own subtree.
	assert.equal(hostIsExcluded('google.com', ['gemini.google.com']), false);
	assert.equal(
		hostIsExcluded('x.gemini.google.com', ['gemini.google.com']),
		true,
	);
	assert.equal(hostIsExcluded('mail.google.com', ['gemini.google.com']), false);
});

test('the bulk parser separates new hosts, duplicates and invalid lines', () => {
	const result = parseExcludedLines(
		[
			'example.com',
			'  https://news.site.org/path  ',
			'',
			'already.test',
			'EXAMPLE.com',
			'nonsense',
			'*.fresh.dev',
			'ftp://nope.example',
		].join('\n'),
		['already.test'],
	);
	assert.deepEqual(result.valid, ['example.com', 'news.site.org', 'fresh.dev']);
	assert.deepEqual(result.duplicates, ['already.test']);
	assert.deepEqual(result.invalid, ['nonsense', 'ftp://nope.example']);
	assert.deepEqual(parseExcludedLines('\n \r\n', []), {
		valid: [],
		duplicates: [],
		invalid: [],
	});
});
