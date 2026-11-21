import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {isAllowedComment} from './comment-policy.ts';
import {
	area,
	countComments,
	formatBaseline,
	judge,
	scanComments,
} from './comment-ratchet.ts';

test('a directive is allowed only with its reason inside', () => {
	assert.equal(
		isAllowedComment('line', ' eslint-disable-next-line no-bitwise -- a hash'),
		true,
	);
	assert.equal(
		isAllowedComment('line', ' eslint-disable-next-line no-bitwise'),
		false,
	);
	assert.equal(
		isAllowedComment('block', ' eslint-disable no-bitwise -- a hash '),
		true,
	);
	assert.equal(isAllowedComment('block', ' eslint-enable no-bitwise '), true);
	assert.equal(
		isAllowedComment('line', ' @ts-expect-error legacy typing'),
		true,
	);
	assert.equal(isAllowedComment('line', ' @ts-expect-error'), false);
	assert.equal(isAllowedComment('line', '/ <reference lib="dom" />'), true);
	assert.equal(isAllowedComment('line', ' explains the next line'), false);
});

test('counts line, block, trailing, and JSX comments', () => {
	const text = [
		'// one',
		'const a = 1; // two',
		'/* three',
		'   four */',
		'const b = <div>{/* five */}</div>;',
	].join('\n');
	assert.equal(countComments('x.tsx', text), 4);
});

test('rendered JSX text that looks like a comment is not a comment', () => {
	assert.equal(
		countComments('x.tsx', 'const a = <div>/* example */ // text</div>;'),
		0,
	);
	assert.equal(
		countComments('x.tsx', 'const a = <div>text {/* real */}</div>;'),
		1,
	);
});

test('ignores comment markers inside strings, templates, and regular expressions', () => {
	const text = [
		"const url = 'https://example.com';",
		'const tpl = `// not a comment`;',
		String.raw`const re = /\/\/.*/;`,
	].join('\n');
	assert.equal(countComments('x.ts', text), 0);
});

test('directives with a reason and shebangs do not count', () => {
	const text = [
		'#!/usr/bin/env node',
		'// eslint-disable-next-line no-bitwise -- a hash',
		'export const a = 1 | 2;',
		'// eslint-disable-next-line no-bitwise',
		'export const b = 1 | 2;',
	].join('\n');
	const comments = scanComments('x.ts', text);
	assert.deepEqual(
		comments.map((comment) => comment.allowed),
		[true, false],
	);
});

test('a touched file may not gain comments', () => {
	assert.match(judge('a.ts', 3, 3, 2)?.problem ?? '', /adds 1/);
	assert.match(
		judge('new.ts', 1, undefined, undefined)?.problem ?? '',
		/adds 1/,
	);
});

test('a touched file that dropped below its baseline must lower it', () => {
	assert.match(judge('a.ts', 1, 3, 3)?.problem ?? '', /baseline says 3/);
	assert.match(judge('a.ts', 0, 3, 3)?.problem ?? '', /--write/);
});

test('a touched file whose count matches its baseline passes, even when another pull request raised the base', () => {
	assert.equal(judge('a.ts', 3, 3, 3), undefined);
	assert.equal(judge('clean.ts', 0, undefined, 0), undefined);
});

test('the baseline is one sorted entry per line', () => {
	assert.equal(
		formatBaseline({'b.ts': 1, 'a.ts': 2}),
		'{\n\t"a.ts": 2,\n\t"b.ts": 1\n}\n',
	);
	assert.equal(formatBaseline({}), '{}\n');
});

test('every path belongs to one area', () => {
	assert.equal(area('apps/server/src/api.ts'), 'server');
	assert.equal(area('apps/extension/src/shared/sync/client.ts'), 'shared');
	assert.equal(area('apps/extension/src/app/newtab.tsx'), 'extension');
	assert.equal(area('apps/extension/tests/library.test.ts'), 'extension');
	assert.equal(area('apps/extension/shell/service-worker.ts'), 'shell');
	assert.equal(area('apps/extension/scripts/build.ts'), 'scripts');
	assert.equal(area('apps/mobile/src/app.tsx'), 'mobile');
	assert.equal(area('apps/site/src/a.ts'), 'site');
	assert.equal(area('xo.config.ts'), 'scripts');
});
