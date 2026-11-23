import type {RestoreResult} from '../shared/types';

export function restoreFailureText(failure?: {
	title?: string;
	url?: string;
	error?: string;
}) {
	return failure ? `${failure.title || failure.url}: ${failure.error}` : '';
}

function restoreSummary(result: {
	count: number;
	skipped?: number;
	failed?: number;
	failures?: Array<{title?: string; url?: string; error?: string}>;
	splitsSeparated?: number;
}) {
	const parts = [
		`Restored ${result.count} ${result.count === 1 ? 'tab' : 'tabs'}`,
	];
	if (result.skipped) {
		parts.push(
			`skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`,
		);
	}

	if (result.failed) {
		parts.push(`${result.failed} failed`);
		const reason = restoreFailureText(result.failures?.[0]);
		if (reason) {
			parts.push(reason);
		}
	}

	if (result.splitsSeparated) {
		parts.push(splitNote(result.splitsSeparated));
	}

	return `${parts.join(' · ')}.`;
}

export const splitNote = (count: number) =>
	`${count} split ${count === 1 ? 'view' : 'views'} opened as separate tabs`;

export function sessionRestoreMessage(result: RestoreResult, name: string) {
	const summary =
		result.failed || result.skipped || result.splitsSeparated
			? restoreSummary(result)
			: `Restored “${name}”.`;
	return result.removed ? `${summary} Removed it from your sessions.` : summary;
}

export function paletteUndoToast(
	result: RestoreResult,
	name: string,
	tabId: number | undefined,
) {
	return result.trashId === undefined || tabId === undefined
		? undefined
		: {
				tabId,
				message: sessionRestoreMessage(result, name),
				trashId: result.trashId,
			};
}
