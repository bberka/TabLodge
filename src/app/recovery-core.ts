// Small recovery helpers shared by the pages: formatting, the open-dialog event, and the Undo toasts. The heavy
// dialogs live in recovery.tsx and are loaded only when opened.
import {useCallback, useEffect, useState} from 'react';
import {send, type ShowStatus} from './common';
import type {ActionSuccess} from './types';

export const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;
export const messageOf = (reason: unknown) =>
	(reason as {message?: string} | null | undefined)?.message;

/**
A date and time in the user's locale, such as "Oct 25, 2026, 2:32 PM".
*/
export function whenText(time: number): string {
	return new Date(time).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

/**
A byte count such as "1.4 MB".
*/
export function bytesText(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	return bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
		: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
Window event that asks the page to open the snapshots or trash dialog (sent by menus and palette commands).
*/
export const RECOVERY_EVENT = 'tablodge:recovery';
export type RecoveryEventDetail = {type: 'snapshots' | 'trash'};
export function emitRecoveryEvent(detail: RecoveryEventDetail) {
	globalThis.dispatchEvent(new CustomEvent(RECOVERY_EVENT, {detail}));
}

/**
Opens the dialog a menu or palette command asked for.
*/
export function useRecoveryEvents(
	onOpen: (type: RecoveryEventDetail['type']) => void,
) {
	useEffect(() => {
		const handler = (event: Event) =>
			onOpen((event as CustomEvent<RecoveryEventDetail>).detail.type);
		globalThis.addEventListener(RECOVERY_EVENT, handler);
		return () => globalThis.removeEventListener(RECOVERY_EVENT, handler);
	}, [onOpen]);
}

/**
Undo for a delete: puts the item back from the trash, then lets the page reload its data.
*/
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

/**
A success toast with an Undo button that restores `trashId` from the trash.
*/
export function offerTrashUndo(
	message: string,
	trashId: string | undefined,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
	showStatus(
		message,
		false,
		trashId
			? {
					action: {
						label: 'Undo',
						onClick: () => undoFromTrash(trashId, showStatus, reload),
					},
				}
			: {toast: true},
	);
}

/**
A success toast with an Undo button that runs `UNDO` for an `undoId` from the service worker, then lets the page reload its data.
*/
export function offerUndo(
	message: string,
	undoId: string | undefined,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
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

/**
A success toast with an Undo button that closes the tabs just opened (the ones that still exist).
*/
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
								// Some of them were already closed; close the rest one by one.
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

/**
Reports a snapshot restore with an Undo that closes the tabs it opened.
*/
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
