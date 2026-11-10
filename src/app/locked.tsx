// The locked area on the pages: a hook that follows its state, the save form used by the popup, the save window and the
// dashboard, and the full dialog (set up, unlock, browse, manage). Pages never hold the key or read decrypted data except
// through LOCKED_* messages while the worker has it unlocked.
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
	type SyntheticEvent,
} from 'react';
import {
	CircleAlert,
	Lock,
	LockOpen,
	Save,
	TriangleAlert,
	X,
} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '../shared/ui';
import {LOCKED_FLAG_KEY, LOCKED_KEY} from '../shared/locked-store';
import type {ActionFailure, LockedStatus, Settings} from './types';
import {PasscodeEntry} from './passcode-fields';
import {plural, send, type ShowStatus} from './common';
import {LinkSummary} from './favicon';

/**
Shown wherever the locked area is created. The envelope text covers the lost credential; this covers copied profile files.
*/
export const LOCKED_PROFILE_NOTE =
	'Everything is encrypted in your browser profile. Someone who copies the profile files can try PINs offline, so a short PIN is weak. Choose a password for anything sensitive.';

export const LOCKED_HIDDEN_NOTE =
	'Locked bookmarks stay out of search, the palette, the address bar, the saved page indicator, duplicate checks, statistics, snapshots, the trash, exports, and automatic backups. Full backups include them, still encrypted.';

export function idleLabel(minutes: number): string {
	if (minutes === 0) {
		return 'Only when the browser closes';
	}

	return minutes === 60 ? 'After 1 hour' : `After ${plural(minutes, 'minute')}`;
}

type Result = {ok: boolean; error?: string};

/**
The message to show for a failed locked action, with the wait spelled out after too many wrong entries.
*/
export function failureText(
	result: Result | undefined,
	fallback: string,
): string {
	return result?.error || fallback;
}

/**
Follows the locked area's state. `status` is null until the first answer; `unavailable` carries the reason when the worker
refuses (private windows). It refreshes when the unlock flag or the stored entry changes, and when the page comes back to
the front, since the idle timer can lock the area while a page sits in the background.
*/
export function useLockedStatus() {
	const [status, setStatus] = useState<LockedStatus | null>(null);
	const [unavailable, setUnavailable] = useState('');
	const refresh = useCallback(async () => {
		const result = await send('LOCKED_STATUS');
		if (result?.ok) {
			setStatus(result.locked);
			setUnavailable('');
		} else {
			setUnavailable(result?.error || 'The locked area is not available.');
		}
	}, []);
	useEffect(() => {
		void refresh();
		const onChanged = (changes: Record<string, unknown>, area: string) => {
			if (
				(area === 'session' && changes[LOCKED_FLAG_KEY] !== undefined) ||
				(area === 'local' && changes[LOCKED_KEY] !== undefined)
			) {
				void refresh();
			}
		};

		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				void refresh();
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [refresh]);
	return {status, unavailable, refresh, setStatus};
}

/**
Opens the dashboard on the locked area, where it is set up. Used by pages that cannot show the full dialog.
*/
export async function openLockedSetup() {
	await chrome.tabs.create({
		url: chrome.runtime.getURL('newtab.html?locked=1'),
	});
	window.close();
}

export function useCooldown(retryAfterMs: number | undefined) {
	const [until, setUntil] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!(retryAfterMs && retryAfterMs > 0)) {
			return;
		}

		setUntil(Date.now() + retryAfterMs);
		setNow(Date.now());
	}, [retryAfterMs]);
	useEffect(() => {
		if (until <= Date.now()) {
			return;
		}

		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, [until]);
	return Math.max(0, Math.ceil((until - now) / 1000));
}

export function ErrorLine({children}: {children: ReactNode}) {
	return (
		<p
			role="alert"
			className="flex items-start gap-2 text-xs leading-5 text-destructive"
		>
			<CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			<span className="min-w-0">{children}</span>
		</p>
	);
}

export function Note({children}: {children: ReactNode}) {
	return (
		<p className="flex items-start gap-2 rounded-md border border-border bg-muted/70 px-3 py-2 text-xs leading-5">
			<TriangleAlert
				className="mt-0.5 h-3.5 w-3.5 shrink-0"
				aria-hidden="true"
			/>
			<span className="min-w-0">{children}</span>
		</p>
	);
}

/**
Saving one bookmark into the locked area, from the popup, the save window or the dashboard dialog. When the area is
locked the PIN or password is asked here, and the worker unlocks and saves in one message. When it does not exist yet
the person is sent to the dashboard to set it up, since that needs the warnings and a confirmation.
*/
export function LockedSaveForm({
	title: initialTitle,
	url,
	settings,
	onSaved,
	onCancel,
	onSetup,
}: {
	title: string;
	url: string;
	settings?: Partial<Settings>;
	onSaved: (message: string) => void;
	onCancel: () => void;
	/**
	Opens the place where the area is set up. The default opens the dashboard in a tab.
	*/
	onSetup?: () => void;
}) {
	const {status, unavailable} = useLockedStatus();
	const [title, setTitle] = useState(initialTitle);
	const [credential, setCredential] = useState('');
	const [error, setError] = useState('');
	const [retryAfterMs, setRetryAfterMs] = useState<number | undefined>();
	const [busy, setBusy] = useState(false);
	const needsCredential = status?.configured === true && !status.unlocked;
	const formRef = useRef<HTMLFormElement>(null);
	const ready = status?.configured === true;
	// The fields only exist once the state is known, after the page or dialog already placed its focus.
	useEffect(() => {
		if (!ready) {
			return;
		}

		const form = formRef.current;
		(
			form?.querySelector<HTMLElement>('[data-autofocus]') ??
			form?.querySelector<HTMLElement>('input')
		)?.focus();
	}, [ready, needsCredential]);
	const wait = useCooldown(
		retryAfterMs ?? (needsCredential ? status.retryAfterMs : undefined),
	);

	async function save(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !status?.configured) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('LOCKED_ADD', {
			bookmarks: [{title, url}],
			...(needsCredential && {credential}),
		});
		setBusy(false);
		if (!result?.ok) {
			setError(failureText(result, 'Could not save to the locked area.'));
			setRetryAfterMs((result as ActionFailure | undefined)?.retryAfterMs);
			setCredential('');
			return;
		}

		setCredential('');
		onSaved(
			result.skipped > 0
				? 'That address is already in the locked area.'
				: 'Saved to the locked area.',
		);
	}

	if (unavailable) {
		return (
			<>
				<DialogBody>
					<Note>{unavailable}</Note>
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						<X aria-hidden="true" />
						Close
					</Button>
				</DialogFooter>
			</>
		);
	}

	if (!status) {
		return (
			<DialogBody>
				<p className="sr-only" role="status">
					Loading the locked area
				</p>
			</DialogBody>
		);
	}

	if (!status.configured) {
		return (
			<>
				<DialogBody>
					<LinkSummary title={initialTitle} url={url} settings={settings} />
					<Note>
						The locked area is not set up yet. Setting it up needs a PIN or
						password and a few warnings, so it happens on the dashboard.
					</Note>
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel}>
						<X aria-hidden="true" />
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => (onSetup ? onSetup() : void openLockedSetup())}
					>
						<Lock aria-hidden="true" />
						Set up the locked area
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<form ref={formRef} onSubmit={(event) => void save(event)}>
			<DialogBody>
				<LinkSummary title={title} url={url} settings={settings} />
				<div className="space-y-1.5">
					<Label htmlFor="locked-save-title">Title</Label>
					<Input
						required
						id="locked-save-title"
						maxLength={500}
						autoComplete="off"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</div>
				{needsCredential ? (
					<>
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
					</>
				) : (
					error && <ErrorLine>{error}</ErrorLine>
				)}
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onCancel}>
					<X aria-hidden="true" />
					Cancel
				</Button>
				<Button
					type="submit"
					disabled={
						busy || wait > 0 || (needsCredential && credential.length === 0)
					}
				>
					{needsCredential ? (
						<LockOpen aria-hidden="true" />
					) : (
						<Save aria-hidden="true" />
					)}
					{busy
						? 'Saving'
						: needsCredential
							? 'Unlock and save'
							: 'Save to locked area'}
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
The locked save in a dialog, for pages that stay open (the popup and the dashboard).
*/
export function LockedSaveDialog({
	open,
	onOpenChange,
	title,
	url,
	settings,
	showStatus,
	onSetup,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	url: string;
	settings?: Partial<Settings>;
	showStatus: ShowStatus;
	onSetup?: () => void;
	onSaved?: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Bookmark to locked area</DialogTitle>
					<DialogDescription>
						Saved in the encrypted locked area, not on the board.
					</DialogDescription>
				</DialogHeader>
				{open && (
					<LockedSaveForm
						title={title}
						url={url}
						settings={settings}
						onSetup={onSetup}
						onCancel={() => onOpenChange(false)}
						onSaved={(message) => {
							showStatus(message, false, {toast: true});
							onOpenChange(false);
							onSaved?.();
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
