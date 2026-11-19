import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';

const root = join(import.meta.dirname, '..');
const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return sourceFiles(path);
		}

		return path.endsWith('.tsx') ? [path] : [];
	});

test('no component sets cursor-default, which hides that a control is clickable', () => {
	const offenders = sourceFiles(join(root, 'src')).filter((file) =>
		/\bcursor-default\b/.test(readFileSync(file, 'utf8')),
	);
	assert.deepEqual(offenders, []);
});

test('the base stylesheet gives every clickable role a pointer cursor', () => {
	const css = readFileSync(join(root, 'styles/extension-app.css'), 'utf8');
	const block = /(button,[^{]*)\{\s*cursor: pointer;/.exec(css)?.[1] ?? '';
	for (const selector of [
		'button',
		'summary',
		'a[href]',
		"[role='combobox']",
		"[role='menuitem']",
		"[role='menuitemcheckbox']",
		"[role='menuitemradio']",
		"[role='option']",
		"[role='tab']",
		"[role='switch']",
		"[role='checkbox']",
		"[role='radio']",
	]) {
		assert.ok(block.includes(selector), `${selector} has no pointer cursor`);
	}
});

test('a div or span with a click handler also shows a pointer', () => {
	const offenders: string[] = [];
	for (const file of sourceFiles(join(root, 'src'))) {
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(
			/<(?:div|span|li)\b[^>]*?\bonClick=[^>]*>/g,
		)) {
			if (!/cursor-pointer|role=|stopPropagation/.test(match[0])) {
				offenders.push(`${file}: ${match[0].slice(0, 80)}`);
			}
		}
	}

	assert.deepEqual(offenders, []);
});
