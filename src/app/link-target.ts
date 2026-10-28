import type {BookmarkClickAction, Settings} from './types';
import {stripTrackingParameters} from './tracking-parameters';

export type {LinkClickAction} from './types';

type LinkKind = 'bookmark' | 'session';

/**
Decides what a link click does. `requested` is an explicit menu choice and wins over the setting.
A bookmark can resolve to 'menu' (open its action menu); that never navigates, so pages that cannot show the menu must handle or replace it.
`pinnedLodge` is true when this page is the pinned TabLodge tab: there, "current" becomes "new".
*/
export function resolveLinkTarget(
	kind: LinkKind,
	settings: Pick<
		Settings,
		'bookmarkClickAction' | 'sessionLinkClickAction' | 'keepLodgePinned'
	>,
	opts: {requested?: 'current' | 'new'; pinnedLodge?: boolean} = {},
): BookmarkClickAction {
	const action: BookmarkClickAction =
		opts.requested ??
		(kind === 'bookmark'
			? settings.bookmarkClickAction
			: settings.sessionLinkClickAction) ??
		(kind === 'bookmark' ? 'current' : 'new');
	return action === 'current' && settings.keepLodgePinned && opts.pinnedLodge
		? 'new'
		: action;
}

/**
True when this page is the pinned tab and the keep-pinned setting is on.
*/
export async function isPinnedLodgeTab(): Promise<boolean> {
	try {
		const tab = await chrome.tabs.getCurrent();
		return Boolean(tab?.pinned);
	} catch {
		return false;
	}
}

/**
Opens `url` according to the settings (or the explicit `requested` menu choice).
*/
export async function openLink(
	url: string,
	kind: LinkKind,
	settings: Settings,
	requested?: 'current' | 'new',
): Promise<void> {
	const destination = settings.removeTrackingParameters
		? stripTrackingParameters(url)
		: url;
	const pinned = settings.keepLodgePinned ? await isPinnedLodgeTab() : false;
	// Places that cannot show a bookmark menu (the search palette) open the link like the default setting.
	const resolved = resolveLinkTarget(kind, settings, {
		requested,
		pinnedLodge: pinned,
	});
	const action =
		resolved === 'menu'
			? resolveLinkTarget(
					kind,
					{...settings, bookmarkClickAction: 'current'},
					{pinnedLodge: pinned},
				)
			: resolved;
	if (action === 'none') {
		return;
	}

	if (action === 'new') {
		await chrome.tabs.create({url: destination});
		return;
	}

	globalThis.location.assign(destination);
}

/**
Opens one of the extension's own pages (Settings, Help). It replaces this tab, except when this is the pinned TabLodge tab, which must stay put: there it opens in a new tab.
*/
export async function openOwnPage(
	path: string,
	settings: Partial<Pick<Settings, 'keepLodgePinned'>>,
): Promise<void> {
	if (settings.keepLodgePinned && (await isPinnedLodgeTab())) {
		await chrome.tabs.create({url: chrome.runtime.getURL(path)});
		return;
	}

	globalThis.location.assign(path);
}
