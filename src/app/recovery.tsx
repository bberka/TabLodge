// Recovery UI shared by the dashboard, side panel and Settings: the "restore your last session" banner, the
// recent-snapshots dialog, the trash bin dialog, and the backup list. Every action is a message to the service
// worker, which keeps all of this data in local extension storage.
import {useCallback, useEffect, useState} from 'react';
import {
	AppWindow,
	Bookmark,
	ChevronDown,
	ChevronRight,
	Download,
	History,
	LayoutGrid,
	PanelsTopLeft,
	RotateCcw,
	Save,
	Trash2,
	Undo2,
} from 'lucide-react';
import {
	Badge,
	Button,
	ConfirmationDialog,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	ScrollArea,
	SegmentedControl,
} from '../shared/ui';
import {downloadFile} from '../shared/download';
import {send, type ShowStatus} from './common';
import {
	messageOf,
	plural,
	reportSnapshotRestore,
	useSnapshots,
	whenText,
	bytesText,
	offerUndo,
	type TrashFilter,
} from './recovery-core';
import type {
	ActionSuccess,
	BackupSummary,
	SnapshotReason,
	SnapshotSummary,
	TrashKind,
	TrashSummary,
} from './types';

const REASON_LABELS: Record<SnapshotReason, string> = {
	interval: 'Regular snapshot',
	startup: 'At startup',
	crash: 'Before an unclean exit',
	exit: 'When the browser was closed',
	manual: 'Saved by you',
};

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
	confirmDestructive = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
	onSessionsChanged?: () => unknown;
	/**
	Ask before clearing everything (the Settings page does; other pages use Undo alone).
	*/
	confirmDestructive?: boolean;
}) {
	const {data, error, reload} = useSnapshots(open);
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

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
				<DialogHeader className={SCROLL_HEADER}>
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
						<ScrollArea
							type="auto"
							className="-mx-2"
							viewportClassName="max-h-[min(32rem,calc(100dvh-23rem))] px-2"
						>
							<ul className="space-y-2 py-0.5" aria-label="Snapshots">
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
						</ScrollArea>
					)}
				</DialogBody>
				<DialogFooter className={SCROLL_FOOTER}>
					<Button
						variant="outline"
						disabled={busy || snapshots.length === 0}
						onClick={() =>
							confirmDestructive ? setConfirmOpen(true) : void clearAll()
						}
					>
						<Trash2 className="h-4 w-4" />
						Clear all
					</Button>
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
			<ConfirmationDialog
				open={confirmOpen}
				title="Clear all snapshots?"
				description="Every recent snapshot is removed. You can undo this right after."
				confirmLabel="Clear snapshots"
				onOpenChange={setConfirmOpen}
				onConfirm={() => {
					setConfirmOpen(false);
					void clearAll();
				}}
			/>
		</Dialog>
	);
}

// Dialogs whose list scrolls between a fixed title and fixed buttons: edge-to-edge lines mark where the list starts and ends.
const SCROLL_HEADER = '-mx-6 mb-4 border-b border-border pb-4 pl-6 pr-14';
const SCROLL_FOOTER = '-mx-6 mt-4 border-t border-border px-6 pt-4';

function FilterLabel({
	icon: Icon,
	count,
	children,
}: {
	icon: typeof Trash2;
	count: number;
	children: string;
}) {
	return (
		<span className="inline-flex items-center justify-center gap-1.5">
			<Icon className="h-3.5 w-3.5" aria-hidden="true" />
			{children}
			<span className="tabular-nums opacity-70">{count}</span>
		</span>
	);
}

/**
Which side of TabLodge a deleted item belongs to, for the Sessions / Bookmarks filter.
*/
const trashSide = (item: TrashSummary): Exclude<TrashFilter, 'all'> =>
	item.kind === 'bookmark' || item.kind === 'column' ? 'bookmarks' : 'sessions';

const KIND_LABELS: Record<TrashKind, string> = {
	session: 'Session',
	tabs: 'Saved links',
	bookmark: 'Bookmark',
	column: 'Bookmark column',
	folder: 'Session folder',
};

/**
The trash bin: deleted sessions, saved links, bookmarks and columns; restore, delete permanently, or empty it.
*/
export function TrashDialog({
	open,
	onOpenChange,
	showStatus,
	onChanged,
	confirmDestructive = false,
	initialFilter = 'all',
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
	onChanged?: () => unknown;
	/**
	Show only session or bookmark items at first (the user can switch).
	*/
	initialFilter?: TrashFilter;
	/**
	Ask before emptying the trash bin (the Settings page does; other pages use Undo alone).
	*/
	confirmDestructive?: boolean;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [items, setItems] = useState<TrashSummary[] | null>(null);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [filter, setFilter] = useState<TrashFilter>(initialFilter);
	useEffect(() => {
		if (open) {
			setFilter(initialFilter);
		}
	}, [open, initialFilter]);
	const load = useCallback(async () => {
		try {
			const result = await send('GET_TRASH');
			if (result?.ok) {
				setItems(result.items);
				setError('');
			} else {
				setError(result?.error || 'Could not read the trash bin.');
			}
		} catch (reason) {
			setError(messageOf(reason) || 'Could not read the trash bin.');
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
					`Emptied the trash bin (${plural(result.count, 'item')}).`,
					result.undoId,
					showStatus,
					load,
				);
			} else {
				showStatus(result?.error || 'Could not empty the trash bin.', true);
			}
		});

	const shown =
		items &&
		(filter === 'all'
			? items
			: items.filter((item) => trashSide(item) === filter));
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader className={SCROLL_HEADER}>
					<DialogTitle>Trash bin</DialogTitle>
					<DialogDescription>
						Deleted sessions, saved links, bookmarks and columns wait here until
						the retention period set in Settings ends.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{error && (
						<p role="alert" className="text-sm font-medium text-destructive">
							{error}
						</p>
					)}
					{items && items.length > 0 && (
						<SegmentedControl
							fullWidth
							label="Show"
							value={filter}
							options={[
								{
									value: 'all',
									label: (
										<FilterLabel icon={LayoutGrid} count={items.length}>
											All
										</FilterLabel>
									),
								},
								{
									value: 'sessions',
									label: (
										<FilterLabel
											icon={PanelsTopLeft}
											count={
												items.filter((item) => trashSide(item) === 'sessions')
													.length
											}
										>
											Sessions
										</FilterLabel>
									),
								},
								{
									value: 'bookmarks',
									label: (
										<FilterLabel
											icon={Bookmark}
											count={
												items.filter((item) => trashSide(item) === 'bookmarks')
													.length
											}
										>
											Bookmarks
										</FilterLabel>
									),
								},
							]}
							onValueChange={setFilter}
						/>
					)}
					{shown && shown.length === 0 && (
						<p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
							{items?.length
								? `No deleted ${filter === 'bookmarks' ? 'bookmarks or columns' : 'sessions, links or folders'}.`
								: 'The trash bin is empty.'}
						</p>
					)}
					{shown && shown.length > 0 && (
						// Only the list scrolls, so the title and the buttons stay in view however long it gets.
						<ScrollArea
							type="auto"
							className="-mx-2"
							viewportClassName="max-h-[min(32rem,calc(100dvh-23rem))] px-2"
						>
							<ul className="space-y-2 py-0.5" aria-label="Deleted items">
								{shown.map((item) => (
									<li
										key={item.id}
										className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
									>
										<div className="min-w-0 flex-1">
											<p className="flex min-w-0 items-center gap-2 text-sm font-medium">
												<span className="min-w-0 truncate" title={item.label}>
													{item.label}
												</span>
												<Badge variant="default" className="shrink-0">
													{KIND_LABELS[item.kind]}
												</Badge>
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{item.count > 1
													? `${plural(item.count, 'link')} · `
													: ''}
												{item.origin ? `from ${item.origin} · ` : ''}
												deleted {whenText(item.deletedAt)}
											</p>
										</div>
										<div className="flex shrink-0 gap-1">
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
						</ScrollArea>
					)}
				</DialogBody>
				<DialogFooter className={SCROLL_FOOTER}>
					<Button
						variant="outline"
						className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
						disabled={busy || !items || items.length === 0}
						onClick={() =>
							confirmDestructive ? setConfirmOpen(true) : void empty()
						}
					>
						<Trash2 className="h-4 w-4" />
						{filter === 'all' || !items?.length
							? 'Empty trash bin'
							: `Empty all ${items.length}`}
					</Button>
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
			<ConfirmationDialog
				open={confirmOpen}
				title="Empty the trash bin?"
				description="Everything in the trash bin is deleted for good. You can undo this right after."
				confirmLabel="Empty trash bin"
				onOpenChange={setConfirmOpen}
				onConfirm={() => {
					setConfirmOpen(false);
					void empty();
				}}
			/>
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
	const [pending, setPending] = useState<
		| {kind: 'snapshots' | 'trash'}
		| {kind: 'restore' | 'delete'; backup: BackupSummary}
		| null
	>(null);
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
					`Emptied the trash bin (${plural(result.count, 'item')}).`,
					result.undoId,
					showStatus,
					refresh,
				);
			} else {
				showStatus(result?.error || 'Could not empty the trash bin.', true);
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
							['Trash bin', usage?.trash],
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
						Trash bin
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== ''}
						onClick={() => setPending({kind: 'snapshots'})}
					>
						Clear snapshots
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== ''}
						onClick={() => setPending({kind: 'trash'})}
					>
						Empty trash bin
					</Button>
				</div>
			</div>
			<div>
				<p className="text-sm font-medium">Backups</p>
				<p className="mt-1 text-xs leading-5 text-muted-foreground">
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
								onRestore={() => setPending({kind: 'restore', backup})}
								onDownload={() => void download(backup)}
								onDelete={() => setPending({kind: 'delete', backup})}
							/>
						))}
					</ul>
				)}
			</div>
			<ConfirmationDialog
				open={pending !== null}
				title={
					pending?.kind === 'snapshots'
						? 'Clear all snapshots?'
						: pending?.kind === 'trash'
							? 'Empty the trash bin?'
							: pending?.kind === 'restore'
								? 'Restore this backup?'
								: 'Delete this backup?'
				}
				description={
					pending?.kind === 'snapshots'
						? 'Every recent snapshot is removed. You can undo this right after.'
						: pending?.kind === 'trash'
							? 'Everything in the trash bin is deleted for good. You can undo this right after.'
							: pending?.kind === 'restore'
								? 'Your sessions and bookmarks are replaced by this backup. A safety backup of what you have now is kept, and you can undo this right after.'
								: 'This backup is removed. You can undo this right after.'
				}
				confirmLabel={
					pending?.kind === 'snapshots'
						? 'Clear snapshots'
						: pending?.kind === 'trash'
							? 'Empty trash bin'
							: pending?.kind === 'restore'
								? 'Restore'
								: 'Delete'
				}
				onOpenChange={(open) => !open && setPending(null)}
				onConfirm={() => {
					const current = pending;
					setPending(null);
					switch (current?.kind) {
						case 'snapshots': {
							void clearSnapshots();

							break;
						}

						case 'trash': {
							void emptyTrash();

							break;
						}

						case 'restore': {
							void restoreBackup(current.backup);

							break;
						}

						default: {
							if (current) {
								void removeBackup(current.backup);
							}
						}
					}
				}}
			/>
		</div>
	);
}

// The helpers moved to recovery-core.ts; other modules still import them from here.
export {
	RECOVERY_EVENT,
	bytesText,
	emitRecoveryEvent,
	offerCloseTabsUndo,
	offerTrashUndo,
	offerUndo,
	undoFromTrash,
	useRecoveryEvents,
	whenText,
	type RecoveryEventDetail,
	type TrashFilter,
} from './recovery-core';
