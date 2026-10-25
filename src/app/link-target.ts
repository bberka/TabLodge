import type {LinkClickAction, Settings} from './types';

export type {LinkClickAction} from './types';

type LinkKind = 'bookmark' | 'session';

/**
Decides what a link click does. `requested` is an explicit menu choice and wins over the setting.
`pinnedLodge` is true when this page is the pinned TabLodge tab: there, "current" becomes "new".
*/
export function resolveLinkTarget(
	kind: LinkKind,
	settings: Pick<
		Settings,
		'bookmarkClickAction' | 'sessionLinkClickAction' | 'keepLodgePinned'
	>,
	opts: {requested?: 'current' | 'new'; pinnedLodge?: boolean} = {},
): LinkClickAction {
	const action: LinkClickAction =
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
	const pinned = settings.keepLodgePinned ? await isPinnedLodgeTab() : false;
	const action = resolveLinkTarget(kind, settings, {
		requested,
		pinnedLodge: pinned,
	});
	if (action === 'none') {
		return;
	}

	if (action === 'new') {
		await chrome.tabs.create({url});
		return;
	}

	globalThis.location.assign(url);
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
