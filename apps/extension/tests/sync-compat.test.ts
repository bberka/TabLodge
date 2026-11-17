import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {PROTOCOL_VERSION} from '../src/shared/sync/change-log';
import {
	PROTOCOL_RELEASES,
	problemBanner,
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
		assert.equal(problemBanner(compat), undefined, JSON.stringify(junk));
	}
});

test('a server with every feature has no problem, and one without the newest names the release that has them', () => {
	const full = readCompat({
		url: URL,
		server: {protocol: PROTOCOL_VERSION, version: '0.4.0', features: ALL},
	});
	assert.equal(problemBanner(full), undefined);

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
	assert.deepEqual(problemBanner(old), {
		stopped: false,
		title: 'Your sync server needs an update',
		detail:
			'Until it runs 0.4.0 or later: Bookmark notes stay on this device. Upload to my server cannot share pages. Keep a copy on the phone fetches pages itself, not through the server.',
	});
});

test('a stopped sync lists no missing features, only the side to update', () => {
	const compat = readCompat({
		url: URL,
		incompatible: 'server',
		server: {protocol: 0, features: []},
	});
	assert.deepEqual(compat.missing, []);
	assert.deepEqual(problemBanner(compat), {
		stopped: true,
		title: 'Sync stopped',
		detail:
			'Your sync server is older than this app. Update the server to 0.2.0 or later.',
	});
});

test('the server version reads as a release, an unreleased build, or not reported', () => {
	assert.equal(versionText('0.4.1'), '0.4.1');
	assert.equal(versionText('0.0.0'), 'an unreleased build');
	assert.equal(versionText(null), 'not reported (an older release)');
	assert.equal(releaseWithAll([{since: '0.2.2'}, {since: '0.10.0'}]), '0.10.0');
	assert.equal(releaseWithAll([]), undefined);
});
