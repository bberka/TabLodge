const LOADED_TAB_MB = 100;
const DISCARDED_TAB_MB = 5;

export type SavedStats = {sessions: number; tabs: number; largest: number};

export function savedStats(
	sessions: ReadonlyArray<{tabs: readonly unknown[]}>,
): SavedStats {
	let tabs = 0;
	let largest = 0;
	for (const session of sessions) {
		tabs += session.tabs.length;
		largest = Math.max(largest, session.tabs.length);
	}

	return {sessions: sessions.length, tabs, largest};
}

type OpenTab = {
	id?: number;
	active?: boolean;
	lastAccessed?: number;
};

export function leastRecentlyUsedTabs<T extends OpenTab>(
	tabs: readonly T[],
	limit: number,
): T[] {
	return tabs
		.filter((tab) => tab.lastAccessed !== undefined && !tab.active)
		.toSorted((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0))
		.slice(0, limit);
}

export function estimateTabMemoryMb(total: number, discarded: number): number {
	return (total - discarded) * LOADED_TAB_MB + discarded * DISCARDED_TAB_MB;
}

export function memoryEstimateText(megabytes: number): string {
	if (megabytes <= 0) {
		return '0 MB';
	}

	return megabytes >= 1000
		? `about ${(megabytes / 1000).toFixed(1)} GB`
		: `about ${Math.round(megabytes / 100) * 100 || 100} MB`;
}

export function idleText(now: number, then: number): string {
	const minutes = Math.floor(Math.max(0, now - then) / 60_000);
	const unit = (count: number, name: string) =>
		`${count} ${name}${count === 1 ? '' : 's'} ago`;
	if (minutes < 60) {
		return minutes < 1 ? 'just now' : unit(minutes, 'minute');
	}

	const hours = Math.floor(minutes / 60);
	return hours < 24 ? unit(hours, 'hour') : unit(Math.floor(hours / 24), 'day');
}
