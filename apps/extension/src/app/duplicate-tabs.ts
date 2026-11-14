import {webUrl} from './web-url';

/**
What Undo needs to put a closed duplicate back where it was.
*/
export type ClosedTab = {
	url: string;
	windowId: number;
	index: number;
	groupId?: number;
};

type DuplicateTab = ClosedTab & {id: number};

/**
Tabs that can be closed because another copy of the same address stays open. Duplicates are exact matches of the canonical web address (a different query or fragment is a different page), across every normal window. Pinned tabs and the tab being viewed in each window are never closed; when a group has one, every unprotected copy goes. Otherwise the most recently used copy stays.
*/
export function findDuplicateTabs(tabs: readonly chrome.tabs.Tab[]) {
	const byUrl = new Map<string, chrome.tabs.Tab[]>();
	for (const tab of tabs) {
		const url = webUrl(tab.url || tab.pendingUrl);
		if (url === null || tab.id === undefined) {
			continue;
		}

		const copies = byUrl.get(url);
		if (copies) {
			copies.push(tab);
		} else {
			byUrl.set(url, [tab]);
		}
	}

	const close: DuplicateTab[] = [];
	for (const [url, copies] of byUrl) {
		if (copies.length < 2) {
			continue;
		}

		const protectedCopy = copies.some((tab) => tab.pinned || tab.active);
		let keep: chrome.tabs.Tab | undefined;
		if (!protectedCopy) {
			keep = copies[0];
			for (const tab of copies) {
				if (isNewer(tab, keep)) {
					keep = tab;
				}
			}
		}

		for (const tab of copies) {
			if (tab.pinned || tab.active || tab === keep) {
				continue;
			}

			close.push({
				id: tab.id!,
				url,
				windowId: tab.windowId,
				index: tab.index,
				...(tab.groupId !== undefined &&
					tab.groupId >= 0 && {groupId: tab.groupId}),
			});
		}
	}

	return {close};
}

function isNewer(a: chrome.tabs.Tab, b: chrome.tabs.Tab) {
	const left = a.lastAccessed ?? 0;
	const right = b.lastAccessed ?? 0;
	return left === right ? (a.id ?? 0) > (b.id ?? 0) : left > right;
}

/**
Closed tabs in the order that restores their positions: window by window, left to right.
*/
export function reopenOrder<T extends ClosedTab>(closed: readonly T[]) {
	return closed.toSorted(
		(a, b) => a.windowId - b.windowId || a.index - b.index,
	);
}
