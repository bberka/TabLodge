import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';

const manifest = {short_name: 'TabLodge', name: 'TabLodge', version: '0.0.0'};

async function sendWith(sendMessage: () => Promise<unknown>) {
	vi.stubGlobal('chrome', {
		runtime: {getManifest: () => manifest, sendMessage},
	});
	const {send} = await import('../src/app/message-client');
	return send('GET_SERVER_ICONS') as Promise<{ok: boolean; error?: string}>;
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

test('a worker that answers nothing gives a failure result instead of undefined', async () => {
	const answer = await sendWith(async () => undefined);
	assert.equal(answer.ok, false);
	assert.match(String(answer.error), /did not answer/);
});

test('a worker that throws gives the reload message', async () => {
	const answer = await sendWith(async () => {
		throw new Error('gone');
	});
	assert.equal(answer.ok, false);
	assert.match(String(answer.error), /Reload this page/);
});
