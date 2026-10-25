import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	nextVersion,
	parseMinor,
	parseReleaseTag,
	stampVersion,
} from '../scripts/release-version.ts';

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
