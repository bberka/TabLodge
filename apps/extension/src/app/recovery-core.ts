import {useCallback, useEffect, useState} from 'react';
import type {ActionSuccess, RestoreResult} from '../shared/types';
import {messageOf, plural, send, type ShowStatus} from './common';
import {sessionRestoreMessage} from './session-restore-message';
import {claimUndo} from './message-client';

export function whenText(time: number): string {
	return new Date(time).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

export function bytesText(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	return bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
		: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RECOVERY_EVENT = 'tablodge:recovery';
export type TrashFilter = 'all' | 'sessions' | 'bookmarks';
export type RecoveryEventDetail = {
	type: 'snapshots' | 'trash';
	filter?: TrashFilter;
};
export function emitRecoveryEvent(detail: RecoveryEventDetail) {
	globalThis.dispatchEvent(new CustomEvent(RECOVERY_EVENT, {detail}));
}

export function useRecoveryEvents(
	onOpen: (
		type: RecoveryEventDetail['type'],
		detail: RecoveryEventDetail,
	) => void,
) {
	useEffect(() => {
		const handler = (event: Event) => {
			const {detail} = event as CustomEvent<RecoveryEventDetail>;
			onOpen(detail.type, detail);
		};

		globalThis.addEventListener(RECOVERY_EVENT, handler);
		return () => globalThis.removeEventListener(RECOVERY_EVENT, handler);
	}, [onOpen]);
}

export async function undoFromTrash(
	trashId: string | undefined,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
	if (!trashId) {
		return;
	}

	const result = await send('RESTORE_TRASH', {id: trashId});
	if (result?.ok) {
		showStatus(`Restored to ${result.placed}.`, false, {toast: true});
		await reload();
	} else {
		showStatus(result?.error || 'Could not undo that.', true);
	}
}

export function reportSessionRestore(
	result: RestoreResult,
	name: string,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
	const {trashId} = result;
	showStatus(
		sessionRestoreMessage(result, name),
		Boolean(result.failed),
		trashId
			? {
					action: {
						label: 'Undo',
						onClick: async () => undoFromTrash(trashId, showStatus, reload),
					},
				}
			: {toast: true},
	);
}

export function offerTrashUndo(
	message: string,
	trashId: string | undefined,
	showStatus: ShowStatus,
	reload: () => unknown,
	undo?: () => Promise<void>,
) {
	showStatus(
		message,
		false,
		trashId
			? {
					action: {
						label: 'Undo',
						onClick: undo ?? (() => undoFromTrash(trashId, showStatus, reload)),
					},
				}
			: {toast: true},
	);
}

export function offerUndo(
	message: string,
	undoId: string | undefined,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
	claimUndo(undoId);
	showStatus(
		message,
		false,
		undoId
			? {
					action: {
						label: 'Undo',
						async onClick() {
							const result = await send('UNDO', {id: undoId});
							if (result?.ok) {
								showStatus(`Undone: ${result.label}.`, false, {toast: true});
								await reload();
							} else {
								showStatus(result?.error || 'Could not undo that.', true);
							}
						},
					},
				}
			: {toast: true},
	);
}

export function offerCloseTabsUndo(
	message: string,
	tabIds: number[],
	showStatus: ShowStatus,
	isError = false,
) {
	showStatus(
		message,
		isError,
		tabIds.length > 0
			? {
					action: {
						label: 'Undo',
						async onClick() {
							try {
								await chrome.tabs.remove(tabIds);
							} catch {
								await Promise.all(
									tabIds.map(async (id) =>
										chrome.tabs.remove(id).catch(() => undefined),
									),
								);
							}

							showStatus('Closed the opened tabs.', false, {toast: true});
						},
					},
				}
			: {toast: true},
	);
}

export function reportSnapshotRestore(
	result: ActionSuccess<'RESTORE_SNAPSHOT'>,
	showStatus: ShowStatus,
) {
	offerCloseTabsUndo(
		`Restored ${plural(result.windows, 'window')} · ${plural(result.count, 'tab')}${result.failed ? ` · ${result.failed} failed` : ''}.`,
		result.tabIds,
		showStatus,
		Boolean(result.failed),
	);
}

export async function saveSnapshotAsSession(
	id: string,
	windowIndex: number | undefined,
	showStatus: ShowStatus,
): Promise<boolean> {
	const result = await send('SAVE_SNAPSHOT_AS_SESSION', {id, windowIndex});
	if (result?.ok) {
		showStatus(
			`Saved ${plural(result.count, 'tab')} as ${plural(result.groups, 'session')}.`,
			false,
			{toast: true},
		);
		return true;
	}

	showStatus(result?.error || 'Could not save that snapshot.', true);
	return false;
}

export type SnapshotsData = ActionSuccess<'GET_SNAPSHOTS'>;

export function useSnapshots(active: boolean) {
	const [data, setData] = useState<SnapshotsData | null>(null);
	const [error, setError] = useState('');
	const load = useCallback(async () => {
		try {
			const result = await send('GET_SNAPSHOTS');
			if (result?.ok) {
				setData(result);
				setError('');
			} else {
				setError(result?.error || 'Could not read the snapshots.');
			}
		} catch (reason) {
			setError(messageOf(reason) || 'Could not read the snapshots.');
		}
	}, []);
	useEffect(() => {
		if (active) {
			void load();
		}
	}, [active, load]);
	return {data, error, reload: load};
}
