import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {afterEach, test, vi} from 'vite-plus/test';
import {siteSourceById} from '../src/app/site-sources';
import {watchSavedPage} from '../src/app/source-catch-up-page';
import type {SourceLink} from '../src/app/source-reader';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../src/app/source-toast', () => ({
	showSourceToast(text: string) {
		toasts.push(text);
	},
}));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	toasts.length = 0;
});

test('a count still on its way when the page leaves the saved list shows nothing, and coming back asks again', async () => {
	vi.useFakeTimers();
	const {window, document} = parseHTML('<html><body></body></html>');
	vi.stubGlobal('document', document);
	vi.stubGlobal('MutationObserver', window.MutationObserver);
	const list: SourceLink[] = [
		{url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A'},
	];
	let isOnSavedPage = true;
	const answers: Array<(value: unknown) => void> = [];
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: () => (isOnSavedPage ? list : undefined),
		send: async <T>() =>
			new Promise<T | undefined>((resolve) => {
				answers.push(resolve as (value: unknown) => void);
			}),
		appName: 'TabLodge',
		undo: async () => '',
	});

	await vi.advanceTimersByTimeAsync(1000);
	assert.equal(answers.length, 1, 'the saved page was counted');
	// The user moves on in place before the answer comes back.
	isOnSavedPage = false;
	document.body.append(document.createElement('div'));
	await vi.advanceTimersByTimeAsync(1000);
	answers[0]({ok: true, missing: 1, ask: true});
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(toasts, [], 'no offer on the page the user moved to');

	// Back on the same list, it is counted again and the offer shows.
	isOnSavedPage = true;
	document.body.append(document.createElement('div'));
	await vi.advanceTimersByTimeAsync(1000);
	assert.equal(answers.length, 2);
	answers[1]({ok: true, missing: 1, ask: true});
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(toasts, ["1 saved item on this page isn't in TabLodge."]);
});
