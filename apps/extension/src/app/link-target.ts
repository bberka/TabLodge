import {isFirefox} from '../shared/browser';
import {webUrl} from '../shared/web-url';
import type {BookmarkClickAction, Settings} from '../shared/types';
import {stripTrackingParameters} from '../shared/tracking-parameters';

export type {LinkClickAction} from '../shared/types';

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
Whether the browser can open a private window for a link. Firefox builds set `incognito: 'not_allowed'`, so
there it is never offered.
*/
export const canOpenPrivateWindow = !isFirefox;

/**
Opens `url` in a new private window. The browser can refuse (private windows turned off by policy); that
rejection reaches the caller so it can tell the user.
*/
export async function openInPrivateWindow(
	url: string,
	settings: Pick<Settings, 'removeTrackingParameters'>,
): Promise<void> {
	const safe = webUrl(url);
	if (!safe) {
		throw new Error('This item does not contain a valid web address.');
	}

	await chrome.windows.create({
		url: settings.removeTrackingParameters
			? stripTrackingParameters(safe)
			: safe,
		incognito: true,
		focused: true,
	});
}

/**
The message for a refused private window.
*/
export function privateWindowFailure(reason: unknown): string {
	return reason instanceof Error && reason.message
		? `Could not open a private window: ${reason.message}`
		: 'Could not open a private window.';
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
Opens `url` according to the settings (or the explicit `requested` menu choice). From the palette window
(`where`), "current" means the active tab of that window, which comes to the front.
*/
export async function openLink(
	url: string,
	kind: LinkKind,
	settings: Settings,
	requested?: 'current' | 'new',
	where?: {windowId?: number},
): Promise<void> {
	const destination = settings.removeTrackingParameters
		? stripTrackingParameters(url)
		: url;
	const target = where ? await activeTabOf(where.windowId) : undefined;
	const pinned = where
		? Boolean(
				settings.keepLodgePinned &&
				target?.pinned &&
				target.url?.startsWith(chrome.runtime.getURL('')),
			)
		: settings.keepLodgePinned
			? await isPinnedLodgeTab()
			: false;
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

	if (where) {
		if (action === 'current' && target?.id !== undefined) {
			await chrome.tabs.update(target.id, {url: destination, active: true});
		} else {
			await chrome.tabs.create({url: destination, windowId: where.windowId});
		}

		if (where.windowId !== undefined) {
			await chrome.windows.update(where.windowId, {focused: true});
		}

		return;
	}

	if (action === 'new') {
		await chrome.tabs.create({url: destination});
		return;
	}

	globalThis.location.assign(destination);
}

async function activeTabOf(windowId: number | undefined) {
	if (windowId === undefined) {
		return undefined;
	}

	try {
		return (await chrome.tabs.query({active: true, windowId}))[0];
	} catch {
		return undefined;
	}
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
