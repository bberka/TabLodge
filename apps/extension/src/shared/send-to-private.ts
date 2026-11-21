import {tagFields} from './bookmark-tags';
import {bookmarkNotes, makeId, normalizeUrl} from './library-normalize';
import {isRecord} from './library-values';
import type {Bookmark, BookmarkColumn, SavedTab, Store} from './types';

export const SENT_COLUMN_ID = 'sent-from-regular-windows';
export const SENT_COLUMN_NAME = 'Sent from regular windows';
export const SEND_TO_PRIVATE_LABEL = 'Send to private storage';
export const MAX_SENT_LINKS = 500;
const MAX_TITLE = 500;

export type SentLink = Pick<
	Bookmark,
	'title' | 'url' | 'notes' | 'tags' | 'hiddenKinds' | 'createdAt'
>;

export type SendTarget =
	| {kind: 'bookmark'; bookmarkId: string}
	| {kind: 'tab'; sessionId: string; tabId: string};

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

	return targets;
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

export function takeOutForPrivate(
	store: Store,
	targets: SendTarget[],
): {ok: true; store: Store; links: SentLink[]} | {ok: false; error: string} {
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
		links,
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

	return value.slice(0, MAX_SENT_LINKS).flatMap((raw): SentLink[] => {
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
