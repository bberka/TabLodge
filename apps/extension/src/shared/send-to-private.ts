import {tagFields} from './bookmark-tags';
import {cleanColumnName} from './bookmark-rules';
import {
	bookmarkNotes,
	cleanText,
	colorField,
	DEFAULT_FOLDER_ID,
	iconField,
	makeId,
	normalizeGroup,
	normalizeUrl,
} from './library-normalize';
import {isRecord} from './library-values';
import {sourceColumnSite} from './source-columns';
import type {Bookmark, BookmarkColumn, SavedTab, Session, Store} from './types';

export const SENT_COLUMN_ID = 'sent-from-regular-windows';
export const SENT_COLUMN_NAME = 'Sent from regular windows';
export const SEND_TO_PRIVATE_LABEL = 'Send to private storage';
export const MAX_SENT_LINKS = 500;
export const MAX_SENT_PAYLOAD_LINKS = 20_000;
const MAX_TITLE = 500;
const MAX_SENT_NAME = 120;

export type SentLink = Pick<
	Bookmark,
	'title' | 'url' | 'notes' | 'tags' | 'hiddenKinds' | 'createdAt'
>;

export type SentColumn = {
	name: string;
	icon?: string;
	color?: string;
	links: SentLink[];
};

export type SentSession = {
	name: string;
	description?: string;
	color?: string;
	createdAt: number;
	updatedAt: number;
	links: SentLink[];
};

export type SentPayload = {
	links: SentLink[];
	columns: SentColumn[];
	sessions: SentSession[];
};

export type SendTarget =
	| {kind: 'bookmark'; bookmarkId: string}
	| {kind: 'tab'; sessionId: string; tabId: string}
	| {kind: 'column'; columnId: string}
	| {kind: 'session'; sessionId: string};

export const emptyPayload = (): SentPayload => ({
	links: [],
	columns: [],
	sessions: [],
});

export const sentLinkCount = (payload: SentPayload): number =>
	payload.links.length +
	payload.columns.reduce((sum, column) => sum + column.links.length, 0) +
	payload.sessions.reduce((sum, session) => sum + session.links.length, 0);

export const sentMessage = (
	count: number,
	keptColumn?: string,
	end = '.',
): string =>
	`${count} ${count === 1 ? 'link' : 'links'} sent to private storage${
		keptColumn
			? `. The column “${keptColumn}” stays here, empty, with its source on${end}`
			: end
	}`;

export function parseSendTargets(value: unknown): SendTarget[] | undefined {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_SENT_LINKS
	) {
		return undefined;
	}

	const targets: SendTarget[] = [];
	for (const raw of value) {
		if (
			isRecord(raw) &&
			raw.kind === 'column' &&
			typeof raw.columnId === 'string'
		) {
			targets.push({kind: 'column', columnId: raw.columnId});
		} else if (
			isRecord(raw) &&
			raw.kind === 'session' &&
			typeof raw.sessionId === 'string'
		) {
			targets.push({kind: 'session', sessionId: raw.sessionId});
		} else if (
			isRecord(raw) &&
			raw.kind === 'bookmark' &&
			typeof raw.bookmarkId === 'string'
		) {
			targets.push({kind: 'bookmark', bookmarkId: raw.bookmarkId});
		} else if (
			isRecord(raw) &&
			raw.kind === 'tab' &&
			typeof raw.sessionId === 'string' &&
			typeof raw.tabId === 'string'
		) {
			targets.push({kind: 'tab', sessionId: raw.sessionId, tabId: raw.tabId});
		} else {
			return undefined;
		}
	}

	return targets.length > 1 &&
		targets.some(
			(target) => target.kind === 'column' || target.kind === 'session',
		)
		? undefined
		: targets;
}

const sentFromBookmark = (bookmark: Bookmark): SentLink => ({
	title: bookmark.title,
	url: bookmark.url,
	...(bookmark.notes && {notes: bookmark.notes}),
	...(bookmark.tags && {tags: bookmark.tags}),
	...(bookmark.hiddenKinds && {hiddenKinds: bookmark.hiddenKinds}),
	createdAt: bookmark.createdAt,
});

const sentFromTab = (tab: SavedTab): SentLink => ({
	title: tab.title,
	url: tab.url,
	...(tab.notes && {notes: tab.notes}),
	createdAt: tab.savedAt,
});

export type TakenOut =
	| {
			ok: true;
			store: Store;
			sent: SentPayload;
			count: number;
			keptColumn?: string;
	  }
	| {ok: false; error: string};

export type TakeOutOptions = {keepColumnIds?: ReadonlySet<string>};

const keepsAfterSend = (columnId: string, options: TakeOutOptions) =>
	sourceColumnSite(columnId) !== undefined ||
	Boolean(options.keepColumnIds?.has(columnId));

function takeOutColumn(
	store: Store,
	columnId: string,
	options: TakeOutOptions,
): TakenOut {
	const column = store.bookmarkColumns.find((entry) => entry.id === columnId);
	if (!column) {
		return {ok: false, error: 'That column no longer exists.'};
	}

	const bookmarks = store.bookmarks.filter(
		(bookmark) => bookmark.columnId === columnId,
	);
	if (bookmarks.length === 0) {
		return {ok: false, error: `“${column.name}” has no bookmarks to send.`};
	}

	if (bookmarks.length > MAX_SENT_PAYLOAD_LINKS) {
		return {
			ok: false,
			error: `Send at most ${MAX_SENT_PAYLOAD_LINKS} links at a time.`,
		};
	}

	const keep = keepsAfterSend(columnId, options);
	return {
		ok: true,
		count: bookmarks.length,
		...(keep && {keptColumn: column.name}),
		sent: {
			links: [],
			sessions: [],
			columns: [
				{
					name: column.name,
					...(column.icon && {icon: column.icon}),
					...(column.color && {color: column.color}),
					links: bookmarks.map((bookmark) => sentFromBookmark(bookmark)),
				},
			],
		},
		store: {
			...store,
			bookmarkColumns: keep
				? store.bookmarkColumns
				: store.bookmarkColumns.filter((entry) => entry.id !== columnId),
			bookmarks: store.bookmarks.filter(
				(bookmark) => bookmark.columnId !== columnId,
			),
			updatedAt: Date.now(),
		},
	};
}

function takeOutSession(store: Store, sessionId: string): TakenOut {
	const session = store.groups.find((group) => group.id === sessionId);
	if (!session) {
		return {ok: false, error: 'That session no longer exists.'};
	}

	if (session.tabs.length === 0) {
		return {ok: false, error: `“${session.name}” has no links to send.`};
	}

	if (session.tabs.length > MAX_SENT_PAYLOAD_LINKS) {
		return {
			ok: false,
			error: `Send at most ${MAX_SENT_PAYLOAD_LINKS} links at a time.`,
		};
	}

	return {
		ok: true,
		count: session.tabs.length,
		sent: {
			links: [],
			columns: [],
			sessions: [
				{
					name: session.name,
					...(session.description && {description: session.description}),
					...(session.color && {color: session.color}),
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					links: session.tabs.map((tab) => sentFromTab(tab)),
				},
			],
		},
		store: {
			...store,
			groups: store.groups.filter((group) => group.id !== sessionId),
			updatedAt: Date.now(),
		},
	};
}

export function takeOutForPrivate(
	store: Store,
	targets: SendTarget[],
	options: TakeOutOptions = {},
): TakenOut {
	const whole = targets[0];
	if (whole?.kind === 'column' || whole?.kind === 'session') {
		return targets.length === 1
			? whole.kind === 'column'
				? takeOutColumn(store, whole.columnId, options)
				: takeOutSession(store, whole.sessionId)
			: {ok: false, error: 'Send one column or session at a time.'};
	}

	if (targets.length > MAX_SENT_LINKS) {
		return {
			ok: false,
			error: `Send at most ${MAX_SENT_LINKS} links at a time.`,
		};
	}

	const bookmarks = new Map(store.bookmarks.map((entry) => [entry.id, entry]));
	const links: SentLink[] = [];
	const bookmarkIds = new Set<string>();
	const tabIds = new Map<string, Set<string>>();
	for (const target of targets) {
		if (target.kind === 'column' || target.kind === 'session') {
			return {ok: false, error: 'Send one column or session at a time.'};
		}

		if (target.kind === 'bookmark') {
			const bookmark = bookmarks.get(target.bookmarkId);
			if (!bookmark || bookmarkIds.has(bookmark.id)) {
				return {ok: false, error: 'That bookmark no longer exists.'};
			}

			bookmarkIds.add(bookmark.id);
			links.push(sentFromBookmark(bookmark));
			continue;
		}

		const session = store.groups.find((group) => group.id === target.sessionId);
		const tab = session?.tabs.find((entry) => entry.id === target.tabId);
		const taken = tabIds.get(target.sessionId) ?? new Set<string>();
		if (!tab || taken.has(tab.id)) {
			return {ok: false, error: 'That saved link no longer exists.'};
		}

		taken.add(tab.id);
		tabIds.set(target.sessionId, taken);
		links.push(sentFromTab(tab));
	}

	const now = Date.now();
	const groups = store.groups.flatMap((group) => {
		const taken = tabIds.get(group.id);
		if (!taken) {
			return [group];
		}

		const tabs = group.tabs.filter((tab) => !taken.has(tab.id));
		return tabs.length > 0 ? [{...group, tabs, updatedAt: now}] : [];
	});
	return {
		ok: true,
		count: links.length,
		sent: {links, columns: [], sessions: []},
		store: {
			...store,
			groups,
			bookmarks: store.bookmarks.filter(
				(bookmark) => !bookmarkIds.has(bookmark.id),
			),
			updatedAt: now,
		},
	};
}

export function parseSentLinks(value: unknown): SentLink[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.slice(0, MAX_SENT_PAYLOAD_LINKS).flatMap((raw): SentLink[] => {
		if (!isRecord(raw)) {
			return [];
		}

		const url = normalizeUrl(raw.url);
		if (!url) {
			return [];
		}

		const notes = bookmarkNotes(raw.notes);
		const createdAt = Number(raw.createdAt);
		return [
			{
				title:
					typeof raw.title === 'string' ? raw.title.slice(0, MAX_TITLE) : '',
				url,
				...(notes && {notes}),
				...tagFields(raw),
				createdAt:
					Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
			},
		];
	});
}

const positive = (value: unknown, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
};

export function parseSentPayload(value: unknown): SentPayload {
	if (!isRecord(value)) {
		return emptyPayload();
	}

	const columns = (Array.isArray(value.columns) ? value.columns : []).flatMap(
		(raw): SentColumn[] => {
			if (!isRecord(raw)) {
				return [];
			}

			const links = parseSentLinks(raw.links);
			const name = cleanColumnName(raw.name);
			return links.length > 0
				? [
						{
							name: name || 'Sent column',
							...iconField(raw.icon),
							...colorField(raw.color),
							links,
						},
					]
				: [];
		},
	);
	const sessions = (
		Array.isArray(value.sessions) ? value.sessions : []
	).flatMap((raw): SentSession[] => {
		if (!isRecord(raw)) {
			return [];
		}

		const links = parseSentLinks(raw.links);
		const createdAt = positive(raw.createdAt, Date.now());
		return links.length > 0
			? [
					{
						name: cleanText(raw.name, 'Saved session', MAX_SENT_NAME),
						...(typeof raw.description === 'string' &&
							raw.description && {description: raw.description}),
						...colorField(raw.color),
						createdAt,
						updatedAt: positive(raw.updatedAt, createdAt),
						links,
					},
				]
			: [];
	});
	return {links: parseSentLinks(value.links), columns, sessions};
}

const sentColumn = (now: number): BookmarkColumn => ({
	id: SENT_COLUMN_ID,
	name: SENT_COLUMN_NAME,
	createdAt: now,
	isDefault: false,
});

const sameLinkKey = (link: Omit<SentLink, 'createdAt'>) =>
	JSON.stringify([
		normalizeUrl(link.url) ?? link.url,
		link.title,
		link.notes ?? '',
		link.tags ?? [],
	]);

export function addSentLinks(
	store: Store,
	links: SentLink[],
): {store: Store; added: number} {
	const now = Date.now();

	const seen = new Set(
		store.bookmarks
			.filter((bookmark) => bookmark.columnId === SENT_COLUMN_ID)
			.map((bookmark) => sameLinkKey(bookmark)),
	);
	const added: Bookmark[] = [];
	for (const link of links) {
		const key = sameLinkKey(link);
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		added.push({
			id: makeId(),
			title: link.title,
			url: link.url,
			columnId: SENT_COLUMN_ID,
			...(link.notes && {notes: link.notes}),
			...(link.tags && {tags: link.tags}),
			...(link.hiddenKinds && {hiddenKinds: link.hiddenKinds}),
			createdAt: link.createdAt,
			updatedAt: now,
		});
	}

	if (added.length === 0) {
		return {store, added: 0};
	}

	return {
		added: added.length,
		store: {
			...store,
			bookmarkColumns: store.bookmarkColumns.some(
				(column) => column.id === SENT_COLUMN_ID,
			)
				? store.bookmarkColumns
				: [...store.bookmarkColumns, sentColumn(now)],
			bookmarks: [...added, ...store.bookmarks],
			updatedAt: now,
		},
	};
}

const bookmarkFromLink = (
	link: SentLink,
	columnId: string,
	now: number,
): Bookmark => ({
	id: makeId(),
	title: link.title,
	url: link.url,
	columnId,
	...(link.notes && {notes: link.notes}),
	...(link.tags && {tags: link.tags}),
	...(link.hiddenKinds && {hiddenKinds: link.hiddenKinds}),
	createdAt: link.createdAt,
	updatedAt: now,
});

function addSentColumn(
	store: Store,
	sent: SentColumn,
	now: number,
): {store: Store; added: number} {
	const wanted = sent.name.toLocaleLowerCase();
	const existing = store.bookmarkColumns.find(
		(column) => column.name.toLocaleLowerCase() === wanted,
	);
	const column: BookmarkColumn = existing ?? {
		id: makeId(),
		name: sent.name,
		...(sent.icon && {icon: sent.icon}),
		...(sent.color && {color: sent.color}),
		createdAt: now,
		isDefault: false,
	};
	const seen = new Set(
		store.bookmarks
			.filter((bookmark) => bookmark.columnId === column.id)
			.map((bookmark) => sameLinkKey(bookmark)),
	);
	const added: Bookmark[] = [];
	for (const link of sent.links) {
		const key = sameLinkKey(link);
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		added.push(bookmarkFromLink(link, column.id, now));
	}

	if (existing && added.length === 0) {
		return {store, added: 0};
	}

	return {
		added: added.length,
		store: {
			...store,
			bookmarkColumns: existing
				? store.bookmarkColumns
				: [...store.bookmarkColumns, column],
			bookmarks: [...store.bookmarks, ...added],
			updatedAt: now,
		},
	};
}

const sameSessionExists = (groups: Session[], session: Session) =>
	groups.some(
		(group) =>
			group.createdAt === session.createdAt &&
			group.name === session.name &&
			group.tabs.length === session.tabs.length &&
			group.tabs.every((tab, index) => tab.url === session.tabs[index].url),
	);

function addSentSession(store: Store, sent: SentSession): Store {
	const folderId =
		store.folders.find((folder) => folder.isDefault)?.id ?? DEFAULT_FOLDER_ID;
	const session = normalizeGroup(
		{
			id: makeId(),
			name: sent.name,
			folderId,
			description: sent.description ?? '',
			...(sent.color && {color: sent.color}),
			createdAt: sent.createdAt,
			updatedAt: sent.updatedAt,
			tabs: sent.links.map((link, index) => ({
				id: makeId(),
				title: link.title,
				url: link.url,
				notes: link.notes ?? '',
				savedAt: link.createdAt,
				originalIndex: index,
			})),
		},
		sent.createdAt,
	);
	if (!session || sameSessionExists(store.groups, session)) {
		return store;
	}

	return {
		...store,
		groups: [session, ...store.groups],
		updatedAt: Date.now(),
	};
}

export function addSent(
	store: Store,
	sent: SentPayload,
): {store: Store; added: number} {
	let next = store;
	let added = 0;
	const now = Date.now();
	if (sent.links.length > 0) {
		const merged = addSentLinks(next, sent.links);
		next = merged.store;
		added += merged.added;
	}

	for (const column of sent.columns) {
		const merged = addSentColumn(next, column, now);
		next = merged.store;
		added += merged.added;
	}

	for (const session of sent.sessions) {
		const before = next;
		next = addSentSession(next, session);
		if (next !== before) {
			added += session.links.length;
		}
	}

	return {store: next, added};
}
