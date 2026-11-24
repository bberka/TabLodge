import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {normalizeStore} from '../src/shared/library-normalize';
import {
	createInboxKeyPair,
	openInboxEntry,
	payloadBody,
	sealForInbox,
} from '../src/shared/private-inbox';
import {
	addSent,
	addSentLinks,
	MAX_SENT_PAYLOAD_LINKS,
	parseSendTargets,
	SENT_COLUMN_ID,
	sentLinkCount,
	sentMessage,
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
		result.sent.links.map((link) => link.url),
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
	const entry = await sealForInbox(pair.publicKey, 'e1', {
		links,
		columns: [],
		sessions: [],
	});
	const text = JSON.stringify(entry);
	assert.equal(text.includes('secret'), false);
	assert.equal(text.includes('private note'), false);
	assert.deepEqual(await openInboxEntry(pair, 'e1', entry), {
		links,
		columns: [],
		sessions: [],
	});

	const other = await createInboxKeyPair();
	assert.equal(await openInboxEntry(other, 'e1', entry), undefined);
});

test('an inbox entry moved to another id or changed does not open', async () => {
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', {
		links,
		columns: [],
		sessions: [],
	});
	assert.equal(await openInboxEntry(pair, 'e2', entry), undefined);
	const flipped = {...entry, ct: `${entry.ct.slice(0, -4)}AAAA`};
	assert.equal(await openInboxEntry(pair, 'e1', flipped), undefined);
	assert.equal(await openInboxEntry(pair, 'e1', {v: 2}), undefined);
});

test('the public key alone cannot open an entry', async () => {
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', {
		links,
		columns: [],
		sessions: [],
	});
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
		{title: 'Secret', url: 'https://secret.example/', notes: 'B', createdAt: 1},
	]);
	assert.equal(other.added, 1);
});

const library = () =>
	normalizeStore({
		folders: [{id: 'trips', name: 'Trips'}],
		groups: [
			{
				id: 'trip',
				name: 'Lisbon',
				folderId: 'trips',
				createdAt: 1_600_000_000_000,
				updatedAt: 1_650_000_000_000,
				tabs: ['c', 'a', 'b'].map((name) => ({
					id: `t-${name}`,
					title: `Page ${name}`,
					url: `https://${name}.example/`,
					notes: name === 'a' ? 'keep me' : '',
				})),
			},
		],
		bookmarkColumns: [
			{id: 'c1', name: 'Work', icon: 'star', color: '#336699'},
			{id: 'source-youtube', name: 'YouTube'},
			{id: 'empty', name: 'Empty'},
		],
		bookmarks: [
			{
				id: 'b1',
				title: 'One',
				url: 'https://one.example/',
				columnId: 'c1',
				notes: 'n1',
				tags: ['t'],
			},
			{
				id: 'x1',
				title: 'Video',
				url: 'https://video.example/',
				columnId: 'source-youtube',
			},
			{id: 'b2', title: 'Two', url: 'https://two.example/', columnId: 'c1'},
		],
	});

test('send targets for a whole column or session are checked and stand alone', () => {
	assert.deepEqual(parseSendTargets([{kind: 'column', columnId: 'c1'}]), [
		{kind: 'column', columnId: 'c1'},
	]);
	assert.deepEqual(parseSendTargets([{kind: 'session', sessionId: 's1'}]), [
		{kind: 'session', sessionId: 's1'},
	]);
	assert.equal(parseSendTargets([{kind: 'column'}]), undefined);
	assert.equal(parseSendTargets([{kind: 'session', sessionId: 1}]), undefined);
	assert.equal(
		parseSendTargets([
			{kind: 'column', columnId: 'c1'},
			{kind: 'bookmark', bookmarkId: 'b1'},
		]),
		undefined,
	);
});

test('sending a column takes the column and its bookmarks, in order, with notes and tags', () => {
	const before = library();
	const untouched = structuredClone(before);
	const result = takeOutForPrivate(before, [{kind: 'column', columnId: 'c1'}]);
	assert.ok(result.ok);
	assert.deepEqual(before, untouched);
	assert.equal(result.count, 2);
	assert.equal(result.keptColumn, undefined);
	assert.equal(result.sent.links.length, 0);
	const [column] = result.sent.columns;
	assert.equal(column.name, 'Work');
	assert.equal(column.icon, 'star');
	assert.equal(column.color, '#336699');
	assert.deepEqual(
		column.links.map(({url, notes, tags}) => ({url, notes, tags})),
		[
			{url: 'https://one.example/', notes: 'n1', tags: ['t']},
			{url: 'https://two.example/', notes: undefined, tags: undefined},
		],
	);
	assert.deepEqual(
		result.store.bookmarkColumns.map((entry) => entry.id),
		['source-youtube', 'empty'],
	);
	assert.deepEqual(
		result.store.bookmarks.map((entry) => entry.id),
		['x1'],
	);
	assert.equal(JSON.stringify(result.store).includes('one.example'), false);
});

test('a column with a site source keeps the column and says so', () => {
	const result = takeOutForPrivate(library(), [
		{kind: 'column', columnId: 'source-youtube'},
	]);
	assert.ok(result.ok);
	assert.equal(result.keptColumn, 'YouTube');
	assert.ok(
		result.store.bookmarkColumns.some((entry) => entry.id === 'source-youtube'),
	);
	assert.deepEqual(
		result.store.bookmarks.map((entry) => entry.id),
		['b1', 'b2'],
	);
	assert.match(sentMessage(result.count, result.keptColumn), /stays here/);
	assert.doesNotMatch(sentMessage(2), /stays/);

	const chosen = takeOutForPrivate(
		library(),
		[{kind: 'column', columnId: 'c1'}],
		{keepColumnIds: new Set(['c1'])},
	);
	assert.ok(chosen.ok);
	assert.equal(chosen.keptColumn, 'Work');
	assert.ok(chosen.store.bookmarkColumns.some((entry) => entry.id === 'c1'));
});

test('an empty column, a missing column and a missing session send nothing', () => {
	const store = library();
	for (const target of [
		{kind: 'column', columnId: 'empty'},
		{kind: 'column', columnId: 'gone'},
		{kind: 'session', sessionId: 'gone'},
	] as const) {
		const result = takeOutForPrivate(store, [target]);
		assert.equal(result.ok, false);
	}

	const empty = takeOutForPrivate(store, [{kind: 'column', columnId: 'empty'}]);
	assert.equal(!empty.ok && empty.error, '“Empty” has no bookmarks to send.');
});

test('sending a session takes its name, links in order and saved date, and it arrives outside any folder', () => {
	const result = takeOutForPrivate(library(), [
		{kind: 'session', sessionId: 'trip'},
	]);
	assert.ok(result.ok);
	assert.equal(result.count, 3);
	assert.equal(result.store.groups.length, 0);
	const [session] = result.sent.sessions;
	assert.equal(session.name, 'Lisbon');
	assert.equal(session.createdAt, 1_600_000_000_000);
	assert.deepEqual(
		session.links.map((link) => link.url),
		['https://c.example/', 'https://a.example/', 'https://b.example/'],
	);

	const arrived = addSent(normalizeStore(null), result.sent);
	assert.equal(arrived.added, 3);
	const [landed] = arrived.store.groups;
	assert.equal(landed.name, 'Lisbon');
	assert.equal(landed.createdAt, 1_600_000_000_000);
	assert.equal(landed.folderId, 'unfiled');
	assert.deepEqual(
		landed.tabs.map((tab) => [tab.url, tab.notes]),
		[
			['https://c.example/', ''],
			['https://a.example/', 'keep me'],
			['https://b.example/', ''],
		],
	);
	const changed = structuredClone(result.sent);
	changed.sessions[0].links[1].notes = 'different note';
	const kept = addSent(arrived.store, changed);
	assert.equal(
		kept.store.groups.length,
		2,
		'a session with other notes is kept',
	);
	const replay = addSent(arrived.store, result.sent);
	assert.equal(
		replay.store.groups.length,
		1,
		'a replayed take-in adds no copy',
	);
});

test('a sent column becomes a column with the same look, or joins the one with that name', () => {
	const taken = takeOutForPrivate(library(), [
		{kind: 'column', columnId: 'c1'},
	]);
	assert.ok(taken.ok);
	const fresh = addSent(normalizeStore(null), taken.sent);
	const column = fresh.store.bookmarkColumns.find(
		(entry) => entry.name === 'Work',
	);
	assert.equal(column?.icon, 'star');
	assert.equal(column?.color, '#336699');
	assert.deepEqual(
		fresh.store.bookmarks
			.filter((entry) => entry.columnId === column?.id)
			.map((entry) => [entry.url, entry.notes, entry.tags]),
		[
			['https://one.example/', 'n1', ['t']],
			['https://two.example/', undefined, undefined],
		],
	);

	const existing = addSent(
		normalizeStore({
			bookmarkColumns: [{id: 'mine', name: 'WORK', color: '#aa0000'}],
			bookmarks: [
				{
					id: 'm1',
					title: 'One',
					url: 'https://one.example/',
					columnId: 'mine',
					notes: 'n1',
					tags: ['t'],
				},
				{
					id: 'm2',
					title: 'Mine',
					url: 'https://mine.example/',
					columnId: 'mine',
				},
			],
		}),
		taken.sent,
	);
	assert.equal(
		existing.store.bookmarkColumns.filter(
			(entry) => entry.name.toLowerCase() === 'work',
		).length,
		1,
	);
	assert.equal(
		existing.store.bookmarkColumns.find((entry) => entry.id === 'mine')?.color,
		'#aa0000',
	);
	assert.equal(
		existing.added,
		1,
		'the identical link is skipped, the other is added',
	);
	assert.deepEqual(
		existing.store.bookmarks
			.filter((entry) => entry.columnId === 'mine')
			.map((entry) => entry.url),
		['https://one.example/', 'https://mine.example/', 'https://two.example/'],
	);
	const replay = addSent(existing.store, taken.sent);
	assert.equal(replay.added, 0);
});

test('a column or session entry opens with the private key, and a link-only entry stays version 1', async () => {
	const taken = takeOutForPrivate(library(), [
		{kind: 'column', columnId: 'c1'},
	]);
	assert.ok(taken.ok);
	assert.deepEqual(payloadBody({links, columns: [], sessions: []}), {
		v: 1,
		links,
	});
	assert.equal(payloadBody(taken.sent).v, 2);
	const pair = await createInboxKeyPair();
	const entry = await sealForInbox(pair.publicKey, 'e1', taken.sent);
	const text = JSON.stringify(entry);
	assert.equal(text.includes('Work'), false);
	assert.equal(text.includes('one.example'), false);
	const opened = await openInboxEntry(pair, 'e1', entry);
	assert.ok(opened);
	assert.equal(sentLinkCount(opened), 2);
	assert.equal(opened.columns[0].name, 'Work');
	assert.equal(opened.columns[0].color, '#336699');
	assert.equal(
		await openInboxEntry(await createInboxKeyPair(), 'e1', entry),
		undefined,
	);
});

test('a column or session of 1,000 links is one send, and more than the limit is refused', () => {
	const big = normalizeStore({
		bookmarkColumns: [{id: 'c1', name: 'Big'}],
		bookmarks: Array.from({length: 1000}, (_, index) => ({
			id: `b${index}`,
			title: `Link ${index}`,
			url: `https://link-${index}.example/`,
			columnId: 'c1',
		})),
		groups: [
			{
				id: 's1',
				name: 'Big session',
				tabs: Array.from({length: 1000}, (_, index) => ({
					id: `t${index}`,
					title: `Tab ${index}`,
					url: `https://tab-${index}.example/`,
				})),
			},
		],
	});
	const column = takeOutForPrivate(big, [{kind: 'column', columnId: 'c1'}]);
	assert.ok(column.ok);
	assert.equal(column.count, 1000);
	assert.equal(column.sent.columns.length, 1);
	const session = takeOutForPrivate(big, [{kind: 'session', sessionId: 's1'}]);
	assert.ok(session.ok);
	assert.equal(session.count, 1000);
	assert.equal(addSent(normalizeStore(null), column.sent).added, 1000);
	assert.equal(addSent(normalizeStore(null), session.sent).added, 1000);

	const over = normalizeStore({
		bookmarkColumns: [{id: 'c1', name: 'Huge'}],
		bookmarks: Array.from({length: MAX_SENT_PAYLOAD_LINKS + 1}, (_, index) => ({
			id: `b${index}`,
			title: 'x',
			url: `https://link-${index}.example/`,
			columnId: 'c1',
		})),
	});
	assert.equal(
		takeOutForPrivate(over, [{kind: 'column', columnId: 'c1'}]).ok,
		false,
	);
});
