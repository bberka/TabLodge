import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import {showQuoteToast} from '../src/app/quote-toast';

let root: ParentNode;
let document: Document;

beforeEach(() => {
	vi.useFakeTimers();
	const dom = parseHTML('<html><body></body></html>');
	document = dom.document;
	const proto = dom.window.HTMLElement.prototype as unknown as {
		attachShadow: (init: {mode: string}) => unknown;
	};
	const attach = proto.attachShadow;
	proto.attachShadow = function (this: unknown, init) {
		root = attach.call(this, {...init, mode: 'open'}) as ParentNode;
		return root;
	};

	vi.stubGlobal('document', document);
	vi.stubGlobal('chrome', {runtime: {sendMessage: async () => ({ok: true})}});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const toast = (closeMs: number | null, undoId?: string) =>
	showQuoteToast({
		message: 'Quote saved to Reading.',
		failed: false,
		...(undoId && {undoId}),
		theme: 'light',
		edges: {top: '24px', left: '50%', transform: 'translateX(-50%)'},
		closeMs,
	});

const hostGone = () => !document.querySelector('[id="tablodge-quote-toast"]');

test('a numeric time closes the toast on its own', async () => {
	toast(6000);
	await vi.advanceTimersByTimeAsync(5900);
	assert.equal(hostGone(), false);
	await vi.advanceTimersByTimeAsync(200);
	assert.equal(hostGone(), true);
});

test('until dismissed it stays, and its Close button closes it without Undo', async () => {
	toast(null);
	await vi.advanceTimersByTimeAsync(10 * 60_000);
	assert.equal(hostGone(), false);
	const buttons = [...root.querySelectorAll('button')];
	assert.deepEqual(
		buttons.map((button) => button.textContent),
		['Close'],
	);
	buttons[0].dispatchEvent(new document.defaultView!.Event('click'));
	assert.equal(hostGone(), true);
});
