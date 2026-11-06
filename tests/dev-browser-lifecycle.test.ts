import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import type {BrowserContext} from 'playwright';
import {stopWatchersWhenBrowserCloses} from '../scripts/dev-browser-lifecycle.ts';

test('development watchers stop when the browser context closes', async () => {
	const eventTarget = new EventTarget();
	const context = {
		once(event: string, listener: EventListener) {
			eventTarget.addEventListener(event, listener, {once: true});
		},
	} as unknown as Pick<BrowserContext, 'once'>;
	let watcherClosed = false;
	const stop = stopWatchersWhenBrowserCloses(context, [
		{
			async close() {
				watcherClosed = true;
			},
		},
	]);

	assert.equal(watcherClosed, false);
	eventTarget.dispatchEvent(new Event('close'));
	await stop;

	assert.equal(watcherClosed, true);
});
