import type {StartupTab} from '../settings/preference-schema';

export type StartTab = 'bookmarks' | 'sessions';

export type LastUsed = {tab?: StartTab; columnId?: string};

export type StartChoice = {tab: StartTab; columnId?: string};

export function chooseStart(startup: StartupTab, last: LastUsed): StartChoice {
	if (startup !== 'last') {
		return {tab: startup};
	}

	if (last.tab === 'sessions') {
		return {tab: 'sessions'};
	}

	return last.columnId
		? {tab: 'bookmarks', columnId: last.columnId}
		: {tab: 'bookmarks'};
}

export function readLastUsed(value: unknown): LastUsed {
	if (typeof value !== 'object' || value === null) {
		return {};
	}

	const {tab, columnId} = value as Record<string, unknown>;
	const last: LastUsed = {};
	if (tab === 'bookmarks' || tab === 'sessions') {
		last.tab = tab;
	}

	if (typeof columnId === 'string' && columnId) {
		last.columnId = columnId;
	}

	return last;
}
