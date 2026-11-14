import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {readPage} from '../src/library/page-title';

describe('reading a page', () => {
	test('takes the title tag, decoding entities and collapsing whitespace', () => {
		assert.equal(
			readPage(
				'<head><title>\n  Tom &amp; Jerry &#8211;\n  the &quot;show&quot; </title></head>',
			).title,
			'Tom & Jerry – the "show"',
		);
	});

	test('prefers the share title, with its attributes in either order', () => {
		assert.equal(
			readPage(
				"<title>Plain</title><meta content='Shared' property='og:title'>",
			).title,
			'Shared',
		);
		assert.equal(
			readPage(
				'<meta property="og:title" content="First"><title>Second</title>',
			).title,
			'First',
		);
	});

	test('reads the description from the share tag or the plain one', () => {
		assert.equal(
			readPage('<meta name="description" content="Plain text">').description,
			'Plain text',
		);
		assert.equal(
			readPage(
				'<meta name="description" content="Plain"><meta property="og:description" content="Shared">',
			).description,
			'Shared',
		);
	});

	test('gives nothing for a page without a usable title', () => {
		assert.deepEqual(readPage('<html><body>hi</body></html>'), {
			title: undefined,
			description: undefined,
		});
		assert.equal(readPage('<title>   </title>').title, undefined);
	});

	test('leaves an unknown entity as written', () => {
		assert.equal(readPage('<title>a &bogus; b</title>').title, 'a &bogus; b');
	});
});
