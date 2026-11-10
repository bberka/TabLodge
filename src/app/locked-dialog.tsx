// The locked area dialog: set up, unlock, browse, and manage. Its pieces share the hooks and notes in locked.tsx.
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
	type SyntheticEvent,
} from 'react';
import {
	ArrowLeft,
	ArrowRightLeft,
	KeyRound,
	Lock,
	LockOpen,
	MoreHorizontal,
	Pencil,
	Plus,
	Save,
	Trash2,
	X,
} from 'lucide-react';
import {
	Button,
	ConfirmationDialog,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	ActionDropdownMenu,
	IconTooltip,
	Input,
	Label,
	ScrollArea,
	SegmentedControl,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	type MenuAction,
} from '../shared/ui';
import {
	IDLE_MINUTES_CHOICES,
	DEFAULT_IDLE_MINUTES,
	LOCKED_RESET_CONFIRMATION,
	RESET_OFFER_ATTEMPTS,
} from '../shared/locked-store';
import type {
	ActionFailure,
	BookmarkColumn,
	LockedBookmark,
	LockedStatus,
} from './types';
import {CREDENTIAL_LABELS, type CredentialKind} from './passcode';
import {
	EMPTY_PASSCODE_DRAFT,
	PasscodeEntry,
	PasscodeSetup,
	passcodeDraftProblem,
	type PasscodeDraft,
} from './passcode-fields';
import {plural, send, type ShowStatus} from './common';
import {ColumnSelect} from './column-select';
import {LinkSummary} from './favicon';
import {PROJECT} from './project';
import {hostOf, webUrl} from './web-url';
import {
	ErrorLine,
	LOCKED_HIDDEN_NOTE,
	LOCKED_PROFILE_NOTE,
	Note,
	failureText,
	idleLabel,
	useCooldown,
	useLockedStatus,
} from './locked';

type View =
	| {name: 'list'}
	| {name: 'add'}
	| {name: 'edit'; item: LockedBookmark}
	| {name: 'move'; item: LockedBookmark}
	| {name: 'change'}
	| {name: 'remove'};

// How often use of the dialog is reported to the worker.
const TOUCH_INTERVAL_MS = 20_000;

/**
The whole locked area. It follows the worker's state: set up when there is no area, an unlock screen while locked, and the
bookmarks once open, so an idle lock that happens while the dialog is showing sends it back to the unlock screen.
*/
export function LockedDialog({
	open,
	onOpenChange,
	columns,
	showStatus,
	onBoardChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	columns: readonly BookmarkColumn[];
	showStatus: ShowStatus;
	/**
	Called after bookmarks were moved onto the board, so the page reloads its library.
	*/
	onBoardChanged?: () => void;
}) {
	const {status, unavailable, refresh, setStatus} = useLockedStatus();
	const [view, setView] = useState<View>({name: 'list'});
	const [items, setItems] = useState<LockedBookmark[]>([]);
	const [announce, setAnnounce] = useState('');
	const [resetting, setResetting] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const unlocked = status?.configured === true && status.unlocked;
	const wasUnlockedRef = useRef(false);
	const lastTouchRef = useRef(0);

	const loadItems = useCallback(async () => {
		const result = await send('LOCKED_LIST');
		if (result?.ok) {
			setItems(result.bookmarks);
		} else {
			setItems([]);
			void refresh();
		}
	}, [refresh]);

	useEffect(() => {
		if (open && unlocked) {
			void loadItems();
		}
	}, [open, unlocked, loadItems]);

	// An idle lock while the dialog is open: say so, and drop what was on screen.
	useEffect(() => {
		if (wasUnlockedRef.current && !unlocked && status?.configured) {
			setItems([]);
			setView({name: 'list'});
			setAnnounce('The locked area locked itself.');
		}

		wasUnlockedRef.current = unlocked;
	}, [unlocked, status]);

	useEffect(() => {
		if (open) {
			return;
		}

		setView({name: 'list'});
		setAnnounce('');
		setResetting(false);
	}, [open]);

	// Another page opened the area while the reset question was showing: nothing to reset from here.
	useEffect(() => {
		if (unlocked) {
			setResetting(false);
		}
	}, [unlocked]);

	// Moves focus to the first field (or the heading) whenever the screen changes, so a keyboard or screen reader user is
	// never left on a control that just disappeared.
	const screen =
		!status || unavailable
			? 'wait'
			: status.configured
				? status.unlocked
					? view.name
					: resetting
						? 'reset'
						: 'unlock'
				: 'setup';
	useEffect(() => {
		if (!open) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			const body = bodyRef.current;
			const target =
				body?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
				body?.querySelector<HTMLElement>('[data-screen-title]') ??
				body?.querySelector<HTMLElement>(
					'input:not([disabled]):not([type=radio]):not([type=checkbox])',
				);
			target?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [open, screen]);

	// Reading or typing in the dialog counts as use, so the idle timer does not lock it under the person's hands.
	useEffect(() => {
		if (!open || !unlocked) {
			return;
		}

		const touch = () => {
			const now = Date.now();
			if (now - lastTouchRef.current <= TOUCH_INTERVAL_MS) {
				return;
			}

			lastTouchRef.current = now;
			void send('LOCKED_TOUCH');
		};

		document.addEventListener('keydown', touch);
		document.addEventListener('pointerdown', touch);
		return () => {
			document.removeEventListener('keydown', touch);
			document.removeEventListener('pointerdown', touch);
		};
	}, [open, unlocked]);

	async function lockNow() {
		const result = await send('LOCKED_LOCK');
		if (!result?.ok) {
			return;
		}

		setItems([]);
		setView({name: 'list'});
		setStatus(result.locked);
		setAnnounce('The locked area is locked.');
	}

	let body: ReactNode;
	let title = 'Locked area';
	let description: ReactNode =
		'Bookmarks kept behind a PIN or password. They are hidden everywhere else.';
	if (unavailable) {
		body = (
			<DialogBody>
				<Note>{unavailable}</Note>
			</DialogBody>
		);
	} else if (!status) {
		body = (
			<DialogBody>
				<p className="sr-only" role="status">
					Loading the locked area
				</p>
			</DialogBody>
		);
	} else if (!status.configured) {
		title = 'Set up the locked area';
		body = (
			<SetupView
				onDone={(next) => {
					setStatus(next);
					showStatus('The locked area is ready and unlocked.', false, {
						toast: true,
					});
				}}
				onCancel={() => onOpenChange(false)}
			/>
		);
	} else if (status.unlocked) {
		switch (view.name) {
			case 'list': {
				body = (
					<ListView
						status={status}
						items={items}
						onAdd={() => setView({name: 'add'})}
						onEdit={(item) => setView({name: 'edit', item})}
						onMove={(item) => setView({name: 'move', item})}
						onDelete={async (item) => {
							const result = await send('LOCKED_REMOVE', {ids: [item.id]});
							if (result?.ok) {
								showStatus('Deleted from the locked area.', false, {
									toast: true,
								});
								await loadItems();
							} else {
								showStatus(
									failureText(result, 'Could not delete that bookmark.'),
									true,
								);
							}

							void refresh();
						}}
						onLock={() => void lockNow()}
						onChange={() => setView({name: 'change'})}
						onRemove={() => setView({name: 'remove'})}
						onIdle={async (idleMinutes) => {
							const result = await send('LOCKED_SET_IDLE', {idleMinutes});
							if (result?.ok) {
								setStatus(result.locked);
								showStatus(`Auto-lock: ${idleLabel(idleMinutes)}.`, false, {
									toast: true,
								});
							} else {
								showStatus(
									failureText(result, 'Could not change the auto-lock time.'),
									true,
								);
							}
						}}
						onClose={() => onOpenChange(false)}
					/>
				);

				break;
			}

			case 'add':
			case 'edit': {
				const editing = view.name === 'edit' ? view.item : undefined;
				title = editing ? 'Edit locked bookmark' : 'Add to the locked area';
				description = null;
				body = (
					<EditView
						item={editing}
						onBack={() => setView({name: 'list'})}
						onSaved={async (message) => {
							setView({name: 'list'});
							showStatus(message, false, {toast: true});
							await loadItems();
							void refresh();
						}}
					/>
				);

				break;
			}

			case 'move': {
				title = 'Move to the board';
				description =
					'The bookmark leaves the locked area and becomes visible.';
				body = (
					<MoveView
						item={view.item}
						columns={columns}
						onBack={() => setView({name: 'list'})}
						onMoved={async () => {
							setView({name: 'list'});
							showStatus('Moved to the board.', false, {toast: true});
							onBoardChanged?.();
							await loadItems();
							void refresh();
						}}
					/>
				);

				break;
			}

			case 'change': {
				title = `Change ${CREDENTIAL_LABELS[status.kind]}`;
				description =
					'The locked area is encrypted again with the new one. The old one stops working.';
				body = (
					<ChangeView
						kind={status.kind}
						onBack={() => setView({name: 'list'})}
						onChanged={(next) => {
							setStatus(next);
							setView({name: 'list'});
							showStatus('The locked area has a new PIN or password.', false, {
								toast: true,
							});
						}}
					/>
				);

				break;
			}

			default: {
				title = 'Remove the lock';
				description = 'This deletes the locked area.';
				body = (
					<RemoveView
						kind={status.kind}
						count={items.length}
						columns={columns}
						onBack={() => setView({name: 'list'})}
						onRemoved={(moved, discarded) => {
							setItems([]);
							setView({name: 'list'});
							void refresh();
							if (moved > 0) {
								onBoardChanged?.();
							}

							showStatus(
								moved > 0
									? `The lock is gone. ${plural(moved, 'bookmark')} moved to the board.`
									: `The lock is gone.${discarded > 0 ? ` ${plural(discarded, 'bookmark')} deleted.` : ''}`,
								false,
								{toast: true},
							);
						}}
					/>
				);
			}
		}
	} else if (resetting) {
		title = 'Reset the locked area';
		description = 'Use this only if you forgot your PIN or password.';
		body = (
			<ResetView
				onBack={() => setResetting(false)}
				onReset={(next) => {
					setResetting(false);
					setStatus(next);
					setAnnounce(
						'The locked area was reset and everything in it deleted. Choose a new PIN or password.',
					);
					showStatus('The locked area was reset.', false, {toast: true});
				}}
			/>
		);
	} else {
		title = 'Locked area';
		description = 'Enter your PIN or password to open it.';
		body = (
			<UnlockView
				status={status}
				onUnlocked={(next) => {
					setStatus(next);
					setAnnounce('The locked area is open.');
				}}
				onFailed={() => void refresh()}
				onReset={() => setResetting(true)}
				onCancel={() => onOpenChange(false)}
			/>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>
				<div ref={bodyRef} className="contents">
					{body}
				</div>
				<p className="sr-only" role="status" aria-live="polite">
					{announce}
				</p>
			</DialogContent>
		</Dialog>
	);
}

function SetupView({
	onDone,
	onCancel,
}: {
	onDone: (status: LockedStatus) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState<PasscodeDraft>(EMPTY_PASSCODE_DRAFT);
	const [idle, setIdle] = useState(DEFAULT_IDLE_MINUTES);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const problem = passcodeDraftProblem(draft);

	async function create(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (problem || busy) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_SETUP', {
			kind: draft.kind,
			value: draft.value,
			idleMinutes: idle,
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not create the locked area.'));
			return;
		}

		setDraft(EMPTY_PASSCODE_DRAFT);
		onDone(result.locked);
	}

	return (
		<form onSubmit={(event) => void create(event)}>
			<DialogBody>
				<p className="text-sm leading-6">{LOCKED_HIDDEN_NOTE}</p>
				<Note>{LOCKED_PROFILE_NOTE}</Note>
				<PasscodeSetup draft={draft} disabled={busy} onChange={setDraft} />
				<IdleField value={idle} onChange={setIdle} />
				{error && <ErrorLine>{error}</ErrorLine>}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					<X aria-hidden="true" />
					Cancel
				</Button>
				<Button type="submit" disabled={Boolean(problem) || busy}>
					<Lock aria-hidden="true" />
					{busy ? 'Creating' : 'Create locked area'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function IdleField({
	value,
	onChange,
	disabled,
}: {
	value: number;
	onChange: (minutes: number) => void;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Lock automatically</Label>
			<Select
				value={String(value)}
				disabled={disabled}
				onValueChange={(next) => onChange(Number(next))}
			>
				<SelectTrigger id={id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{IDLE_MINUTES_CHOICES.map((minutes) => (
						<SelectItem key={minutes} value={String(minutes)}>
							{idleLabel(minutes)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-xs text-muted-foreground">
				Counted from the last time you used the locked area. It always locks
				when the browser closes.
			</p>
		</div>
	);
}

function UnlockView({
	status,
	onUnlocked,
	onFailed,
	onReset,
	onCancel,
}: {
	status: Extract<LockedStatus, {configured: true; unlocked: false}>;
	onUnlocked: (status: LockedStatus) => void;
	/**
	Called after a wrong entry, so the status (and with it the reset offer) catches up.
	*/
	onFailed: () => void;
	onReset: () => void;
	onCancel: () => void;
}) {
	const [credential, setCredential] = useState('');
	const [error, setError] = useState('');
	const [retryAfterMs, setRetryAfterMs] = useState(status.retryAfterMs);
	const [busy, setBusy] = useState(false);
	const wait = useCooldown(retryAfterMs);

	async function unlock(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || wait > 0 || credential.length === 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_UNLOCK', {credential});
		setBusy(false);
		setCredential('');
		if (!result?.ok) {
			setError(failureText(result, 'Could not unlock.'));
			setRetryAfterMs((result as ActionFailure | undefined)?.retryAfterMs);
			onFailed();
			return;
		}

		onUnlocked(result.locked);
	}

	return (
		<form onSubmit={(event) => void unlock(event)}>
			<DialogBody>
				<PasscodeEntry
					value={credential}
					kind={status.kind}
					error={error}
					disabled={busy || wait > 0}
					onChange={setCredential}
				/>
				{wait > 0 && (
					<p className="text-xs text-muted-foreground" role="status">
						Too many wrong entries. Try again in {wait}{' '}
						{wait === 1 ? 'second' : 'seconds'}.
					</p>
				)}
				<p className="text-xs leading-5 text-muted-foreground">
					A forgotten {status.kind === 'pin' ? 'PIN' : 'password'} cannot be
					recovered. {PROJECT.name} stores neither it nor a hint.
				</p>
				{(wait > 0 || (status.failedAttempts ?? 0) >= RESET_OFFER_ATTEMPTS) && (
					<p className="text-xs leading-5">
						Forgot your {status.kind === 'pin' ? 'PIN' : 'password'}?{' '}
						<Button
							type="button"
							variant="link"
							className="h-auto p-0 text-xs"
							onClick={onReset}
						>
							Reset the locked area
						</Button>
					</p>
				)}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					<X aria-hidden="true" />
					Close
				</Button>
				<Button
					type="submit"
					disabled={busy || wait > 0 || credential.length === 0}
				>
					<LockOpen aria-hidden="true" />
					{busy ? 'Unlocking' : 'Unlock'}
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
The way out of a forgotten PIN or password: delete the area and set up a new one. It asks for no credential, so it says
what is lost and wants a typed word before the button works.
*/
function ResetView({
	onBack,
	onReset,
}: {
	onBack: () => void;
	onReset: (status: LockedStatus) => void;
}) {
	const [word, setWord] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const id = useId();
	const confirmed = word.trim().toUpperCase() === 'RESET';

	async function reset(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !confirmed) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_RESET', {
			confirm: LOCKED_RESET_CONFIRMATION,
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not reset the locked area.'));
			return;
		}

		onReset(result.locked);
	}

	return (
		<form onSubmit={(event) => void reset(event)}>
			<DialogBody>
				<Note>
					<strong>
						Resetting permanently deletes everything in the locked area.
					</strong>{' '}
					Every locked bookmark, with its title and address, is erased. This
					cannot be undone and {PROJECT.name} cannot bring any of it back. Your
					board, sessions, and other data are not touched.
				</Note>
				<p className="text-sm leading-6">
					Afterwards you can set a new PIN or password and start with an empty
					locked area.
				</p>
				<p className="text-xs leading-5 text-muted-foreground">
					A full backup made earlier still holds the old encrypted copy.
					Restoring it brings back the old locked area and its old PIN or
					password.
				</p>
				<div className="grid gap-1.5">
					<Label htmlFor={`${id}-word`}>Type RESET to confirm</Label>
					<Input
						id={`${id}-word`}
						value={word}
						disabled={busy}
						autoComplete="off"
						autoCapitalize="characters"
						spellCheck={false}
						data-autofocus=""
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? `${id}-error` : undefined}
						onChange={(event) => setWord(event.target.value)}
					/>
					{error && (
						<div id={`${id}-error`}>
							<ErrorLine>{error}</ErrorLine>
						</div>
					)}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onBack}>
					<ArrowLeft aria-hidden="true" />
					Back
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={busy || !confirmed}
				>
					<Trash2 aria-hidden="true" />
					{busy ? 'Resetting' : 'Delete everything and reset'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function ListView({
	status,
	items,
	onAdd,
	onEdit,
	onMove,
	onDelete,
	onLock,
	onChange,
	onRemove,
	onIdle,
	onClose,
}: {
	status: Extract<LockedStatus, {configured: true; unlocked: true}>;
	items: LockedBookmark[];
	onAdd: () => void;
	onEdit: (item: LockedBookmark) => void;
	onMove: (item: LockedBookmark) => void;
	onDelete: (item: LockedBookmark) => Promise<void>;
	onLock: () => void;
	onChange: () => void;
	onRemove: () => void;
	onIdle: (minutes: number) => Promise<void>;
	onClose: () => void;
}) {
	const [pendingDelete, setPendingDelete] = useState<LockedBookmark | null>(
		null,
	);
	const manage: MenuAction[] = [
		{
			id: 'change',
			label: `Change ${CREDENTIAL_LABELS[status.kind]}`,
			icon: KeyRound,
			onSelect: onChange,
		},
		{
			id: 'remove',
			label: 'Remove the lock',
			icon: Trash2,
			destructive: true,
			onSelect: onRemove,
		},
	];
	return (
		<>
			<DialogBody>
				<div className="flex flex-wrap items-center gap-2">
					<h3
						tabIndex={-1}
						data-screen-title=""
						className="mr-auto text-sm font-semibold outline-none"
					>
						{plural(items.length, 'locked bookmark')}
					</h3>
					<Button size="sm" onClick={onAdd}>
						<Plus aria-hidden="true" />
						Add
					</Button>
					<ActionDropdownMenu
						trigger={
							<Button
								variant="outline"
								size="icon"
								className="h-8 w-8"
								aria-label="Manage the lock"
							>
								<MoreHorizontal />
							</Button>
						}
						actions={manage}
					/>
				</div>
				{items.length === 0 ? (
					<p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
						Nothing here yet. Add a link, or use “Bookmark to locked area” in
						the popup or the right-click menu.
					</p>
				) : (
					<ScrollArea className="max-h-72 rounded-md border border-border">
						<ul
							className="divide-y divide-border"
							aria-label="Locked bookmarks"
						>
							{items.map((item) => (
								<li key={item.id} className="flex items-center gap-2 px-3 py-2">
									<a
										href={item.url}
										target="_blank"
										rel="noopener noreferrer"
										className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<span className="block truncate text-[13px] font-semibold">
											{item.title}
											<span className="sr-only"> (opens in a new tab)</span>
										</span>
										<span className="block truncate text-[11px] text-muted-foreground">
											{hostOf(item.url)}
										</span>
									</a>
									<IconTooltip label="Edit">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`Edit ${item.title}`}
											onClick={() => onEdit(item)}
										>
											<Pencil />
										</Button>
									</IconTooltip>
									<IconTooltip label="Move to the board">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`Move ${item.title} to the board`}
											onClick={() => onMove(item)}
										>
											<ArrowRightLeft />
										</Button>
									</IconTooltip>
									<IconTooltip label="Delete">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-destructive hover:text-destructive"
											aria-label={`Delete ${item.title}`}
											onClick={() => setPendingDelete(item)}
										>
											<Trash2 />
										</Button>
									</IconTooltip>
								</li>
							))}
						</ul>
					</ScrollArea>
				)}
				<div className="grid gap-1">
					<IdleField
						value={status.idleMinutes}
						onChange={(m) => void onIdle(m)}
					/>
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="outline" onClick={onClose}>
					<X aria-hidden="true" />
					Close
				</Button>
				<Button onClick={onLock}>
					<Lock aria-hidden="true" />
					Lock now
				</Button>
			</DialogFooter>
			<ConfirmationDialog
				open={pendingDelete !== null}
				title="Delete this locked bookmark?"
				description="The locked area has no trash. This cannot be undone."
				confirmLabel="Delete"
				onOpenChange={(open) => !open && setPendingDelete(null)}
				onConfirm={() => {
					const item = pendingDelete;
					setPendingDelete(null);
					if (item) {
						void onDelete(item);
					}
				}}
			/>
		</>
	);
}

function EditView({
	item,
	onBack,
	onSaved,
}: {
	item?: LockedBookmark;
	onBack: () => void;
	onSaved: (message: string) => Promise<void>;
}) {
	const [title, setTitle] = useState(item?.title ?? '');
	const [url, setUrl] = useState(item?.url ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function submit(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}

		const address = webUrl(url);
		if (!address) {
			setError('Enter a web address that starts with http:// or https://.');
			return;
		}

		setBusy(true);
		setError('');
		const result = item
			? await send('LOCKED_UPDATE', {
					id: item.id,
					fields: {title, url: address},
				})
			: await send('LOCKED_ADD', {
					bookmarks: [{title: title || undefined, url: address}],
				});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not save that bookmark.'));
			return;
		}

		const skipped = 'skipped' in result && result.skipped > 0;
		await onSaved(
			skipped
				? 'That address is already in the locked area.'
				: item
					? 'Saved your changes.'
					: 'Added to the locked area.',
		);
	}

	return (
		<form onSubmit={(event) => void submit(event)}>
			<DialogBody>
				<div className="space-y-1.5">
					<Label htmlFor="locked-edit-title">Title</Label>
					<Input
						id="locked-edit-title"
						maxLength={500}
						autoComplete="off"
						data-autofocus=""
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="locked-edit-url">Web address</Label>
					<Input
						required
						id="locked-edit-url"
						type="url"
						placeholder="https://example.com"
						autoComplete="off"
						value={url}
						aria-invalid={error ? true : undefined}
						onChange={(event) => setUrl(event.target.value)}
					/>
				</div>
				{error && <ErrorLine>{error}</ErrorLine>}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onBack}>
					<ArrowLeft aria-hidden="true" />
					Back
				</Button>
				<Button type="submit" disabled={busy}>
					<Save aria-hidden="true" />
					{item ? 'Save changes' : 'Add'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function MoveView({
	item,
	columns,
	onBack,
	onMoved,
}: {
	item: LockedBookmark;
	columns: readonly BookmarkColumn[];
	onBack: () => void;
	onMoved: () => Promise<void>;
}) {
	const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function move(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_MOVE_TO_BOARD', {
			ids: [item.id],
			columnId: columnId || null,
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not move that bookmark.'));
			return;
		}

		await onMoved();
	}

	return (
		<form onSubmit={(event) => void move(event)}>
			<DialogBody>
				<LinkSummary title={item.title} url={item.url} />
				{columns.length > 0 && (
					<div className="space-y-1.5">
						<Label htmlFor="locked-move-column">Board column</Label>
						<ColumnSelect
							id="locked-move-column"
							columns={columns}
							value={columnId}
							onValueChange={setColumnId}
						/>
					</div>
				)}
				<Note>
					Once it is on the board it shows up in search, exports and backups
					like any other bookmark.
				</Note>
				{error && <ErrorLine>{error}</ErrorLine>}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onBack}>
					<ArrowLeft aria-hidden="true" />
					Back
				</Button>
				<Button type="submit" disabled={busy}>
					<ArrowRightLeft aria-hidden="true" />
					Move to the board
				</Button>
			</DialogFooter>
		</form>
	);
}

function ChangeView({
	kind,
	onBack,
	onChanged,
}: {
	kind: CredentialKind;
	onBack: () => void;
	onChanged: (status: LockedStatus) => void;
}) {
	const [current, setCurrent] = useState('');
	const [draft, setDraft] = useState<PasscodeDraft>({
		...EMPTY_PASSCODE_DRAFT,
		kind,
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [retryAfterMs, setRetryAfterMs] = useState<number | undefined>();
	const wait = useCooldown(retryAfterMs);
	const problem = passcodeDraftProblem(draft);

	async function change(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || problem || current.length === 0 || wait > 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_CHANGE_CREDENTIAL', {
			current,
			kind: draft.kind,
			value: draft.value,
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not change it.'));
			setRetryAfterMs((result as ActionFailure | undefined)?.retryAfterMs);
			setCurrent('');
			return;
		}

		setCurrent('');
		setDraft({...EMPTY_PASSCODE_DRAFT, kind});
		onChanged(result.locked);
	}

	return (
		<form onSubmit={(event) => void change(event)}>
			<DialogBody>
				<PasscodeEntry
					value={current}
					kind={kind}
					label={`Current ${CREDENTIAL_LABELS[kind]}`}
					error={error}
					disabled={busy || wait > 0}
					onChange={setCurrent}
				/>
				{wait > 0 && (
					<p className="text-xs text-muted-foreground" role="status">
						Too many wrong entries. Try again in {wait}{' '}
						{wait === 1 ? 'second' : 'seconds'}.
					</p>
				)}
				<Note>{LOCKED_PROFILE_NOTE}</Note>
				<PasscodeSetup draft={draft} disabled={busy} onChange={setDraft} />
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onBack}>
					<ArrowLeft aria-hidden="true" />
					Back
				</Button>
				<Button
					type="submit"
					disabled={
						busy || Boolean(problem) || current.length === 0 || wait > 0
					}
				>
					<KeyRound aria-hidden="true" />
					{busy ? 'Changing' : 'Change'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function RemoveView({
	kind,
	count,
	columns,
	onBack,
	onRemoved,
}: {
	kind: CredentialKind;
	count: number;
	columns: readonly BookmarkColumn[];
	onBack: () => void;
	onRemoved: (moved: number, discarded: number) => void;
}) {
	const [credential, setCredential] = useState('');
	const [choice, setChoice] = useState<'board' | 'delete'>(
		count > 0 ? 'board' : 'delete',
	);
	const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [retryAfterMs, setRetryAfterMs] = useState<number | undefined>();
	const wait = useCooldown(retryAfterMs);

	async function remove(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || credential.length === 0 || wait > 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_REMOVE_LOCK', {
			credential,
			bookmarks: choice,
			columnId: columnId || null,
		});
		setBusy(false);
		setCredential('');
		if (!result?.ok) {
			setError(failureText(result, 'Could not remove the lock.'));
			setRetryAfterMs((result as ActionFailure | undefined)?.retryAfterMs);
			return;
		}

		onRemoved(result.moved, result.discarded);
	}

	return (
		<form onSubmit={(event) => void remove(event)}>
			<DialogBody>
				{count > 0 && (
					<>
						<SegmentedControl
							fullWidth
							label="What happens to the bookmarks"
							value={choice}
							options={[
								{
									value: 'board',
									label: `Move ${plural(count, 'bookmark')} to the board`,
								},
								{value: 'delete', label: 'Delete them'},
							]}
							onValueChange={setChoice}
						/>
						{choice === 'board' && columns.length > 0 && (
							<div className="space-y-1.5">
								<Label htmlFor="locked-remove-column">Board column</Label>
								<ColumnSelect
									id="locked-remove-column"
									columns={columns}
									value={columnId}
									onValueChange={setColumnId}
								/>
							</div>
						)}
					</>
				)}
				<PasscodeEntry
					value={credential}
					kind={kind}
					label={`Current ${CREDENTIAL_LABELS[kind]}`}
					error={error}
					disabled={busy || wait > 0}
					onChange={setCredential}
				/>
				{wait > 0 && (
					<p className="text-xs text-muted-foreground" role="status">
						Too many wrong entries. Try again in {wait}{' '}
						{wait === 1 ? 'second' : 'seconds'}.
					</p>
				)}
				<Note>
					{choice === 'board'
						? 'The bookmarks become visible on the board, in search, and in exports.'
						: 'Deleted bookmarks cannot be recovered. The locked area has no trash.'}
				</Note>
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onBack}>
					<ArrowLeft aria-hidden="true" />
					Back
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={busy || credential.length === 0 || wait > 0}
				>
					<Trash2 aria-hidden="true" />
					{busy ? 'Removing' : 'Remove the lock'}
				</Button>
			</DialogFooter>
		</form>
	);
}
