import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vite-plus/test';
import {
	COPY_DELETED,
	COPY_INDEX_KEY,
	createCopyStore,
	type CopyStorage,
	type PageCopy,
} from '../../extension/src/shared/page-copy';

const snacks: Array<{message: string; run?: () => void | Promise<void>}> = [];
const stored = new Map<string, unknown>();
const storage: CopyStorage = {
	async get(keys) {
		return Object.fromEntries(
			keys.flatMap((key) => (stored.has(key) ? [[key, stored.get(key)]] : [])),
		);
	},
	async set(items) {
		for (const [key, value] of Object.entries(items)) {
			stored.set(key, structuredClone(value));
		}
	},
	async remove(keys) {
		for (const key of keys) {
			stored.delete(key);
		}
	},
};
const copies = createCopyStore(storage);

vi.mock('../src/ui/snackbar', () => ({
	showSnack(message: string, action?: {run: () => void | Promise<void>}) {
		snacks.push({message, run: action?.run});
	},
}));
vi.mock('../src/library/page-copies', () => ({
	async deleteCopy(url: string) {
		const copy = await copies.read(url);
		await copies.remove(url);
		return copy;
	},
	async putCopyBack(copy: PageCopy) {
		const kept = await copies.keep(copy);
		return kept.ok ? {ok: true} : {ok: false, error: kept.error};
	},
}));

const {deleteCopyWithUndo} = await import('../src/library/copy-undo');

const url = 'https://kept.example/post';
const copy: PageCopy = {
	v: 1,
	url,
	title: 'A post',
	byline: 'Someone',
	savedAt: 1_700_000_000_000,
	blocks: [
		{type: 'heading', text: 'Heading'},
		{type: 'paragraph', text: 'Body text.'},
		{type: 'item', text: 'One'},
	],
};
const storedKeys = () =>
	[...stored.keys()].filter((key) => key !== COPY_INDEX_KEY);

beforeEach(async () => {
	snacks.length = 0;
	stored.clear();
	await copies.keep(copy);
});

test('Delete copy removes the copy and its stored key at once and offers Undo with the shared wording', async () => {
	const opened: string[] = [];
	await deleteCopyWithUndo(url, (target) => {
		opened.push(target);
	});
	assert.equal(await copies.read(url), undefined);
	assert.deepEqual(storedKeys(), []);
	assert.equal(snacks.length, 1);
	assert.equal(snacks[0].message, COPY_DELETED);
	assert.equal(typeof snacks[0].run, 'function');
	assert.deepEqual(opened, []);
});

test('Undo brings back the same copy and opens it in the reader', async () => {
	const opened: string[] = [];
	await deleteCopyWithUndo(url, (target) => {
		opened.push(target);
	});
	await snacks[0].run?.();
	assert.deepEqual(await copies.read(url), copy);
	assert.deepEqual(opened, [url]);
});

test('without Undo nothing of the copy stays on the phone', async () => {
	await deleteCopyWithUndo(url, () => undefined);
	assert.deepEqual([...stored.keys()], [COPY_INDEX_KEY]);
	assert.deepEqual(stored.get(COPY_INDEX_KEY), {v: 1, items: []});
});

test('deleting a copy that is gone shows no snackbar', async () => {
	await copies.remove(url);
	await deleteCopyWithUndo(url, () => undefined);
	assert.equal(snacks.length, 0);
});
