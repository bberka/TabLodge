import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {PROTOCOL_VERSION} from '../src/shared/sync/change-log';
import {
	PROTOCOL_RELEASES,
	problemKey,
	problemNotice,
	readCompat,
	releaseWithAll,
	SERVER_FEATURES,
	versionText,
} from '../src/shared/sync/compat';

const URL = 'https://sync.example.test';
const ALL = SERVER_FEATURES.map(({name}) => name);

test('the current protocol names the server release that first spoke it', () => {
	assert.match(PROTOCOL_RELEASES[PROTOCOL_VERSION], /^0\.\d+\.\d+$/);
});

test('a stored status that is not what this version wrote reads as no problem', () => {
	for (const junk of [
		{server: 'x', incompatible: 'both'},
		{server: {protocol: '1', features: ['notes']}},
	]) {
		const compat = readCompat({url: URL, ...junk});
		assert.equal(compat.incompatible, undefined);
		assert.equal(problemKey(compat), undefined, JSON.stringify(junk));
	}
});

test('a server with every feature has no problem, and one without the newest names the release that has them', () => {
	const full = readCompat({
		url: URL,
		server: {protocol: PROTOCOL_VERSION, version: '0.4.0', features: ALL},
	});
	assert.equal(problemKey(full), undefined);

	const old = readCompat({
		url: URL,
		server: {
			protocol: PROTOCOL_VERSION,
			features: ['private', 'key', 'preview', 'trash'],
		},
	});
	assert.deepEqual(
		old.missing.map(({name}) => name),
		['notes', 'shared-pages', 'page-source'],
	);
	assert.equal(old.server?.version, null);
	assert.equal(releaseWithAll(old.missing), '0.4.0');
	assert.equal(
		problemNotice(old),
		'Your sync server is missing 3 features this app uses. Settings › Sync lists them.',
	);
});

test('a stopped sync lists no missing features, only the side to update', () => {
	const compat = readCompat({
		url: URL,
		incompatible: 'server',
		server: {protocol: 0, features: []},
	});
	assert.deepEqual(compat.missing, []);
	assert.equal(problemKey(compat), `${URL}\nincompatible:server`);
	assert.match(problemNotice(compat), /^Sync stopped\. .*Update the server/);
});

test('the server version reads as a release, an unreleased build, or not reported', () => {
	assert.equal(versionText('0.4.1'), '0.4.1');
	assert.equal(versionText('0.0.0'), 'an unreleased build');
	assert.equal(versionText(null), 'not reported (an older release)');
	assert.equal(releaseWithAll([{since: '0.2.2'}, {since: '0.10.0'}]), '0.10.0');
	assert.equal(releaseWithAll([]), undefined);
});
