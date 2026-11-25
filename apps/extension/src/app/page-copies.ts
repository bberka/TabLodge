import {useSyncExternalStore} from 'react';
import {COPY_INDEX_KEY} from '../shared/page-copy';
import type {ActionResult} from '../shared/types';
import {send} from './message-client';
import {PROJECT} from './project';

export function readerUrl(url: string) {
	return chrome.runtime.getURL(
		`reader.html?${new URLSearchParams({url}).toString()}`,
	);
}

export async function openPageCopy(url: string, windowId?: number) {
	await chrome.tabs.create({
		url: readerUrl(url),
		...(windowId !== undefined && {windowId}),
	});
}

let copyUrls: ReadonlySet<string> = new Set();
const copyListeners = new Set<() => void>();
let watching = false;

async function loadCopyUrls() {
	const result = await send('GET_PAGE_COPIES');
	if (!result.ok) {
		return;
	}

	const next = new Set(result.urls);
	if (
		next.size === copyUrls.size &&
		[...next].every((url) => copyUrls.has(url))
	) {
		return;
	}

	copyUrls = next;
	for (const listener of copyListeners) {
		listener();
	}
}

function watchCopyUrls(listener: () => void) {
	copyListeners.add(listener);
	if (!watching && !chrome.extension.inIncognitoContext) {
		watching = true;
		void loadCopyUrls();
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === 'local' && Object.hasOwn(changes, COPY_INDEX_KEY)) {
				void loadCopyUrls();
			}
		});
	}

	return () => {
		copyListeners.delete(listener);
	};
}

export function usePageCopyUrls(): ReadonlySet<string> {
	return useSyncExternalStore(watchCopyUrls, () => copyUrls);
}

export function keptCopyMessage(result: ActionResult<'KEEP_PAGE_COPY'>) {
	if (!result.ok) {
		return result.error || 'Could not keep a copy of this page.';
	}

	return result.bookmarked
		? `Copy kept. The page was not saved, so ${PROJECT.name} bookmarked it.`
		: 'Copy kept.';
}
