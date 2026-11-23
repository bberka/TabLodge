import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, test} from 'vite-plus/test';
import {
	licenceData,
	mergeNotices,
	nativeNotices,
	npmNotices,
	packageDirOf,
	type GradleLibraries,
} from './third-party-notices.ts';

let root: string;

const put = (path: string, content: string | Record<string, unknown>) => {
	const file = join(root, path);
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(
		file,
		typeof content === 'string' ? content : JSON.stringify(content),
	);
	return file;
};

const pkg = (
	name: string,
	json: Record<string, unknown>,
	files: Record<string, string> = {},
) => {
	const dir = `node_modules/${name}`;
	put(`${dir}/package.json`, {name, version: '1.0.0', ...json});
	put(`${dir}/index.js`, '');
	for (const [file, content] of Object.entries(files)) {
		put(`${dir}/${file}`, content);
	}

	return join(root, dir);
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'notices-test-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

test('a bundled file belongs to the nearest package.json with a name and version', () => {
	const dir = pkg('dom', {license: 'MIT'}, {LICENSE: 'MIT text'});
	put('node_modules/dom/esm/package.json', {type: 'module'});
	const file = put('node_modules/dom/esm/index.js', '');
	assert.equal(packageDirOf(file), dir);
	assert.equal(packageDirOf(put('src/app.ts', '')), undefined);
});

test('a package with no licence or no text fails, so nothing ships without an entry', () => {
	pkg('unstated', {}, {LICENSE: 'text'});
	assert.throws(
		() => npmNotices([join(root, 'node_modules/unstated/index.js')]),
		/states no licence/,
	);
	pkg('textless', {license: 'WTFPL'});
	assert.throws(
		() => npmNotices([join(root, 'node_modules/textless/index.js')]),
		/ships no licence file/,
	);
});

test('the Apache header gets the full licence, and NOTICE travels with it', () => {
	pkg(
		'readable',
		{license: 'Apache-2.0'},
		{'LICENSE.md': 'Copyright (c) 2010 Arc90 Inc', NOTICE: 'Readable notice'},
	);
	const [notice] = npmNotices([join(root, 'node_modules/readable/index.js')]);
	assert.ok(notice?.text.startsWith('Copyright (c) 2010 Arc90 Inc'));
	assert.ok(notice.text.includes('TERMS AND CONDITIONS FOR USE'));
	assert.ok(notice.text.trimEnd().endsWith('Readable notice'));
});

test('a package without a licence file gets the standard text, labelled', () => {
	pkg('bare', {license: 'MIT'});
	const [notice] = npmNotices([join(root, 'node_modules/bare/index.js')]);
	assert.ok(notice?.text.startsWith('bare ships no licence file.'));
	assert.ok(notice.text.includes('Permission is hereby granted'));
});

test('bundled files become one notice per package, with packages a stylesheet imports', () => {
	pkg('a', {license: 'MIT'}, {LICENSE: 'A'});
	pkg('css-kit', {license: 'MIT'}, {LICENSE: 'CSS'});
	const notices = npmNotices([
		join(root, 'node_modules/a/index.js'),
		put('node_modules/a/lib/more.js', ''),
		put('src/app.css', "@import 'css-kit';\n@import './local.css';"),
		join(root, 'virtual:helper'),
	]);
	assert.deepEqual(
		notices.map(({name}) => name),
		['a', 'css-kit'],
	);
});

const artifact = (
	licences: string[],
): GradleLibraries['artifacts'][number] => ({
	group: 'androidx.core',
	name: 'core',
	version: '1.17.0',
	url: 'https://developer.android.com/jetpack/androidx',
	licences: licences.map((name) => ({name, url: ''})),
});

test('POM licence names map to SPDX ids, and an unknown or missing one fails', () => {
	const [core] = nativeNotices({
		artifacts: [artifact(['The Apache Software License, Version 2.0'])],
		projects: [],
	});
	assert.equal(core?.name, 'androidx.core:core');
	assert.equal(core.licence, 'Apache-2.0');
	assert.equal(core.kind, 'native');
	assert.ok(core.text.includes('TERMS AND CONDITIONS FOR USE'));
	assert.throws(
		() =>
			nativeNotices({
				artifacts: [artifact(['Apache License 1.1'])],
				projects: [],
			}),
		/spdxFromPom/,
	);
	assert.throws(
		() => nativeNotices({artifacts: [artifact([])], projects: []}),
		/declares no licence/,
	);
});

test('Gradle projects inside node_modules are listed as their npm package; the app’s own are not', () => {
	const dir = pkg('expo-thing', {license: 'MIT'}, {LICENSE: 'Expo'});
	put('node_modules/expo-thing/android/build.gradle', '');
	put('modules/own/android/build.gradle', '');
	const notices = nativeNotices({
		artifacts: [],
		projects: [join(dir, 'android'), join(root, 'modules/own/android')],
	});
	assert.deepEqual(
		notices.map(({name, kind}) => `${name} ${kind}`),
		['expo-thing npm'],
	);
});

test('the app data keeps one entry per package and stores each text once', () => {
	pkg('a', {license: 'MIT'}, {LICENSE: 'Same'});
	pkg('b', {license: 'MIT'}, {LICENSE: 'Same'});
	const javascript = npmNotices([
		join(root, 'node_modules/a/index.js'),
		join(root, 'node_modules/b/index.js'),
	]);
	const data = licenceData(mergeNotices(javascript, javascript));
	assert.deepEqual(
		data.packages.map(({name, text}) => `${name} ${text}`),
		['a 0', 'b 0'],
	);
	assert.equal(data.texts.length, 1);
});
