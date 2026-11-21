import {isFirefox} from '../shared/browser';
import {webUrl} from '../shared/web-url';
import type {BookmarkClickAction, Settings} from '../shared/types';
import {stripTrackingParameters} from '../shared/tracking-parameters';

export type {LinkClickAction} from '../shared/types';

type LinkKind = 'bookmark' | 'session';

/**
The one rule for what opening a saved link does, shared by the dashboard, the side panel, and the finder.
`requested` is an explicit menu choice and wins over the setting.
`pinnedLodge` is true when this page is the pinned TabLodge tab: there, "current" becomes "new".
A bookmark click can resolve to 'menu' (open its action menu) and any click can resolve to 'none' (do nothing).
A surface that has no menu or no idle click says so with `canMenu: false` or `canIdle: false`: 'menu' then opens
the link in the current tab, and 'none' opens it the way the default setting does (current tab for a bookmark, new
tab for a saved tab). The finder sets both, because Enter on a result must never do nothing.
*/
export function resolveLinkTarget(
	kind: LinkKind,
	settings: Pick<
		Settings,
		'bookmarkClickAction' | 'sessionLinkClickAction' | 'keepLodgePinned'
	>,
	opts: {
		requested?: 'current' | 'new';
		pinnedLodge?: boolean;
		canMenu?: boolean;
		canIdle?: boolean;
	} = {},
): BookmarkClickAction {
	const fallback = kind === 'bookmark' ? 'current' : 'new';
	let action: BookmarkClickAction =
		opts.requested ??
		(kind === 'bookmark'
			? settings.bookmarkClickAction
			: settings.sessionLinkClickAction) ??
		fallback;
	if (action === 'menu' && opts.canMenu === false) {
		action = 'current';
	}

	if (action === 'none' && opts.canIdle === false) {
		action = fallback;
	}

	return action === 'current' && settings.keepLodgePinned && opts.pinnedLodge
		? 'new'
		: action;
}

/**
The address to open or copy a saved link as: tracking parameters removed when the setting is on.
*/
export function linkDestination(
	url: string,
	settings: Partial<Pick<Settings, 'removeTrackingParameters'>>,
): string {
	return settings.removeTrackingParameters ? stripTrackingParameters(url) : url;
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
		url: linkDestination(safe, settings),
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
	idleClick = true,
): Promise<void> {
	const destination = linkDestination(url, settings);
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
	// Nothing here can show a bookmark menu. Only a plain click may do nothing; the finder passes `idleClick: false`.
	const action = resolveLinkTarget(kind, settings, {
		requested,
		pinnedLodge: pinned,
		canMenu: false,
		canIdle: idleClick && where === undefined,
	});
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
