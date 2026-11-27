import type {SiteSourceStatus} from '../shared/types';
import type {SiteSource} from './site-sources';

export const SAVED_PAGES_GROUP_TITLE = 'Saved pages';

export type SavedPagesPlan = {
	openable: SiteSource[];
	skipped: SiteSource[];
};

export function savedPagesPlan(
	sources: readonly SiteSource[],
	statuses: readonly SiteSourceStatus[] | undefined,
): SavedPagesPlan {
	if (!statuses) {
		return {openable: [], skipped: []};
	}

	const enabled = new Set(
		statuses.filter((entry) => entry.enabled).map((entry) => entry.id),
	);
	const openable: SiteSource[] = [];
	const skipped: SiteSource[] = [];
	for (const source of sources) {
		if (!enabled.has(source.id)) {
			continue;
		}

		if (source.savedPageUrl) {
			openable.push(source);
		} else if (source.savedPageNeedsUsername) {
			skipped.push(source);
		}
	}

	return {openable, skipped};
}

export function formatSourceList(sources: readonly SiteSource[]): string {
	const labels = sources.map((source) => source.label);
	if (labels.length <= 1) {
		return labels.join('');
	}

	return labels.length === 2
		? `${labels[0]} and ${labels[1]}`
		: `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

export function skippedSourcesHint(skipped: readonly SiteSource[]): string {
	return `Skips ${formatSourceList(skipped)} (saved page URL includes your username).`;
}

export function openSavedPagesStatus({
	opened,
	skipped,
	failed,
}: {
	opened: readonly SiteSource[];
	skipped: readonly SiteSource[];
	failed: readonly SiteSource[];
}): {text: string; isError: boolean} {
	const skippedNote =
		skipped.length > 0
			? ` Skipped ${formatSourceList(skipped)} (saved page URL includes your username).`
			: '';
	const failedNote =
		failed.length > 0 ? ` Could not open ${formatSourceList(failed)}.` : '';

	if (opened.length === 0) {
		if (failed.length > 0) {
			return {
				text: `Could not open ${formatSourceList(failed)}.${skippedNote}`,
				isError: true,
			};
		}

		if (skipped.length > 0) {
			return {
				text: `Nothing to open.${skippedNote}`,
				isError: false,
			};
		}

		return {text: 'No saved pages to open.', isError: false};
	}

	const openedText =
		opened.length === 1
			? `Opened ${opened[0].label} in a background tab.`
			: `Opened ${opened.length} saved pages in background tabs.`;
	return {
		text: `${openedText}${skippedNote}${failedNote}`,
		isError: failed.length > 0,
	};
}

export type OpenSavedPagesBrowser = {
	tabs?: Pick<typeof chrome.tabs, 'create'> &
		Partial<Pick<typeof chrome.tabs, 'group'>>;
	tabGroups?: Partial<Pick<typeof chrome.tabGroups, 'update'>>;
	windows?: Partial<Pick<typeof chrome.windows, 'getCurrent'>>;
	permissions?: Partial<Pick<typeof chrome.permissions, 'contains'>>;
};

export type OpenSavedPagesResult = {
	opened: SiteSource[];
	failed: SiteSource[];
	tabIds: number[];
	grouped: boolean;
};

export async function openSavedPageTabs(
	sources: readonly SiteSource[],
	options: {group?: boolean; browser?: OpenSavedPagesBrowser} = {},
): Promise<OpenSavedPagesResult> {
	const browser = options.browser ?? chrome;
	const tabsApi = browser.tabs;
	const candidates = sources.filter(
		(source): source is SiteSource & {savedPageUrl: string} =>
			Boolean(source.savedPageUrl),
	);
	if (!tabsApi || candidates.length === 0) {
		return {opened: [], failed: [], tabIds: [], grouped: false};
	}

	const currentWindow = await Promise.resolve(
		browser.windows?.getCurrent?.(),
	).catch(() => undefined);
	const windowId =
		typeof currentWindow?.id === 'number' ? currentWindow.id : undefined;

	const opened: SiteSource[] = [];
	const failed: SiteSource[] = [];
	const tabIds: number[] = [];

	for (const source of candidates) {
		if (typeof browser.permissions?.contains === 'function') {
			const permitted = await Promise.resolve(
				browser.permissions.contains({origins: source.origins}),
			).catch(() => false);
			if (!permitted) {
				continue;
			}
		}

		try {
			const tab = await tabsApi.create({
				url: source.savedPageUrl,
				active: false,
				...(windowId !== undefined && {windowId}),
			});
			opened.push(source);
			if (typeof tab?.id === 'number') {
				tabIds.push(tab.id);
			}
		} catch {
			failed.push(source);
		}
	}

	let grouped = false;
	if (
		(options.group ?? true) &&
		tabIds.length > 1 &&
		typeof tabsApi.group === 'function'
	) {
		const groupId = await Promise.resolve(
			tabsApi.group({
				tabIds: tabIds as [number, ...number[]],
				...(windowId !== undefined && {createProperties: {windowId}}),
			}),
		).catch(() => undefined);
		if (groupId !== undefined) {
			grouped = true;
			await Promise.resolve(
				browser.tabGroups?.update?.(groupId, {title: SAVED_PAGES_GROUP_TITLE}),
			).catch(() => undefined);
		}
	}

	return {opened, failed, tabIds, grouped};
}
