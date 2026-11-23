import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';

type Sent = {type: string} & Record<string, unknown>;
type Shown = {
	message?: string | null;
	error?: unknown;
	options?: {toast?: boolean};
};

let sent: Sent[] = [];
let shown: Shown[] = [];
let reloads = 0;
let granted = true;
let answers: Record<string, unknown> = {};

beforeEach(() => {
	vi.resetModules();
	sent = [];
	shown = [];
	reloads = 0;
	granted = true;
	answers = {
		RESTORE_TRASH: {ok: true, placed: 'Bookmarks'},
		SET_SITE_SOURCE: {ok: true, sources: []},
		SET_SITE_SOURCE_COLUMN: {ok: true, sources: []},
		SET_SITE_SOURCE_KEEP_OFF: {ok: true, sources: []},
	};
	vi.stubGlobal('chrome', {
		permissions: {
			async request() {
				sent.push({type: 'permissions:request'});
				return granted;
			},
		},
		runtime: {
			async sendMessage(message: Sent) {
				sent.push(message);
				return answers[message.type];
			},
			getManifest: () => ({
				short_name: 'TabLodge',
				name: 'TabLodge',
				version: '0.0.0',
			}),
		},
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function showStatus(
	message?: string | null,
	error?: unknown,
	options?: Shown['options'],
) {
	shown.push({message, error, options});
}

const reload = async () => {
	reloads += 1;
};

async function undo(
	sourceId: string,
	stop: {columnId?: string; keepOffSite?: true} = {},
) {
	const {undoStoppedSource} = await import('../src/app/site-source-access');
	const {siteSourceById} = await import('../src/app/site-sources');
	await undoStoppedSource(
		'trash-1',
		{source: siteSourceById(sourceId)!, ...stop},
		showStatus,
		reload,
	);
}

const types = () => sent.map((message) => message.type);

test('Undo asks for the site access first, then restores the column and turns the source back on with its save mode', async () => {
	await undo('youtube', {columnId: 'reading', keepOffSite: true});

	assert.deepEqual(types(), [
		'permissions:request',
		'RESTORE_TRASH',
		'SET_SITE_SOURCE',
		'SET_SITE_SOURCE_COLUMN',
		'SET_SITE_SOURCE_KEEP_OFF',
	]);
	assert.equal(sent[2].source, 'youtube');
	assert.equal(sent[2].enabled, true);
	assert.equal(sent[3].columnId, 'reading');
	assert.equal(sent[4].keepOffSite, true);
	assert.equal(reloads, 1);
	assert.equal(
		shown[0].message,
		'Restored to Bookmarks. YouTube Watch later is on again.',
	);
	assert.equal(shown[0].error, false);
	assert.equal(shown[0].options?.toast, true);
});

test('a source that saved to its own column with the site save kept needs no extra choice', async () => {
	await undo('reddit');

	assert.deepEqual(types(), [
		'permissions:request',
		'RESTORE_TRASH',
		'SET_SITE_SOURCE',
	]);
});

test('a failed column restore still puts the save mode back and reports both failures', async () => {
	answers.SET_SITE_SOURCE_COLUMN = {
		ok: false,
		error: 'That column no longer exists.',
	};
	answers.SET_SITE_SOURCE_KEEP_OFF = {ok: false, error: 'That source is off.'};
	await undo('youtube', {columnId: 'reading', keepOffSite: true});

	assert.deepEqual(types(), [
		'permissions:request',
		'RESTORE_TRASH',
		'SET_SITE_SOURCE',
		'SET_SITE_SOURCE_COLUMN',
		'SET_SITE_SOURCE_KEEP_OFF',
	]);
	assert.equal(
		shown[0].message,
		'Restored to Bookmarks. YouTube Watch later is on again, but not as it was: That column no longer exists. That source is off.',
	);
});

test('a refused access still restores the column and says the source stays off', async () => {
	granted = false;
	await undo('youtube');

	assert.deepEqual(types(), ['permissions:request', 'RESTORE_TRASH']);
	assert.equal(reloads, 1);
	assert.match(
		String(shown[0].message),
		/^Restored to Bookmarks\. The browser did not grant access to www\.youtube\.com, so YouTube Watch later is not on here\. Add YouTube Watch later again in Settings › Sources\.$/,
	);
});

test('a delete whose column was gone from the trash reports that instead of the restore', async () => {
	answers.RESTORE_TRASH = {ok: false, error: 'That is no longer in the trash.'};
	await undo('youtube');

	assert.equal(shown[0].message, 'That is no longer in the trash.');
	assert.equal(shown[0].error, true);
	assert.equal(reloads, 0);
});
