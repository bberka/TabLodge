import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import {showSourceToast, type ToastAction} from '../src/app/source-toast';
import {UNDO_OFFER_MS} from '../src/shared/undo-policy';

let root: ParentNode & {querySelectorAll: ParentNode['querySelectorAll']};
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
		const shadow = attach.call(this, {...init, mode: 'open'}) as typeof root;
		root = shadow;
		return shadow;
	};

	vi.stubGlobal('document', document);
	vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
		run();
		return 0;
	});
	vi.stubGlobal('chrome', {
		extension: {inIncognitoContext: false},
		storage: {local: {get: async () => ({})}},
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const hosts = () =>
	document.querySelectorAll('[id="tablodge-source-toast"]').length;
const boxes = () => [...root.querySelectorAll('[role="status"]')];
const texts = () => boxes().map((message) => message.textContent);
const click = async (label: string, index = 0) => {
	const buttons = [...root.querySelectorAll('button')].filter(
		(button) => button.textContent === label,
	);
	buttons[index].dispatchEvent(new document.defaultView!.Event('click'));
	await vi.advanceTimersByTimeAsync(0);
};

const undoOf = (log: string[], id: string): ToastAction => ({
	label: 'Undo',
	async run() {
		log.push(id);
		return `Removed ${id}.`;
	},
});

test('two saves in a row stack, and Undo on the older one undoes only that save', async () => {
	const undone: string[] = [];
	showSourceToast('Saved A.', {actions: [undoOf(undone, 'A')]});
	showSourceToast('Saved B.', {actions: [undoOf(undone, 'B')]});
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(texts(), ['Saved A.', 'Saved B.']);
	assert.equal(hosts(), 1);

	await click('Undo', 0);
	assert.deepEqual(undone, ['A']);
	assert.deepEqual(texts(), ['Removed A.', 'Saved B.']);
	assert.equal(
		[...root.querySelectorAll('button')].some((b) => b.textContent === 'Undo'),
		true,
		'the newer Undo is still there',
	);
});

test('a question answered by its own button turns into the result in place', async () => {
	showSourceToast('30 saved items on this page are not in TabLodge.', {
		asking: true,
		actions: [
			{label: 'Add them', run: async () => 'Added 30 to TabLodge in GitHub.'},
			{label: 'Not now', run: async () => undefined},
		],
	});
	await vi.advanceTimersByTimeAsync(0);
	await click('Add them');
	assert.deepEqual(texts(), ['Added 30 to TabLodge in GitHub.']);
});

test('a fourth toast closes the oldest', async () => {
	for (const name of ['1', '2', '3', '4']) {
		showSourceToast(name);
	}

	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(texts(), ['2', '3', '4']);
});

test('each toast closes on its own timer, a question after 20 seconds', async () => {
	showSourceToast('first');
	await vi.advanceTimersByTimeAsync(5000);
	showSourceToast('ask', {asking: true});
	await vi.advanceTimersByTimeAsync(3001);
	assert.deepEqual(texts(), ['ask']);
	await vi.advanceTimersByTimeAsync(15_000);
	assert.deepEqual(texts(), ['ask']);
	await vi.advanceTimersByTimeAsync(3000);
	assert.equal(hosts(), 0);
});

test('an old host left by an earlier copy of the script is removed', async () => {
	const old = document.createElement('div');
	old.id = 'tablodge-source-toast';
	document.documentElement.append(old);
	showSourceToast('new');
	await vi.advanceTimersByTimeAsync(0);
	assert.equal(hosts(), 1);
	assert.equal(document.documentElement.contains(old), false);
});

const askForPrefs = (position: string, duration: string) => {
	vi.stubGlobal('chrome', {
		extension: {inIncognitoContext: false},
		storage: {local: {get: async () => ({})}},
		runtime: {sendMessage: async () => ({ok: true, position, duration})},
	});
};

const hostStyle = (name: string) => {
	const style =
		document
			.querySelector('[id="tablodge-source-toast"]')
			?.getAttribute('style') ?? '';
	return new RegExp(String.raw`(?:^|;)\s*${name}:\s*([^;!]+)`)
		.exec(style)?.[1]
		.trim();
};

test('Toast position moves the stack, and the newest stays nearest the edge', async () => {
	askForPrefs('top-left', 'default');
	showSourceToast('Saved A.');
	await vi.advanceTimersByTimeAsync(0);
	assert.equal(hostStyle('top'), '16px');
	assert.equal(hostStyle('left'), '16px');
	assert.equal(hostStyle('bottom'), 'auto');
	assert.equal(hostStyle('right'), 'auto');
});

test('with no answer from the worker the stack is at the bottom right', async () => {
	showSourceToast('Saved A.');
	await vi.advanceTimersByTimeAsync(0);
	assert.equal(hostStyle('bottom'), '16px');
	assert.equal(hostStyle('right'), '16px');
});

test('Messages stay: Longer doubles the 8 seconds, Until dismissed never closes', async () => {
	askForPrefs('default', 'longer');
	showSourceToast('Saved A.');
	await vi.advanceTimersByTimeAsync(15_000);
	assert.deepEqual(texts(), ['Saved A.']);
	await vi.advanceTimersByTimeAsync(1100);
	assert.deepEqual(texts(), []);

	askForPrefs('default', 'dismiss');
	showSourceToast('Saved B.');
	await vi.advanceTimersByTimeAsync(10 * 60_000);
	assert.deepEqual(texts(), ['Saved B.']);
});

test('Until dismissed gives a notice with no button of its own a Close button that closes it', async () => {
	askForPrefs('default', 'dismiss');
	showSourceToast('Saved A.');
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(texts(), ['Saved A.']);
	await click('Close');
	assert.deepEqual(texts(), []);
});

const buttonLabels = () =>
	[...root.querySelectorAll('button')].map((button) => button.textContent);
const showUndo = async (duration: string) => {
	vi.stubGlobal('chrome', {
		extension: {inIncognitoContext: false},
		storage: {local: {get: async () => ({})}},
		runtime: {
			sendMessage: async () => ({ok: true, position: 'default', duration}),
		},
	});
	showSourceToast('Saved A.', {
		actions: [{...undoOf([], 'A'), expiresMs: UNDO_OFFER_MS}],
	});
	await vi.advanceTimersByTimeAsync(0);
};

test('until dismissed, Undo turns into Close once the worker would refuse it', async () => {
	await showUndo('dismiss');
	await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS - 1000);
	assert.deepEqual(buttonLabels(), ['Undo']);
	await vi.advanceTimersByTimeAsync(2000);
	assert.deepEqual(texts(), ['Saved A.']);
	assert.deepEqual(buttonLabels(), ['Close']);
	await click('Close');
	assert.equal(hosts(), 0);
});

test('a toast held under the pointer past the Undo time loses the button', async () => {
	await showUndo('default');
	root
		.querySelector('[role="status"]')!
		.parentElement!.dispatchEvent(
			new document.defaultView!.Event('pointerenter'),
		);
	await vi.advanceTimersByTimeAsync(UNDO_OFFER_MS + 1000);
	assert.deepEqual(texts(), ['Saved A.']);
	assert.deepEqual(buttonLabels(), []);
});
