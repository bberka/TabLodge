import {shareHtmlPage, type ShareGroup} from './share-formats';
import type {SyncConfig, SyncHost} from './sync/client';
import {
	listSharedPages,
	sharedPageUrl,
	updateSharedPage,
} from './sync/shared-pages-client';
import type {Store} from './types';

export type LivePagePayload = {
	title: string;
	html: string;
	fingerprint: string;
};

export function parseLivePageSource(
	source: string,
): {kind: 'column' | 'session'; id: string} | undefined {
	if (source.startsWith('column:')) {
		const id = source.slice('column:'.length);
		return id ? {kind: 'column', id} : undefined;
	}

	if (source.startsWith('session:')) {
		const id = source.slice('session:'.length);
		return id ? {kind: 'session', id} : undefined;
	}

	return undefined;
}

export function buildLivePagePayload(
	store: Pick<Store, 'bookmarkColumns' | 'bookmarks' | 'groups'>,
	source: string,
	appName: string,
	serverUrl: string,
	pageId: string,
	now: number,
): LivePagePayload | undefined {
	const parsed = parseLivePageSource(source);
	if (!parsed) {
		return undefined;
	}

	let title: string;
	let group: ShareGroup;
	let pageKind: 'bookmarks' | 'sessions';
	if (parsed.kind === 'column') {
		const column = store.bookmarkColumns.find(
			(entry) => entry.id === parsed.id,
		);
		if (!column) {
			return undefined;
		}

		title = column.name;
		pageKind = 'bookmarks';
		group = {
			name: column.name,
			tabs: store.bookmarks
				.filter((bookmark) => bookmark.columnId === column.id)
				.map((bookmark) => ({title: bookmark.title, url: bookmark.url})),
		};
	} else {
		const session = store.groups.find((entry) => entry.id === parsed.id);
		if (!session) {
			return undefined;
		}

		title = session.name;
		pageKind = 'sessions';
		group = {
			name: session.name,
			description: session.description,
			createdAt: session.createdAt,
			tabs: session.tabs.map((tab) => ({
				title: tab.title,
				url: tab.url,
				pinned: tab.pinned,
				nativeGroup: tab.nativeGroup,
			})),
		};
	}

	const url = sharedPageUrl(serverUrl, pageId);
	const fingerprint = JSON.stringify({title, pageKind, group});
	const html = shareHtmlPage(title, [group], appName, {
		kind: pageKind,
		sharedAt: now,
		url,
	});
	return {title, html, fingerprint};
}

export async function refreshLiveSharedPages(
	send: SyncHost['fetch'],
	target: SyncConfig,
	store: Pick<Store, 'bookmarkColumns' | 'bookmarks' | 'groups'>,
	appName: string,
	fingerprints: Map<string, string>,
	now: () => number = Date.now,
): Promise<number> {
	const pages = await listSharedPages(send, target);
	const livePages = pages.filter(
		(page) => page.mode === 'live' && page.source !== '',
	);
	const liveIds = new Set(livePages.map((page) => page.id));
	for (const id of fingerprints.keys()) {
		if (!liveIds.has(id)) {
			fingerprints.delete(id);
		}
	}

	let updated = 0;
	for (const page of livePages) {
		const payload = buildLivePagePayload(
			store,
			page.source,
			appName,
			target.url,
			page.id,
			now(),
		);
		if (!payload || fingerprints.get(page.id) === payload.fingerprint) {
			continue;
		}

		try {
			await updateSharedPage(
				send,
				target,
				page.id,
				payload.title,
				payload.html,
			);
			fingerprints.set(page.id, payload.fingerprint);
			updated += 1;
		} catch {}
	}

	return updated;
}
