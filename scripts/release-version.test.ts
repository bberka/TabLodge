import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	androidVersionCode,
	nextVersion,
	parseMinor,
	parseReleaseTag,
	stampAndroid,
	stampVersion,
} from './release-version.ts';

test('the first release of a minor starts at patch 0', () => {
	assert.equal(nextVersion(1, []), '0.1.0');
	assert.equal(nextVersion(2, ['v0.1.0', 'v0.1.1']), '0.2.0');
});

test('releases within the same minor bump the patch from the latest tag', () => {
	assert.equal(nextVersion(1, ['v0.1.0']), '0.1.1');
	assert.equal(nextVersion(1, ['v0.1.1', 'v0.1.0']), '0.1.2');
	assert.equal(nextVersion(1, ['v0.1.9', 'v0.1.10', 'v0.1.2']), '0.1.11');
	assert.equal(nextVersion(2, ['v0.1.4', 'v0.2.0', 'v0.2.3']), '0.2.4');
});

test('unrelated and malformed tags are ignored', () => {
	assert.equal(
		nextVersion(1, [
			'v1.0.0',
			'v0.1',
			'v0.1.1-beta',
			'latest',
			'v0.01.5',
			'v0.1.1',
		]),
		'0.1.2',
	);
});

test('VERSION may not go below the latest released minor', () => {
	assert.throws(() => nextVersion(1, ['v0.2.0']), /already exists/);
});

test('VERSION must be a single whole number', () => {
	assert.equal(parseMinor('3\n'), 3);
	assert.equal(parseMinor(' 0 '), 0);
	for (const bad of ['', '1.2', 'v1', '01', '-1', 'one']) {
		assert.throws(() => parseMinor(bad), /VERSION/);
	}

	assert.deepEqual(parseReleaseTag('v0.4.7'), {minor: 4, patch: 7});
	assert.equal(parseReleaseTag('v0.4'), null);
});

test('stamping a version only touches the top-level version value', () => {
	const manifest =
		'{\n\t"name": "TabLodge",\n\t"version": "0.1.0",\n\t"minimum_chrome_version": "116",\n\t"optional_permissions": ["downloads"]\n}\n';
	assert.equal(
		stampVersion(manifest, '0.1.7'),
		manifest.replace('"version": "0.1.0"', '"version": "0.1.7"'),
	);
	assert.throws(() => stampVersion(manifest, '1.0.0'), /ZeroVer/);
	assert.throws(
		() => stampVersion('{\n\t"name": "x"\n}\n', '0.1.0'),
		/version/,
	);
});

test('the Android version code grows with the release version', () => {
	assert.equal(androidVersionCode('0.1.5'), 1005);
	assert.equal(androidVersionCode('0.2.0'), 2000);
	assert.ok(androidVersionCode('0.1.11') > androidVersionCode('0.1.9'));
	assert.ok(androidVersionCode('0.2.0') > androidVersionCode('0.1.999'));
	assert.throws(() => androidVersionCode('0.1.1000'), /too large/);
	assert.throws(() => androidVersionCode('1.0.0'), /ZeroVer/);
});

test('stamping the app config sets the version and code and keeps the rest', () => {
	const config = JSON.parse(
		stampAndroid(
			'{\n\t"expo": {\n\t\t"name": "TabLodge",\n\t\t"version": "0.1.0",\n\t\t"android": {"package": "a.b", "versionCode": 1}\n\t}\n}\n',
			'0.3.4',
		),
	) as {
		expo: {name: string; version: string; android: Record<string, unknown>};
	};
	assert.equal(config.expo.version, '0.3.4');
	assert.deepEqual(config.expo.android, {package: 'a.b', versionCode: 3004});
	assert.equal(config.expo.name, 'TabLodge');
});
