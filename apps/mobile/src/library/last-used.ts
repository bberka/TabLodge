import {readJson, writeJson} from '../platform/storage';
import {type LastUsed, readLastUsed, type StartTab} from './start-choice';

const KEY = 'tablodge.lastUsed';

let current: LastUsed = {};

export async function loadLastUsed(): Promise<LastUsed> {
	try {
		current = readLastUsed(await readJson(KEY));
	} catch {
		current = {};
	}

	return current;
}

function save(): void {
	void writeJson(KEY, current);
}

export function rememberTab(tab: StartTab): void {
	if (current.tab === tab) {
		return;
	}

	current = {...current, tab};
	save();
}

export function rememberColumn(columnId: string): void {
	if (!columnId || current.columnId === columnId) {
		return;
	}

	current = {...current, columnId};
	save();
}

let startColumn: string | undefined;

export function setStartColumn(columnId: string | undefined): void {
	startColumn = columnId;
}

export function takeStartColumn(): string | undefined {
	const columnId = startColumn;
	startColumn = undefined;
	return columnId;
}
