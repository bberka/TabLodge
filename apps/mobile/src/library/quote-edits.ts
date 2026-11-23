import type {Store} from '../../../extension/src/shared/types';
import type {DeviceStamp} from '../../../extension/src/shared/device';
import {
	appendQuote,
	pageAddress,
	quoteTarget,
} from '../../../extension/src/shared/quotes';
import {addBookmark, removeBookmarks} from './board-edits';
import {extractUrl, hostOf} from './store-shape';

export type QuoteUndo =
	| {kind: 'created'; bookmarkId: string; after: string}
	| {kind: 'bookmark'; bookmarkId: string; before?: string; after: string}
	| {kind: 'tabs'; url: string; before: string; after: string};

export type QuoteSave =
	| {ok: true; store: Store; placed: string; undo: QuoteUndo}
	| {ok: false; error: string};

export function saveQuote(
	store: Store,
	input: {
		url: string;
		quote: string;
		title: string;
		columnId: string;
		device?: DeviceStamp;
	},
	id: string,
	now: number,
): QuoteSave {
	const link = extractUrl(input.url);
	if (!link) {
		return {
			ok: false,
			error: 'Enter a web address that starts with http:// or https://.',
		};
	}

	const url = pageAddress(link);
	const target = quoteTarget(store, url);
	if (target.kind === 'tab') {
		const tab = target.group.tabs.find((entry) => entry.id === target.tabId)!;
		const note = appendQuote(tab.notes, url, input.quote);
		if (!note.ok) {
			return note;
		}

		return {
			ok: true,
			store: setTabNotes(store, tab.url, note.notes, now),
			placed: target.group.name,
			undo: {kind: 'tabs', url: tab.url, before: tab.notes, after: note.notes},
		};
	}

	const existing = target.kind === 'bookmark' ? target.bookmark : undefined;
	const note = appendQuote(existing?.notes, url, input.quote);
	if (!note.ok) {
		return note;
	}

	const next = existing
		? {
				...store,
				bookmarks: store.bookmarks.map((bookmark) =>
					bookmark.id === existing.id
						? {...bookmark, notes: note.notes, updatedAt: now}
						: bookmark,
				),
				updatedAt: now,
			}
		: addBookmark(
				store,
				{
					url,
					title: input.title.trim() || hostOf(url),
					columnId: input.columnId,
					notes: note.notes,
					device: input.device,
				},
				id,
				now,
			);
	const bookmarkId = existing?.id ?? id;
	const columnId = next.bookmarks.find(
		(bookmark) => bookmark.id === bookmarkId,
	)?.columnId;
	return {
		ok: true,
		store: next,
		placed:
			next.bookmarkColumns.find((column) => column.id === columnId)?.name ??
			'Unfiled',
		undo: existing
			? {
					kind: 'bookmark',
					bookmarkId,
					...(existing.notes !== undefined && {before: existing.notes}),
					after: note.notes,
				}
			: {kind: 'created', bookmarkId, after: note.notes},
	};
}

function setTabNotes(store: Store, url: string, notes: string, now: number) {
	return {
		...store,
		groups: store.groups.map((group) =>
			group.tabs.some((tab) => tab.url === url)
				? {
						...group,
						tabs: group.tabs.map((tab) =>
							tab.url === url ? {...tab, notes} : tab,
						),
						updatedAt: now,
					}
				: group,
		),
		updatedAt: now,
	};
}

export function undoQuote(store: Store, undo: QuoteUndo, now: number): Store {
	if (undo.kind === 'created') {
		return store.bookmarks.some(
			(bookmark) =>
				bookmark.id === undo.bookmarkId && bookmark.notes === undo.after,
		)
			? removeBookmarks(store, new Set([undo.bookmarkId]), now)
			: store;
	}

	if (undo.kind === 'tabs') {
		const unchanged = store.groups.some((group) =>
			group.tabs.some(
				(tab) => tab.url === undo.url && tab.notes === undo.after,
			),
		);
		return unchanged ? setTabNotes(store, undo.url, undo.before, now) : store;
	}

	const quoted = (bookmark: Store['bookmarks'][number]) =>
		bookmark.id === undo.bookmarkId && bookmark.notes === undo.after;
	if (store.bookmarks.every((bookmark) => !quoted(bookmark))) {
		return store;
	}

	return {
		...store,
		bookmarks: store.bookmarks.map((bookmark) => {
			if (!quoted(bookmark)) {
				return bookmark;
			}

			const {notes: _quoted, ...rest} = bookmark;
			return {
				...rest,
				...(undo.before !== undefined && {notes: undo.before}),
				updatedAt: now,
			};
		}),
		updatedAt: now,
	};
}
