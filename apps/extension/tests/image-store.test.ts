import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {test} from 'vite-plus/test';
import {
	IMAGE_ERRORS,
	IMAGE_INDEX_KEY,
	IMAGE_MAX_BYTES,
	THUMB_MAX_BYTES,
	base64Size,
	base64ToBytes,
	bytesToBase64,
	createImageStore,
	imageFileName,
	imageId,
	parseSavedImage,
	parseThumb,
	sniffImageType,
	thumbDataUrl,
} from '../src/shared/image-store';
import {PNG, WEBP, memoryStorage, picture} from './image-fixtures';

test('base64 survives a round trip at every padding length', () => {
	for (const length of [0, 1, 2, 3, 4, 5, 3000, 9001]) {
		const bytes = Uint8Array.from({length}, (_, index) => (index * 37) % 256);
		const text = bytesToBase64(bytes);
		assert.equal(text, Buffer.from(bytes).toString('base64'));
		assert.equal(base64Size(text), length);
		assert.deepEqual(base64ToBytes(text), bytes);
	}
});

test('the type comes from the bytes, never from what the page claimed', () => {
	const magic = (bytes: number[] | string) =>
		sniffImageType(
			typeof bytes === 'string'
				? new TextEncoder().encode(bytes)
				: Uint8Array.from(bytes),
		);
	assert.equal(magic([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');
	assert.equal(sniffImageType(base64ToBytes(PNG)), 'image/png');
	assert.equal(magic('GIF89a....'), 'image/gif');
	assert.equal(sniffImageType(base64ToBytes(WEBP)), 'image/webp');
	assert.equal(magic('\0\0\0\u001Cftypavif\0\0'), 'image/avif');
	assert.equal(magic('<svg xmlns="http://www.w3.org/2000/svg"/>'), undefined);
	assert.equal(magic('<!doctype html><script>'), undefined);

	const claimed = parseSavedImage({...picture(), type: 'image/jpeg'});
	assert.deepEqual(
		typeof claimed === 'object' && [claimed.type, claimed.size],
		['image/png', base64Size(PNG)],
	);
});

test('a record with a bad address, size, or thumbnail is refused', () => {
	assert.equal(
		parseSavedImage({...picture(), url: 'javascript:alert(1)'}),
		undefined,
	);
	assert.equal(parseSavedImage({...picture(), width: 0}), undefined);
	assert.equal(parseSavedImage({...picture(), data: '<svg>'}), undefined);
	assert.equal(
		parseSavedImage({...picture(), thumb: 'not base64!'}),
		undefined,
	);
	assert.equal(
		parseThumb({
			...picture(),
			size: 5,
			thumb: bytesToBase64(new Uint8Array(THUMB_MAX_BYTES + 1)),
		}),
		'too-large',
	);
});

test('a kept image comes back whole, with its thumbnail and the device that holds it', async () => {
	const {storage, data} = memoryStorage();
	const store = createImageStore(storage);
	const kept = await store.keep(picture());
	assert.ok(kept.ok);
	assert.equal(kept.entry.held, base64Size(PNG));
	assert.equal(kept.entry.id, imageId('https://cdn.example/cat.png'));

	const image = await store.read('https://cdn.example/cat.png');
	assert.equal(image?.data, PNG);
	assert.equal(image?.device, 'Desk');
	assert.deepEqual(await store.thumbs(), [
		{
			url: 'https://cdn.example/cat.png',
			type: 'image/png',
			width: 640,
			height: 480,
			size: base64Size(PNG),
			savedAt: 1000,
			device: 'Desk',
			thumb: WEBP,
			held: true,
		},
	]);
	assert.equal(thumbDataUrl(WEBP), `data:image/webp;base64,${WEBP}`);
	assert.deepEqual(await store.usage(), {
		count: 1,
		held: 1,
		size: base64Size(PNG),
		budget: 100_000_000,
	});
	assert.equal(Object.keys(data).length, 3, 'index, original, thumbnail');
});

test('what is not a supported picture, is too large, or does not fit the budget is refused by name', async () => {
	const store = createImageStore(memoryStorage().storage, base64Size(PNG) + 10);
	const html = await store.keep({
		...picture(),
		data: Buffer.from('<html><script>alert(1)</script>').toString('base64'),
	});
	assert.deepEqual(html, {
		ok: false,
		reason: 'unsupported',
		error: IMAGE_ERRORS.unsupported,
	});

	const huge = Buffer.alloc(IMAGE_MAX_BYTES + 3);
	huge.set(base64ToBytes(PNG));
	const large = await store.keep({
		...picture(),
		data: huge.toString('base64'),
	});
	assert.equal(large.ok, false);
	assert.equal(!large.ok && large.reason, 'too-large');

	assert.ok((await store.keep(picture())).ok);
	const second = await store.keep(picture('https://cdn.example/dog.png'));
	assert.deepEqual(second, {
		ok: false,
		reason: 'full',
		error: IMAGE_ERRORS.full,
	});
	assert.match(IMAGE_ERRORS.full, /100 MB/);
	assert.ok(
		(await store.keep({...picture(), savedAt: 2000})).ok,
		'replacing an image counts its old size as free',
	);
	assert.deepEqual(
		(await store.list()).map((item) => [item.url, item.savedAt]),
		[['https://cdn.example/cat.png', 2000]],
		'nothing was evicted to make room',
	);
});

test('remove and sweep delete the original, the thumbnail, and the index entry', async () => {
	const {storage, data} = memoryStorage();
	const store = createImageStore(storage);
	await store.keep(picture('https://cdn.example/a.png'));
	await store.keep(picture('https://cdn.example/b.png'));
	await store.keep(picture('https://cdn.example/c.png'));

	assert.equal(await store.remove('https://cdn.example/a.png'), true);
	assert.equal(await store.remove('https://cdn.example/a.png'), false);
	assert.equal(await store.sweep(new Set(['https://cdn.example/c.png'])), 1);
	assert.deepEqual(
		(await store.list()).map((item) => item.url),
		['https://cdn.example/c.png'],
	);
	assert.equal(Object.keys(data).length, 3);
	assert.equal(await store.read('https://cdn.example/b.png'), undefined);
});

test('a thumbnail from another device shows without an original, and a delete from there removes it', async () => {
	const store = createImageStore(memoryStorage().storage);
	const {data: _data, ...remote} = {
		...picture('https://cdn.example/far.png'),
		device: 'Laptop',
	};
	await store.applySynced([remote, {url: 'nope'}], []);
	assert.deepEqual(
		(await store.thumbs()).map(({url, device, held}) => ({url, device, held})),
		[{url: 'https://cdn.example/far.png', device: 'Laptop', held: false}],
	);
	assert.equal(await store.read('https://cdn.example/far.png'), undefined);
	assert.equal((await store.usage()).size, 0);
	assert.deepEqual(await store.synced(), [
		{id: imageId('https://cdn.example/far.png'), value: remote},
	]);

	await store.applySynced([], [imageId('https://cdn.example/far.png')]);
	assert.deepEqual(await store.list(), []);
});

test('a synced thumbnail for an image this device holds keeps the original', async () => {
	const store = createImageStore(memoryStorage().storage);
	await store.keep(picture());
	const {data: _data, ...remote} = {...picture(), device: 'Laptop', savedAt: 5};
	await store.applySynced([remote], []);
	const image = await store.read('https://cdn.example/cat.png');
	assert.equal(image?.data, PNG);
	assert.equal(image?.device, 'Laptop');
	assert.deepEqual(
		(await store.synced()).map((record) => record.value),
		[remote],
		'the device sends back what it was given, so two holders do not push in turns',
	);
	assert.equal((await store.usage()).size, base64Size(PNG));
});

test('restore keeps what passes the same checks and counts it', async () => {
	const source = createImageStore(memoryStorage().storage);
	await source.keep(picture('https://cdn.example/a.png'));
	await source.keep(picture('https://cdn.example/b.png'));
	const target = createImageStore(memoryStorage().storage);
	assert.equal(
		await target.restore([...(await source.all()), {url: 'x'}, null]),
		2,
	);
	assert.equal((await target.read('https://cdn.example/b.png'))?.data, PNG);
});

test('an index that was tampered with lists only entries that still check out', async () => {
	const {storage, data} = memoryStorage();
	const store = createImageStore(storage);
	await store.keep(picture());
	const index = data[IMAGE_INDEX_KEY] as {items: unknown[]};
	index.items.push({url: 'file:///etc/passwd', held: 1}, 7, index.items[0]);
	assert.equal((await store.list()).length, 1);
});

test('a download name comes from the site and the file, with the real extension', () => {
	assert.equal(
		imageFileName({
			url: 'https://www.photos.example/a/b/My%20cat.JPEG?w=800',
			type: 'image/png',
		}),
		'photos.example-My-cat.png',
	);
	assert.equal(
		imageFileName({url: 'https://cdn.example/', type: 'image/webp'}),
		'cdn.example.webp',
	);
});
