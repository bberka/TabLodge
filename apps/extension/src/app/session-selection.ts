import type {Session} from '../shared/types';

const NO_SESSIONS: Session[] = [];

export function parseSelectedTabKey(key: string): [string, string] | null {
	try {
		const parsed: unknown = JSON.parse(key);
		if (
			Array.isArray(parsed) &&
			parsed.length === 2 &&
			typeof parsed[0] === 'string' &&
			typeof parsed[1] === 'string'
		) {
			return [parsed[0], parsed[1]];
		}
	} catch {
		return null;
	}

	return null;
}

export function groupSelectedTabs(
	selected: ReadonlySet<string>,
): Map<string, Set<string>> {
	const byGroup = new Map<string, Set<string>>();
	for (const key of selected) {
		const parsed = parseSelectedTabKey(key);
		if (!parsed) {
			continue;
		}

		const [groupId, tabId] = parsed;
		let ids = byGroup.get(groupId);
		if (!ids) {
			ids = new Set();
			byGroup.set(groupId, ids);
		}

		ids.add(tabId);
	}

	return byGroup;
}

export function selectedSessions(
	groups: readonly Session[],
	selectedByGroup: ReadonlyMap<string, ReadonlySet<string>>,
): Session[] {
	if (selectedByGroup.size === 0) {
		return NO_SESSIONS;
	}

	const matched: Session[] = [];
	for (const group of groups) {
		const tabIds = selectedByGroup.get(group.id);
		if (!tabIds || tabIds.size === 0) {
			continue;
		}

		const tabs = group.tabs.filter((tab) => tabIds.has(tab.id));
		if (tabs.length > 0) {
			matched.push({...group, tabs});
		}
	}

	return matched;
}

export function pruneGroupIdSet(
	ids: Set<string>,
	validIds: ReadonlySet<string>,
): Set<string> {
	if (ids.size === 0) {
		return ids;
	}

	let changed = false;
	for (const id of ids) {
		if (!validIds.has(id)) {
			changed = true;
			break;
		}
	}

	if (!changed) {
		return ids;
	}

	const next = new Set<string>();
	for (const id of ids) {
		if (validIds.has(id)) {
			next.add(id);
		}
	}

	return next;
}

export function pruneSelectedTabKeys(
	selected: Set<string>,
	groups: readonly Session[],
): Set<string> {
	if (selected.size === 0) {
		return selected;
	}

	const neededGroupIds = new Set<string>();
	for (const key of selected) {
		const parsed = parseSelectedTabKey(key);
		if (parsed) {
			neededGroupIds.add(parsed[0]);
		}
	}

	const tabsByGroup = new Map<string, Set<string>>();
	for (const group of groups) {
		if (!neededGroupIds.has(group.id)) {
			continue;
		}

		tabsByGroup.set(group.id, new Set(group.tabs.map((tab) => tab.id)));
	}

	let changed = false;
	for (const key of selected) {
		const parsed = parseSelectedTabKey(key);
		if (!parsed || !tabsByGroup.get(parsed[0])?.has(parsed[1])) {
			changed = true;
			break;
		}
	}

	if (!changed) {
		return selected;
	}

	const next = new Set<string>();
	for (const key of selected) {
		const parsed = parseSelectedTabKey(key);
		if (parsed && tabsByGroup.get(parsed[0])?.has(parsed[1])) {
			next.add(key);
		}
	}

	return next;
}
