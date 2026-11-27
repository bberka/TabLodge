import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import {showQuoteToast} from '../src/app/quote-toast';
import {UNDO_OFFER_MS} from '../src/shared/undo-policy';

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

const toast = (
	closeMs?: number,
	undo?: Parameters<typeof showQuoteToast>[0]['undo'],
) =>
	showQuoteToast({
		message: 'Quote saved to Reading.',
		failed: false,
		...(undo && {undo}),
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
	toast(undefined);
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

test('Undo sends the message the toast was built for and shows the answer', async () => {
	const sent: unknown[] = [];
	vi.stubGlobal('chrome', {
		runtime: {
			async sendMessage(message: unknown) {
				sent.push(message);
				return {ok: true, message: 'Restored to Research.'};
			},
		},
	});
	toast(6000, {type: 'TRASH_UNDO', id: 'trash-1', done: 'Restored.'});
	await vi.advanceTimersByTimeAsync(100);
	const undo = [...root.querySelectorAll('button')].find(
		(button) => button.textContent === 'Undo',
	);
	assert.ok(undo, 'the toast offers Undo');
	undo.dispatchEvent(new document.defaultView!.Event('click'));
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(sent, [{type: 'TRASH_UNDO', id: 'trash-1'}]);
	assert.equal(
		root.querySelector('[role="status"]')?.textContent,
		'Restored to Research.',
	);
});

test('a quote toast falls back to its own wording when the answer carries no message', async () => {
	toast(6000, {type: 'QUOTE_UNDO', id: 'undo-1', done: 'Quote removed.'});
	await vi.advanceTimersByTimeAsync(100);
	const undo = [...root.querySelectorAll('button')].find(
		(button) => button.textContent === 'Undo',
	);
	assert.ok(undo, 'the toast offers Undo');
	undo.dispatchEvent(new document.defaultView!.Event('click'));
	await vi.advanceTimersByTimeAsync(0);
	assert.equal(
		root.querySelector('[role="status"]')?.textContent,
		'Quote removed.',
	);
});

test('until dismissed, the quote Undo leaves when it expires and Close stays', async () => {
	toast(undefined, {
		type: 'QUOTE_UNDO',
		id: 'undo-1',
		done: 'Quote removed.',
		expiresMs: UNDO_OFFER_MS,
	});
	const labels = () =>
		[...root.querySelectorAll('button')].map((button) => button.textContent);
	await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS - 1000);
	assert.deepEqual(labels(), ['Undo', 'Close']);
	await vi.advanceTimersByTimeAsync(2000);
	assert.deepEqual(labels(), ['Close']);
	assert.equal(hostGone(), false);
});
