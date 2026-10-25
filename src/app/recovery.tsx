// Recovery UI shared by the dashboard, side panel and Settings: the "restore your last session" banner, the
// recent-snapshots dialog, the trash dialog, and the backup list. Every action is a message to the service
// worker, which keeps all of this data in local extension storage.
import {useCallback, useEffect, useState} from 'react';
import {
	AppWindow,
	ChevronDown,
	ChevronRight,
	Download,
	History,
	LifeBuoy,
	RotateCcw,
	Save,
	Trash2,
	Undo2,
} from 'lucide-react';
import {
	Badge,
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../shared/ui';
import {send, type ShowStatus} from './common';
import {downloadFile} from './data-transfer';
import type {
	ActionSuccess,
	BackupSummary,
	SnapshotReason,
	SnapshotSummary,
	TrashKind,
	TrashSummary,
} from './types';

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;
const messageOf = (reason: unknown) =>
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
function reportSnapshotRestore(
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

const REASON_LABELS: Record<SnapshotReason, string> = {
	interval: 'Regular snapshot',
	startup: 'At startup',
	crash: 'Before an unclean exit',
	exit: 'When the browser was closed',
	manual: 'Saved by you',
};

type SnapshotsData = ActionSuccess<'GET_SNAPSHOTS'>;

function useSnapshots(active: boolean) {
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

/**
"Restore your last browsing session? N windows · M tabs" shown on the dashboard after an unclean exit.
*/
export function RecoveryBanner({
	showStatus,
	onReview,
}: {
	showStatus: ShowStatus;
	onReview: () => void;
}) {
	const {data, reload} = useSnapshots(true);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && 'tablodge.snapshots.meta' in changes) {
				void reload();
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => chrome.storage.onChanged.removeListener(onChanged);
	}, [reload]);
	const recovery = data?.recovery;
	if (!recovery) {
		return null;
	}

	async function restore() {
		if (busy || !recovery) {
			return;
		}

		setBusy(true);
		try {
			const result = await send('RESTORE_SNAPSHOT', {
				id: recovery.snapshotId,
			});
			if (result?.ok) {
				reportSnapshotRestore(result, showStatus);
			} else {
				showStatus(result?.error || 'Could not restore that session.', true);
			}
		} catch (reason) {
			showStatus(messageOf(reason) || 'Could not restore that session.', true);
		}

		setBusy(false);
		await reload();
	}

	async function dismiss() {
		await send('DISMISS_RECOVERY');
		await reload();
	}

	return (
		<section
			aria-label="Session recovery"
			className="mb-6 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/[.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<div className="flex min-w-0 items-start gap-3">
				<span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
					<LifeBuoy className="h-4 w-4" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold">
						Restore your last browsing session?
					</p>
					<p className="text-xs leading-5 text-muted-foreground">
						{plural(recovery.windows, 'window')} ·{' '}
						{plural(recovery.tabs, 'tab')} · {whenText(recovery.at)}. The
						browser seems to have closed unexpectedly.
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button size="sm" disabled={busy} onClick={() => void restore()}>
					<RotateCcw className="h-4 w-4" />
					{busy ? 'Restoring' : 'Restore'}
				</Button>
				<Button size="sm" variant="outline" onClick={onReview}>
					<History className="h-4 w-4" />
					Review
				</Button>
				<Button size="sm" variant="ghost" onClick={() => void dismiss()}>
					Dismiss
				</Button>
			</div>
		</section>
	);
}

function SnapshotRow({
	snapshot,
	busy,
	onRestore,
	onSave,
	onDelete,
}: {
	snapshot: SnapshotSummary;
	busy: boolean;
	onRestore: (windowIndex?: number) => void;
	onSave: (windowIndex?: number) => void;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(false);
	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<li className="rounded-lg border border-border p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
						{whenText(snapshot.at)}
						<Badge variant={snapshot.reason === 'crash' ? 'accent' : 'default'}>
							{REASON_LABELS[snapshot.reason]}
						</Badge>
					</p>
					<p className="text-xs text-muted-foreground">
						{plural(snapshot.windows.length, 'window')} ·{' '}
						{plural(snapshot.tabs, 'tab')}
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => onRestore()}
					>
						<RotateCcw className="h-4 w-4" />
						Restore all
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => onSave()}
					>
						<Save className="h-4 w-4" />
						Save as session
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8 text-muted-foreground hover:text-destructive"
						aria-label={`Delete the snapshot from ${whenText(snapshot.at)}`}
						disabled={busy}
						onClick={onDelete}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<button
				type="button"
				aria-expanded={open}
				className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => setOpen((value) => !value)}
			>
				<Chevron className="h-3.5 w-3.5" aria-hidden="true" />
				{open ? 'Hide windows' : 'Show windows'}
			</button>
			{open && (
				<ul className="mt-2 space-y-1.5">
					{snapshot.windows.map((win, index) => (
						<li
							key={index}
							className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2"
						>
							<div className="flex min-w-0 items-start gap-2">
								<AppWindow
									className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
								<div className="min-w-0">
									<p className="text-xs font-medium">
										Window {index + 1} · {plural(win.tabs, 'tab')}
										{win.pinned ? ` · ${win.pinned} pinned` : ''}
										{win.groups ? ` · ${plural(win.groups, 'group')}` : ''}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{win.titles.join(' · ')}
									</p>
								</div>
							</div>
							<div className="flex gap-1">
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => onRestore(index)}
								>
									Restore
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => onSave(index)}
								>
									Save
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</li>
	);
}

/**
The "Recent snapshots" dialog: crash-recovery snapshots with time and counts; restore all or one window, save as a session, delete.
*/
export function SnapshotsDialog({
	open,
	onOpenChange,
	showStatus,
	onSessionsChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
	onSessionsChanged?: () => unknown;
}) {
	const {data, error, reload} = useSnapshots(open);
	const [busy, setBusy] = useState(false);

	async function run(action: () => Promise<void>) {
		setBusy(true);
		try {
			await action();
		} catch (reason) {
			showStatus(messageOf(reason) || 'That did not work.', true);
		}

		setBusy(false);
		await reload();
	}

	const restore = (id: string, windowIndex?: number) =>
		run(async () => {
			const result = await send('RESTORE_SNAPSHOT', {id, windowIndex});
			if (result?.ok) {
				reportSnapshotRestore(result, showStatus);
			} else {
				showStatus(result?.error || 'Could not restore that snapshot.', true);
			}
		});

	const saveAsSession = (id: string, windowIndex?: number) =>
		run(async () => {
			const result = await send('SAVE_SNAPSHOT_AS_SESSION', {id, windowIndex});
			if (result?.ok) {
				showStatus(
					`Saved ${plural(result.count, 'tab')} as ${plural(result.groups, 'session')}.`,
					false,
					{toast: true},
				);
				await onSessionsChanged?.();
			} else {
				showStatus(result?.error || 'Could not save that snapshot.', true);
			}
		});

	const remove = (id: string) =>
		run(async () => {
			const result = await send('DELETE_SNAPSHOT', {id});
			if (result?.ok) {
				offerUndo('Snapshot deleted.', result.undoId, showStatus, reload);
			} else {
				showStatus(result?.error || 'Could not delete that snapshot.', true);
			}
		});

	const clearAll = () =>
		run(async () => {
			const result = await send('CLEAR_SNAPSHOTS');
			if (result?.ok) {
				offerUndo(
					`Cleared ${plural(result.count, 'snapshot')}.`,
					result.undoId,
					showStatus,
					reload,
				);
			} else {
				showStatus(result?.error || 'Could not clear the snapshots.', true);
			}
		});

	const snapshots = data?.snapshots ?? [];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Recent snapshots</DialogTitle>
					<DialogDescription>
						Automatic copies of your open windows, kept on this computer so a
						crash does not cost you your tabs. Restoring opens new windows.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{error && (
						<p role="alert" className="text-sm font-medium text-destructive">
							{error}
						</p>
					)}
					{data && !data.enabled && (
						<p className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
							Snapshots are turned off in Settings › Recovery &amp; backups.
							Existing ones are kept until you clear them.
						</p>
					)}
					{data && snapshots.length === 0 && (
						<p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							No snapshots yet. They appear a few minutes after you open some
							web pages.
						</p>
					)}
					{snapshots.length > 0 && (
						<ul className="space-y-2" aria-label="Snapshots">
							{snapshots.map((snapshot) => (
								<SnapshotRow
									key={snapshot.id}
									snapshot={snapshot}
									busy={busy}
									onRestore={(windowIndex) =>
										void restore(snapshot.id, windowIndex)
									}
									onSave={(windowIndex) =>
										void saveAsSession(snapshot.id, windowIndex)
									}
									onDelete={() => void remove(snapshot.id)}
								/>
							))}
						</ul>
					)}
				</DialogBody>
				<DialogFooter>
					<Button
						variant="outline"
						disabled={busy || snapshots.length === 0}
						onClick={() => void clearAll()}
					>
						<Trash2 className="h-4 w-4" />
						Clear all
					</Button>
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const KIND_LABELS: Record<TrashKind, string> = {
	session: 'Session',
	tabs: 'Saved links',
	bookmark: 'Bookmark',
	column: 'Bookmark column',
	folder: 'Session folder',
};

/**
The trash: deleted sessions, saved links, bookmarks, columns and folders; restore, delete permanently, or empty it.
*/
export function TrashDialog({
	open,
	onOpenChange,
	showStatus,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
	onChanged?: () => unknown;
}) {
	const [items, setItems] = useState<TrashSummary[] | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		try {
			const result = await send('GET_TRASH');
			if (result?.ok) {
				setItems(result.items);
				setError('');
			} else {
				setError(result?.error || 'Could not read the trash.');
			}
		} catch (reason) {
			setError(messageOf(reason) || 'Could not read the trash.');
		}
	}, []);
	useEffect(() => {
		if (open) {
			void load();
		}
	}, [open, load]);

	async function run(action: () => Promise<void>) {
		setBusy(true);
		try {
			await action();
		} catch (reason) {
			showStatus(messageOf(reason) || 'That did not work.', true);
		}

		setBusy(false);
		await load();
	}

	const restore = (item: TrashSummary) =>
		run(async () => {
			const result = await send('RESTORE_TRASH', {id: item.id});
			if (result?.ok) {
				showStatus(`Restored “${item.label}” to ${result.placed}.`, false, {
					toast: true,
				});
				await onChanged?.();
			} else {
				showStatus(result?.error || 'Could not restore that item.', true);
			}
		});

	const remove = (item: TrashSummary) =>
		run(async () => {
			const result = await send('DELETE_TRASH', {id: item.id});
			if (result?.ok) {
				offerUndo(
					`Deleted “${item.label}” permanently.`,
					result.undoId,
					showStatus,
					load,
				);
			} else {
				showStatus(result?.error || 'Could not delete that item.', true);
			}
		});

	const empty = () =>
		run(async () => {
			const result = await send('EMPTY_TRASH');
			if (result?.ok) {
				offerUndo(
					`Emptied the trash (${plural(result.count, 'item')}).`,
					result.undoId,
					showStatus,
					load,
				);
			} else {
				showStatus(result?.error || 'Could not empty the trash.', true);
			}
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Trash</DialogTitle>
					<DialogDescription>
						Deleted sessions, saved links, bookmarks, columns and folders wait
						here until the retention period set in Settings ends.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{error && (
						<p role="alert" className="text-sm font-medium text-destructive">
							{error}
						</p>
					)}
					{items && items.length === 0 && (
						<p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							The trash is empty.
						</p>
					)}
					{items && items.length > 0 && (
						<ul className="space-y-2" aria-label="Deleted items">
							{items.map((item) => (
								<li
									key={item.id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5"
								>
									<div className="min-w-0">
										<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
											<span className="truncate">{item.label}</span>
											<Badge variant="default" className="shrink-0">
												{KIND_LABELS[item.kind]}
											</Badge>
										</p>
										<p className="truncate text-xs text-muted-foreground">
											{item.count > 1 ? `${plural(item.count, 'link')} · ` : ''}
											{item.origin ? `from ${item.origin} · ` : ''}
											deleted {whenText(item.deletedAt)}
										</p>
									</div>
									<div className="flex gap-1">
										<Button
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => void restore(item)}
										>
											<Undo2 className="h-4 w-4" />
											Restore
										</Button>
										<Button
											size="icon"
											variant="ghost"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											aria-label={`Delete “${item.label}” permanently`}
											disabled={busy}
											onClick={() => void remove(item)}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</DialogBody>
				<DialogFooter>
					<Button
						variant="outline"
						className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
						disabled={busy || !items || items.length === 0}
						onClick={() => void empty()}
					>
						<Trash2 className="h-4 w-4" />
						Empty trash
					</Button>
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const BACKUP_KIND_LABELS = {
	auto: 'Automatic',
	manual: 'Manual',
	safety: 'Safety',
} as const;

function BackupRow({
	backup,
	busy,
	onRestore,
	onDownload,
	onDelete,
}: {
	backup: BackupSummary;
	busy: boolean;
	onRestore: () => void;
	onDownload: () => void;
	onDelete: () => void;
}) {
	return (
		<li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
			<div className="min-w-0">
				<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
					{whenText(backup.at)}
					<Badge variant={backup.kind === 'safety' ? 'accent' : 'default'}>
						{BACKUP_KIND_LABELS[backup.kind]}
					</Badge>
				</p>
				<p className="text-xs text-muted-foreground">
					{plural(backup.sessions, 'session')} ({plural(backup.tabs, 'tab')}) ·{' '}
					{plural(backup.bookmarks, 'bookmark')} · {bytesText(backup.bytes)}
					{backup.reason ? ` · ${backup.reason}` : ''}
				</p>
			</div>
			<div className="flex gap-1">
				<Button size="sm" variant="outline" disabled={busy} onClick={onRestore}>
					<RotateCcw className="h-4 w-4" />
					Restore
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-8 w-8"
					aria-label={`Download the backup from ${whenText(backup.at)}`}
					disabled={busy}
					onClick={onDownload}
				>
					<Download className="h-4 w-4" />
				</Button>
				<Button
					size="icon"
					variant="ghost"
					className="h-8 w-8 text-muted-foreground hover:text-destructive"
					aria-label={`Delete the backup from ${whenText(backup.at)}`}
					disabled={busy}
					onClick={onDelete}
				>
					<Trash2 className="h-4 w-4" />
				</Button>
			</div>
		</li>
	);
}

type UsageText = {snapshots: string; backups: string; trash: string};

/**
Settings › Recovery & backups: storage use, the quick buttons, and the internal backup list (automatic, manual and safety).
*/
export function RecoveryTools({
	showStatus,
	onDataChanged,
	onOpenSnapshots,
	onOpenTrash,
}: {
	showStatus: ShowStatus;
	/**
	Called after something changed the saved sessions or bookmarks (a restored backup).
	*/
	onDataChanged: () => unknown;
	onOpenSnapshots: () => void;
	onOpenTrash: () => void;
}) {
	const [usage, setUsage] = useState<UsageText | null>(null);
	const [backups, setBackups] = useState<ActionSuccess<'GET_BACKUPS'> | null>(
		null,
	);
	const [busy, setBusy] = useState('');
	const refresh = useCallback(async () => {
		const [usageResult, backupResult] = await Promise.all([
			send('GET_STORAGE_USAGE'),
			send('GET_BACKUPS'),
		]);
		if (usageResult?.ok) {
			setUsage({
				snapshots: bytesText(usageResult.usage.snapshots),
				backups: bytesText(usageResult.usage.backups),
				trash: bytesText(usageResult.usage.trash),
			});
		}

		if (backupResult?.ok) {
			setBackups(backupResult);
		}
	}, []);
	useEffect(() => {
		void refresh().catch(() => undefined);
	}, [refresh]);

	async function run(name: string, action: () => Promise<void>) {
		setBusy(name);
		try {
			await action();
		} catch (reason) {
			showStatus(messageOf(reason) || 'That did not work.', true);
		}

		setBusy('');
		await refresh().catch(() => undefined);
	}

	const backupNow = () =>
		run('backup', async () => {
			const result = await send('BACKUP_NOW');
			if (result?.ok) {
				showStatus(
					`Backed up ${plural(result.backup.sessions, 'session')} and ${plural(result.backup.bookmarks, 'bookmark')}.`,
					false,
					{toast: true},
				);
			} else {
				showStatus(result?.error || 'Could not back up.', true);
			}
		});

	const download = (backup: BackupSummary) =>
		run(`download:${backup.id}`, async () => {
			const result = await send('GET_BACKUP_DATA', {id: backup.id});
			if (result?.ok) {
				downloadFile(result.json, 'application/json', result.filename);
			} else {
				showStatus(result?.error || 'Could not read that backup.', true);
			}
		});

	const restoreBackup = (backup: BackupSummary) =>
		run(`restore:${backup.id}`, async () => {
			const result = await send('RESTORE_BACKUP', {id: backup.id});
			if (result?.ok) {
				offerUndo(
					`Restored ${plural(result.sessions, 'session')} and ${plural(result.bookmarks, 'bookmark')}.`,
					result.undoId,
					showStatus,
					async () => {
						await refresh();
						await onDataChanged();
					},
				);
				await onDataChanged();
			} else {
				showStatus(result?.error || 'Could not restore that backup.', true);
			}
		});

	const removeBackup = (backup: BackupSummary) =>
		run(`delete:${backup.id}`, async () => {
			const result = await send('DELETE_BACKUP', {id: backup.id});
			if (result?.ok) {
				offerUndo('Backup deleted.', result.undoId, showStatus, refresh);
			} else {
				showStatus(result?.error || 'Could not delete that backup.', true);
			}
		});

	const clearSnapshots = () =>
		run('snapshots', async () => {
			const result = await send('CLEAR_SNAPSHOTS');
			if (result?.ok) {
				offerUndo(
					`Cleared ${plural(result.count, 'snapshot')}.`,
					result.undoId,
					showStatus,
					refresh,
				);
			} else {
				showStatus(result?.error || 'Could not clear the snapshots.', true);
			}
		});

	const emptyTrash = () =>
		run('trash', async () => {
			const result = await send('EMPTY_TRASH');
			if (result?.ok) {
				offerUndo(
					`Emptied the trash (${plural(result.count, 'item')}).`,
					result.undoId,
					showStatus,
					refresh,
				);
			} else {
				showStatus(result?.error || 'Could not empty the trash.', true);
			}
		});

	const all = [...(backups?.auto ?? []), ...(backups?.safety ?? [])].toSorted(
		(a, b) => b.at - a.at,
	);
	return (
		<div className="space-y-5 pt-1">
			<div className="space-y-3 rounded-md bg-muted/60 px-4 py-3">
				<p className="text-sm font-medium">Storage used</p>
				<dl className="grid grid-cols-3 gap-3 text-xs">
					{(
						[
							['Snapshots', usage?.snapshots],
							['Backups', usage?.backups],
							['Trash', usage?.trash],
						] as const
					).map(([label, value]) => (
						<div key={label}>
							<dt className="text-muted-foreground">{label}</dt>
							<dd className="mt-0.5 text-sm font-semibold tabular-nums">
								{value ?? '…'}
							</dd>
						</div>
					))}
				</dl>
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== ''}
						onClick={() => void backupNow()}
					>
						<Save className="h-4 w-4" />
						{busy === 'backup' ? 'Backing up' : 'Back up now'}
					</Button>
					<Button size="sm" variant="outline" onClick={onOpenSnapshots}>
						<History className="h-4 w-4" />
						Recent snapshots
					</Button>
					<Button size="sm" variant="outline" onClick={onOpenTrash}>
						<Trash2 className="h-4 w-4" />
						Trash
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== ''}
						onClick={() => void clearSnapshots()}
					>
						Clear snapshots
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== ''}
						onClick={() => void emptyTrash()}
					>
						Empty trash
					</Button>
				</div>
			</div>
			<div>
				<p className="text-sm font-medium">Backups</p>
				<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
					Each backup holds your sessions, bookmarks and settings as a regular
					JSON export that Import can read. Restoring replaces sessions and
					bookmarks, keeps your current settings, and first saves a safety
					backup of what you have now. Safety backups are taken automatically
					before erasing data, large imports, and deleting many bookmarks.
				</p>
				{backups?.downloadError && (
					<p
						role="status"
						className="mt-2 text-xs font-medium text-destructive"
					>
						The last Downloads copy was not written: {backups.downloadError}
					</p>
				)}
				{all.length === 0 ? (
					<p className="mt-3 rounded-md border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
						No backups yet.
					</p>
				) : (
					<ul className="mt-3 space-y-2" aria-label="Backups">
						{all.map((backup) => (
							<BackupRow
								key={backup.id}
								backup={backup}
								busy={busy !== ''}
								onRestore={() => void restoreBackup(backup)}
								onDownload={() => void download(backup)}
								onDelete={() => void removeBackup(backup)}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
