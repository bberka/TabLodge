import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {afterEach, test, vi} from 'vite-plus/test';
import {siteSourceById} from '../src/app/site-sources';
import {watchSavedPage} from '../src/app/source-catch-up-page';
import type {SourceLink} from '../src/app/source-reader';

type Shown = {
	text: string;
	actions: Array<{label: string; run: () => Promise<unknown>}>;
};
const toasts: Shown[] = vi.hoisted(() => [] as Shown[]);
vi.mock('../src/app/source-toast', () => ({
	showSourceToast(
		text: string,
		{actions = []}: {actions?: Shown['actions']} = {},
	) {
		toasts.push({text, actions});
	},
}));

const first: SourceLink = {
	url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
	title: 'A',
};
const second: SourceLink = {
	url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
	title: 'B',
};

function savedPage(links: SourceLink[]) {
	const {window, document} = parseHTML('<html><body></body></html>');
	vi.stubGlobal('document', document);
	vi.stubGlobal('MutationObserver', window.MutationObserver);
	let list = links;
	return {
		document,
		set(next: SourceLink[]) {
			list = next;
			document.body.append(document.createElement('div'));
		},
		read: () => list,
	};
}

const count = (missing: number, ask: boolean, mode: 'add' | 'ask') => ({
	ok: true,
	missing,
	ask,
	mode,
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	toasts.length = 0;
});

test('a count still on its way when the page leaves the saved list shows nothing, and coming back asks again', async () => {
	vi.useFakeTimers();
	const {document, read} = savedPage([first]);
	let isOnSavedPage = true;
	const answers: Array<(value: unknown) => void> = [];
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: () => (isOnSavedPage ? read() : undefined),
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
	answers[0](count(1, true, 'ask'));
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(toasts, [], 'no offer on the page the user moved to');

	// Back on the same list, it is counted again and the offer shows.
	isOnSavedPage = true;
	document.body.append(document.createElement('div'));
	await vi.advanceTimersByTimeAsync(1000);
	assert.equal(answers.length, 2);
	answers[1](count(1, true, 'ask'));
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(
		toasts.map((toast: Shown) => toast.text),
		["1 saved item on this page isn't in TabLodge."],
	);
});

test('a saved page with nothing missing shows no catch-up message in either mode', async () => {
	for (const mode of ['add', 'ask'] as const) {
		vi.useFakeTimers();
		const {read} = savedPage([first]);
		const sent: Array<Record<string, unknown>> = [];
		watchSavedPage({
			source: siteSourceById('youtube')!,
			read,
			async send<T>(message: Record<string, unknown>) {
				sent.push(message);
				return count(0, false, mode) as unknown as T;
			},
			appName: 'TabLodge',
			undo: async () => '',
		});
		await vi.advanceTimersByTimeAsync(1000);
		assert.deepEqual(toasts, [], mode);
		assert.equal(
			sent.some((message) => message.type === 'SITE_SOURCE_CATCH_UP_ADD'),
			false,
			mode,
		);
		vi.useRealTimers();
	}
});

test('Add them automatically adds the items at once and reports them with Undo', async () => {
	vi.useFakeTimers();
	const {read} = savedPage([first]);
	const sent: Array<Record<string, unknown>> = [];
	const undone: string[] = [];
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read,
		async send<T>(message: Record<string, unknown>) {
			sent.push(message);
			switch (message.type) {
				case 'SITE_SOURCE_CATCH_UP': {
					return count(1, true, 'add') as unknown as T;
				}

				case 'SITE_SOURCE_CATCH_UP_ADD': {
					return {
						ok: true,
						added: 1,
						column: 'YouTube',
						undoId: 'undo-1',
					} as unknown as T;
				}

				default: {
					return undefined;
				}
			}
		},
		appName: 'TabLodge',
		async undo(id) {
			undone.push(id);
			return 'Removed from TabLodge.';
		},
	});

	await vi.advanceTimersByTimeAsync(1000);
	assert.deepEqual(sent.at(-1), {
		type: 'SITE_SOURCE_CATCH_UP_ADD',
		source: 'youtube',
		links: [first],
		automatic: true,
	});
	assert.deepEqual(
		toasts.map((toast) => [
			toast.text,
			toast.actions.map((action) => action.label),
		]),
		[['Added 1 to TabLodge in YouTube.', ['Undo']]],
	);
	await toasts[0].actions[0].run();
	assert.deepEqual(undone, ['undo-1']);
});

test('Ask first offers Add them and Not now, and Add them adds on the click', async () => {
	vi.useFakeTimers();
	const {read} = savedPage([first]);
	const sent: Array<Record<string, unknown>> = [];
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read,
		async send<T>(message: Record<string, unknown>) {
			sent.push(message);
			return (message.type === 'SITE_SOURCE_CATCH_UP'
				? count(1, true, 'ask')
				: {
						ok: true,
						added: 1,
						column: 'YouTube',
						undoId: 'undo-1',
					}) as unknown as T;
		},
		appName: 'TabLodge',
		undo: async () => 'Removed from TabLodge.',
	});

	await vi.advanceTimersByTimeAsync(1000);
	assert.equal(toasts[0].text, "1 saved item on this page isn't in TabLodge.");
	assert.deepEqual(
		toasts[0].actions.map((action) => action.label),
		['Add them', 'Not now'],
	);
	assert.equal(
		sent.some((message) => message.type === 'SITE_SOURCE_CATCH_UP_ADD'),
		false,
		'nothing is added before the answer',
	);

	const next = (await toasts[0].actions[0].run()) as {
		text: string;
		action: {label: string};
	};
	assert.equal(next.text, 'Added 1 to TabLodge in YouTube.');
	assert.equal(next.action.label, 'Undo');
	const add = sent.find(
		(message) => message.type === 'SITE_SOURCE_CATCH_UP_ADD',
	);
	assert.equal(add?.automatic, undefined);
});

test('Ask first asks once while the list grows under it', async () => {
	vi.useFakeTimers();
	const page = savedPage([first]);
	let counted = 0;
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: page.read,
		async send<T>(message: Record<string, unknown>) {
			if (message.type === 'SITE_SOURCE_CATCH_UP') {
				counted += 1;
				return count(counted, true, 'ask') as unknown as T;
			}

			return undefined;
		},
		appName: 'TabLodge',
		undo: async () => '',
	});

	await vi.advanceTimersByTimeAsync(1000);
	page.set([first, second]);
	await vi.advanceTimersByTimeAsync(2000);
	assert.equal(counted, 2, 'the longer list was counted');
	assert.deepEqual(
		toasts.map((toast: Shown) => toast.text),
		["1 saved item on this page isn't in TabLodge."],
		'the second count did not ask again',
	);
});

test('a list the site empties while redrawing does not ask a second time', async () => {
	vi.useFakeTimers();
	const page = savedPage([first]);
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: page.read,
		async send<T>(message: Record<string, unknown>) {
			return (message.type === 'SITE_SOURCE_CATCH_UP'
				? count(1, true, 'ask')
				: undefined) as unknown as T;
		},
		appName: 'TabLodge',
		undo: async () => '',
	});

	await vi.advanceTimersByTimeAsync(1000);
	page.set([]);
	await vi.advanceTimersByTimeAsync(2000);
	page.set([first]);
	await vi.advanceTimersByTimeAsync(2000);
	assert.equal(toasts.length, 1, 'the redraw asked nothing new');
});

test('Add them automatically keeps adding the items that arrive later, each with its own Undo', async () => {
	vi.useFakeTimers();
	const page = savedPage([first]);
	const added: Array<{links: SourceLink[]; automatic?: boolean}> = [];
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: page.read,
		async send<T>(message: Record<string, unknown>) {
			switch (message.type) {
				case 'SITE_SOURCE_CATCH_UP': {
					return {ok: true, missing: 1, ask: true, mode: 'add'} as unknown as T;
				}

				case 'SITE_SOURCE_CATCH_UP_ADD': {
					added.push({
						links: message.links as SourceLink[],
						automatic: message.automatic as boolean | undefined,
					});
					return {
						ok: true,
						added: 1,
						column: 'YouTube',
						undoId: `undo-${added.length}`,
					} as unknown as T;
				}

				default: {
					return undefined;
				}
			}
		},
		appName: 'TabLodge',
		undo: async () => 'Removed from TabLodge.',
	});

	await vi.advanceTimersByTimeAsync(1000);
	page.set([first, second]);
	await vi.advanceTimersByTimeAsync(2000);
	assert.deepEqual(
		added.map((batch) => [
			batch.automatic,
			batch.links.map((link) => link.url),
		]),
		[
			[true, [first.url]],
			[true, [first.url, second.url]],
		],
	);
	assert.deepEqual(
		toasts.map((toast: Shown) => [
			toast.text,
			toast.actions.map((action) => action.label),
		]),
		[
			['Added 1 to TabLodge in YouTube.', ['Undo']],
			['Added 1 to TabLodge in YouTube.', ['Undo']],
		],
		'each batch reports its own adds, with its own Undo',
	);
});

test('an automatic batch that finishes while the list changed still reports its Undo', async () => {
	vi.useFakeTimers();
	const page = savedPage([first]);
	const add = Promise.withResolvers<unknown>();
	let firstAdd = true;
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: page.read,
		async send<T>(message: Record<string, unknown>) {
			switch (message.type) {
				case 'SITE_SOURCE_CATCH_UP': {
					return {
						ok: true,
						missing: 1,
						ask: true,
						mode: 'add',
					} as unknown as T;
				}

				case 'SITE_SOURCE_CATCH_UP_ADD': {
					if (firstAdd) {
						firstAdd = false;
						return add.promise as unknown as T;
					}

					return {ok: true, added: 1, column: 'YouTube'} as unknown as T;
				}

				default: {
					return undefined;
				}
			}
		},
		appName: 'TabLodge',
		undo: async () => 'Removed from TabLodge.',
	});

	await vi.advanceTimersByTimeAsync(1000);
	page.set([first, second]);
	await vi.advanceTimersByTimeAsync(2000);
	add.resolve({ok: true, added: 1, column: 'YouTube', undoId: 'undo-1'});
	await vi.advanceTimersByTimeAsync(0);
	assert.ok(
		toasts.some((toast: Shown) => toast.actions[0]?.label === 'Undo'),
		'the batch shows its Undo although the list grew meanwhile',
	);
});

test('an automatic add that finishes after the user left the saved page shows nothing', async () => {
	vi.useFakeTimers();
	const page = savedPage([first]);
	const add = Promise.withResolvers<unknown>();
	let onSavedPage = true;
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: () => (onSavedPage ? page.read() : undefined),
		async send<T>(message: Record<string, unknown>) {
			return message.type === 'SITE_SOURCE_CATCH_UP_ADD'
				? (add.promise as unknown as T)
				: ({ok: true, missing: 1, ask: true, mode: 'add'} as unknown as T);
		},
		appName: 'TabLodge',
		undo: async () => '',
	});

	await vi.advanceTimersByTimeAsync(1000);
	onSavedPage = false;
	page.set([]);
	await vi.advanceTimersByTimeAsync(2000);
	add.resolve({ok: true, added: 1, column: 'YouTube', undoId: 'undo-1'});
	await vi.advanceTimersByTimeAsync(0);
	assert.deepEqual(
		toasts,
		[],
		'the result of a list the user left is not shown',
	);
});

test('the same items redrawn in another order are not counted again', async () => {
	vi.useFakeTimers();
	const page = savedPage([first, second]);
	let counted = 0;
	watchSavedPage({
		source: siteSourceById('youtube')!,
		read: page.read,
		async send<T>(message: Record<string, unknown>) {
			if (message.type === 'SITE_SOURCE_CATCH_UP') {
				counted += 1;
				return count(2, true, 'ask') as unknown as T;
			}

			return undefined;
		},
		appName: 'TabLodge',
		undo: async () => '',
	});

	await vi.advanceTimersByTimeAsync(1000);
	page.set([second, first]);
	await vi.advanceTimersByTimeAsync(2000);
	assert.equal(counted, 1);
	assert.equal(toasts.length, 1);
});
