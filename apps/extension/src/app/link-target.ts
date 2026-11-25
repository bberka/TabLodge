import {isFirefox} from '../shared/browser';
import {webUrl} from '../shared/web-url';
import type {BookmarkClickAction, Settings} from '../shared/types';
import {stripTrackingParameters} from '../shared/tracking-parameters';

export type {LinkClickAction} from '../shared/types';

type LinkKind = 'bookmark' | 'session';

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

export function linkDestination(
	url: string,
	settings: Partial<Pick<Settings, 'removeTrackingParameters'>>,
): string {
	return settings.removeTrackingParameters ? stripTrackingParameters(url) : url;
}

export const canOpenPrivateWindow = !isFirefox;

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

export function privateWindowFailure(reason: unknown): string {
	return reason instanceof Error && reason.message
		? `Could not open a private window: ${reason.message}`
		: 'Could not open a private window.';
}

export async function isPinnedLodgeTab(): Promise<boolean> {
	try {
		const tab = await chrome.tabs.getCurrent();
		return Boolean(tab?.pinned);
	} catch {
		return false;
	}
}

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
