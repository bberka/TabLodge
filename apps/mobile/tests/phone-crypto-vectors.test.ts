import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	fromBase64,
	importDataKey,
	openValue,
	unwrapDataKey,
	type SealedValue,
} from '../../extension/src/shared/private-lock';
import {recordKey} from '../../extension/src/shared/sync/changes';
import vectors from './support/phone-made.json';

test('the extension opens the envelope the phone wrapped with its PIN, and not with another', async () => {
	const key = await unwrapDataKey(vectors.wrapped, vectors.pin);
	assert.equal(key.length, 32);
	await assert.rejects(unwrapDataKey(vectors.wrapped, '1111'), {
		code: 'wrong-credential',
	});
});

test('the extension opens a record value the phone sealed, and only under its own record key', async () => {
	const key = await importDataKey(
		await unwrapDataKey(vectors.wrapped, vectors.pin),
	);
	const {kind, id, value} = vectors.record;
	const name = recordKey({kind, id} as Parameters<typeof recordKey>[0]);
	const opened = (await openValue(key, name, value as SealedValue)) as {
		url: string;
	};
	assert.match(opened.url, /^https:\/\/phone-own\.example\//);
	assert.equal(fromBase64(value.iv).length, 12);
	await assert.rejects(openValue(key, `${name}x`, value as SealedValue), {
		code: 'damaged',
	});
});
