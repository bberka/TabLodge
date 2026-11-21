import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {normalizeStore} from '../src/shared/library-normalize';
import {
	createInboxKeyPair,
	openInboxEntry,
	sealForInbox,
} from '../src/shared/private-inbox';
import {
	addSentLinks,
	parseSendTargets,
	SENT_COLUMN_ID,
	takeOutForPrivate,
	type SentLink,
} from '../src/shared/send-to-private';

const regular = () =>
	normalizeStore({
		groups: [
			{
				id: 's1',
				name: 'Reading',
				tabs: [
					{id: 't1', title: 'One', url: 'https://one.example/', notes: 'n1'},
					{id: 't2', title: 'Two', url: 'https://two.example/'},
				],
			},
			{
				id: 's2',
				name: 'Single',
				tabs: [{id: 't3', title: 'Three', url: 'https://three.example/'}],
			},
		],
		bookmarkColumns: [{id: 'c1', name: 'Work'}],
		bookmarks: [
			{
				id: 'b1',
				title: 'Secret',
				url: 'https://secret.example/',
				columnId: 'c1',
				notes: 'private note',
				tags: ['health'],
			},
			{id: 'b2', title: 'Kept', url: 'https://kept.example/', columnId: 'c1'},
		],
	});

test('sending takes the links out of the regular library and drops a session it empties', () => {
	const before = regular();
	const untouched = structuredClone(before);
	const result = takeOutForPrivate(before, [
		{kind: 'bookmark', bookmarkId: 'b1'},
		{kind: 'tab', sessionId: 's1', tabId: 't1'},
		{kind: 'tab', sessionId: 's2', tabId: 't3'},
	]);
	assert.ok(result.ok);
	const {store} = result;
	assert.deepEqual(before, untouched, 'the given library is not changed');
	assert.deepEqual(
		result.links.map((link) => link.url),
		[
			'https://secret.example/',
			'https://one.example/',
			'https://three.example/',
		],
	);
	assert.deepEqual(
		store.bookmarks.map((bookmark) => bookmark.id),
		['b2'],
	);
	assert.deepEqual(
		store.groups.map((group) => [group.id, group.tabs.map((tab) => tab.id)]),
		[['s1', ['t2']]],
	);
	assert.equal(JSON.stringify(store).includes('secret.example'), false);
});

test('a target that is gone leaves the regular library untouched', () => {
	const result = takeOutForPrivate(regular(), [
		{kind: 'bookmark', bookmarkId: 'b1'},
		{kind: 'tab', sessionId: 's1', tabId: 'missing'},
	]);
	assert.equal(result.ok, false);
});

test('the same target twice is refused', () => {
	const result = takeOutForPrivate(regular(), [
		{kind: 'bookmark', bookmarkId: 'b1'},
		{kind: 'bookmark', bookmarkId: 'b1'},
	]);
	assert.equal(result.ok, false);
});

test('send targets from a message are checked', () => {
	assert.equal(parseSendTargets([]), undefined);
	assert.equal(parseSendTargets([{kind: 'bookmark'}]), undefined);
	assert.equal(parseSendTargets('b1'), undefined);
	assert.deepEqual(
		parseSendTargets([
			{kind: 'bookmark', bookmarkId: 'b1'},
			{kind: 'tab', sessionId: 's1', tabId: 't1'},
		]),
		[
			{kind: 'bookmark', bookmarkId: 'b1'},
			{kind: 'tab', sessionId: 's1', tabId: 't1'},
		],
	);
});

test('sent links land in one fixed column, keep their note and tags, and are not added twice', () => {
	const empty = normalizeStore(null);
	const links: SentLink[] = [
		{
			title: 'Secret',
			url: 'https://secret.example/',
			notes: 'private note',
			tags: ['health'],
			createdAt: 5,
		},
		{title: 'Tab', url: 'https://tab.example/', createdAt: 6},
	];
	const first = addSentLinks(empty, links);
	assert.equal(first.added, 2);
	const again = addSentLinks(first.store, links);
	assert.equal(again.added, 0);
	assert.equal(again.store, first.store);
	const {store} = first;
	const column = store.bookmarkColumns.filter(
		(entry) => entry.id === SENT_COLUMN_ID,
	);
	assert.equal(column.length, 1);
	assert.equal(column[0].name, 'Sent from regular windows');
	const sent = store.bookmarks.filter(
		(bookmark) => bookmark.columnId === SENT_COLUMN_ID,
	);
	assert.deepEqual(
		sent.map(({url, notes, tags}) => ({url, notes, tags})),
		[
			{
				url: 'https://secret.example/',
				notes: 'private note',
				tags: ['health'],
			},
			{url: 'https://tab.example/', notes: undefined, tags: undefined},
		],
	);
	const normalized = normalizeStore(structuredClone(store));
	assert.ok(
		normalized.bookmarkColumns.some((entry) => entry.id === SENT_COLUMN_ID),
	);
});

const links: SentLink[] = [
	{
		title: 'Secret',
		url: 'https://secret.example/',
		notes: 'private note',
		createdAt: 1,
	},
];

test('an inbox entry holds no readable link and opens only with the private key', async () => {
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', links);
	const text = JSON.stringify(entry);
	assert.equal(text.includes('secret'), false);
	assert.equal(text.includes('private note'), false);
	assert.deepEqual(await openInboxEntry(pair, 'e1', entry), links);

	const other = await createInboxKeyPair();
	assert.equal(await openInboxEntry(other, 'e1', entry), undefined);
});

test('an inbox entry moved to another id or changed does not open', async () => {
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', links);
	assert.equal(await openInboxEntry(pair, 'e2', entry), undefined);
	const flipped = {...entry, ct: `${entry.ct.slice(0, -4)}AAAA`};
	assert.equal(await openInboxEntry(pair, 'e1', flipped), undefined);
	assert.equal(await openInboxEntry(pair, 'e1', {v: 2}), undefined);
});

test('the public key alone cannot open an entry', async () => {
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', links);
	const publicOnly = {...pair, privateKey: pair.publicKey};
	assert.equal(await openInboxEntry(publicOnly, 'e1', entry), undefined);
});

test('a send of more than 500 links is refused before anything leaves the library', () => {
	const store = normalizeStore({
		bookmarkColumns: [{id: 'c1', name: 'Work'}],
		bookmarks: Array.from({length: 501}, (_, index) => ({
			id: `b${index}`,
			title: `Link ${index}`,
			url: `https://link-${index}.example/`,
			columnId: 'c1',
		})),
	});
	const untouched = structuredClone(store);
	const result = takeOutForPrivate(
		store,
		store.bookmarks.map((bookmark) => ({
			kind: 'bookmark' as const,
			bookmarkId: bookmark.id,
		})),
	);
	assert.equal(result.ok, false);
	assert.deepEqual(store, untouched);
});

test('the same address with a different note is still added; an identical replay is not', () => {
	const first = addSentLinks(normalizeStore(null), [
		{title: 'Secret', url: 'https://secret.example/', notes: 'A', createdAt: 1},
	]);
	const replay = addSentLinks(first.store, [
		{title: 'Secret', url: 'https://secret.example/', notes: 'A', createdAt: 1},
	]);
	assert.equal(replay.added, 0);
	const other = addSentLinks(first.store, [
		{title: 'Secret', url: 'https://secret.example/', notes: 'B', createdAt: 2},
	]);
	assert.equal(other.added, 1);
});
