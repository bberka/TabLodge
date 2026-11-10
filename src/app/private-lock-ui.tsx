// The PIN or password lock of private windows, on the page side: the lock screen that replaces a private page
// until it is unlocked, the Lock button, and the Settings panel to turn it on, change it, or remove it.
// All state lives in the worker (see src/app/private-lock.ts); the credential only passes through form state.
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {Lock, LockOpen, ShieldAlert} from 'lucide-react';
import {Button, IconTooltip} from '../shared/ui';
import {send} from './message-client';
import {
	ChangeDialog,
	EnableDialog,
	IdleSelect,
	RemoveDialog,
} from './private-lock-dialogs';
import type {ShowStatus} from './common';
import {PasscodeEntry} from './passcode-fields';
import {
	LOCK_ACTIVITY_KEY,
	LOCK_RECORD_KEY,
	LOCK_SESSION_KEY,
} from './private-lock';
import {PROJECT} from './project';
import type {PrivateLockInfo} from './types';

const kindWord = (kind: PrivateLockInfo['kind']) =>
	kind === 'pin' ? 'PIN' : kind === 'password' ? 'password' : 'PIN or password';

const privateWindow = () =>
	Boolean(globalThis.chrome?.extension?.inIncognitoContext);

/**
The lock state from the worker, kept current: it reloads when the lock record or the key changes, and when the idle time runs out.
*/
export function usePrivateLockInfo() {
	const [info, setInfo] = useState<PrivateLockInfo>();
	const [error, setError] = useState('');
	const refresh = useCallback(async () => {
		const result = await send('GET_PRIVATE_LOCK');
		if (result.ok) {
			setInfo(result);
			setError('');
		} else {
			setError(result.error);
		}
	}, []);
	useEffect(() => {
		void refresh();
		const changed = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (
				(area === 'local' && Object.hasOwn(changes, LOCK_RECORD_KEY)) ||
				(area === 'session' && Object.hasOwn(changes, LOCK_SESSION_KEY))
			) {
				void refresh();
				return;
			}

			// Use elsewhere moves the idle deadline, which the page can work out without asking.
			const activity =
				area === 'session' ? changes[LOCK_ACTIVITY_KEY]?.newValue : undefined;
			if (typeof activity === 'number') {
				setInfo((previous) =>
					previous && !previous.locked && previous.idleMinutes > 0
						? {...previous, expiresAt: activity + previous.idleMinutes * 60_000}
						: previous,
				);
			}
		};

		chrome.storage.onChanged.addListener(changed);
		return () => chrome.storage.onChanged.removeListener(changed);
	}, [refresh]);
	const expiresAt = info?.locked ? null : (info?.expiresAt ?? null);
	useEffect(() => {
		if (expiresAt === null) {
			return;
		}

		// The worker locks when asked after the deadline, so asking is what locks the page.
		const timer = setTimeout(
			() => void refresh(),
			Math.max(1000, expiresAt - Date.now() + 500),
		);
		return () => clearTimeout(timer);
	}, [expiresAt, refresh]);
	return {info, error, refresh, setInfo};
}

const ACTIVITY_TOUCH_MS = 20_000;

/**
Counts using the page as activity, so reading without saving anything does not run into the idle timeout.
*/
function useActivityTouch(active: boolean) {
	useEffect(() => {
		if (!active) {
			return;
		}

		let last = 0;
		const touch = () => {
			if (!(Date.now() - last >= ACTIVITY_TOUCH_MS)) {
				return;
			}

			last = Date.now();
			void send('TOUCH_PRIVATE_LOCK');
		};

		const events = ['pointerdown', 'keydown'] as const;
		for (const name of events) {
			globalThis.addEventListener(name, touch, {passive: true});
		}

		return () => {
			for (const name of events) {
				globalThis.removeEventListener(name, touch);
			}
		};
	}, [active]);
}

function LockScreen({
	info,
	onUnlocked,
}: {
	info: PrivateLockInfo;
	onUnlocked: (info: PrivateLockInfo) => void;
}) {
	const [credential, setCredential] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const headingId = useId();
	const damaged = info.state === 'damaged';
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	const unlock = async () => {
		if (busy || credential.length === 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('UNLOCK_PRIVATE', {credential});
		setBusy(false);
		if (result.ok) {
			setCredential('');
			onUnlocked(result);
			return;
		}

		setError(result.error);
		setCredential('');
		inputRef.current?.focus();
	};

	return (
		<main
			className="grid min-h-screen place-items-center p-4"
			aria-labelledby={headingId}
		>
			<section className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
				<div className="grid gap-2">
					<Lock className="h-6 w-6 text-primary" aria-hidden="true" />
					<h1 id={headingId} className="text-lg font-semibold">
						Private {PROJECT.name} is locked
					</h1>
					<p className="text-sm text-muted-foreground">
						{damaged
							? 'The lock on the private library cannot be read, so it stays closed to protect your data.'
							: `Enter the ${kindWord(info.kind)} you chose to open your private sessions and bookmarks.`}
					</p>
					{!damaged && info.state !== 'encrypted' && (
						<p className="text-sm text-muted-foreground">
							A change to the lock was interrupted. Unlocking finishes it.
						</p>
					)}
				</div>
				{!damaged && (
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void unlock();
						}}
					>
						<PasscodeEntry
							inputRef={inputRef}
							value={credential}
							error={error}
							disabled={busy}
							onChange={(value) => {
								setCredential(value);
								setError('');
							}}
						/>
						<Button type="submit" disabled={busy || credential.length === 0}>
							<LockOpen aria-hidden="true" />
							{busy ? 'Unlocking…' : 'Unlock'}
						</Button>
					</form>
				)}
			</section>
		</main>
	);
}

/**
Shows the lock screen in place of its children while the private library is locked, and the children once it is open.
Regular windows pass straight through. The children unmount on lock, so nothing they showed stays in the page.
*/
export function PrivateLockGate({children}: {children: ReactNode}) {
	const inPrivate = privateWindow();
	const {info, error, refresh, setInfo} = usePrivateLockInfo();
	const locked = Boolean(info?.enabled && info.locked);
	const wasLockedRef = useRef(false);
	useActivityTouch(inPrivate && info?.enabled === true && !locked);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (wasLockedRef.current && !locked) {
			// The lock screen's field is gone, so focus would fall to the body. The page loads its content
			// after it mounts, so wait for its main area, unless the page already took focus itself.
			let attempts = 0;
			const focusMain = () => {
				if (
					document.activeElement &&
					document.activeElement !== document.body
				) {
					return;
				}

				const target =
					document.querySelector<HTMLElement>('#main-content') ??
					// The popup and side panel have no main anchor: after a second, take their first control.
					(attempts >= 10
						? document.querySelector<HTMLElement>(
								'button:not([disabled]), a[href], input:not([disabled])',
							)
						: null);
				if (target) {
					target.focus({preventScroll: true});
				} else if (attempts++ < 40) {
					timer = setTimeout(focusMain, 100);
				}
			};

			focusMain();
		}

		wasLockedRef.current = locked;
		return () => clearTimeout(timer);
	}, [locked]);
	if (!inPrivate) {
		return children;
	}

	if (error) {
		return (
			<main className="grid min-h-screen place-items-center p-4">
				<div className="grid max-w-sm gap-3">
					<p role="alert" className="text-sm">
						{error}
					</p>
					<Button variant="outline" onClick={() => void refresh()}>
						Retry
					</Button>
				</div>
			</main>
		);
	}

	if (!info) {
		return (
			<p className="sr-only" role="status">
				Loading private {PROJECT.name}…
			</p>
		);
	}

	return info.enabled && info.locked ? (
		<LockScreen info={info} onUnlocked={setInfo} />
	) : (
		children
	);
}

/**
Lock now, in the header of private pages. Shows nothing in regular windows or when no lock is set.
*/
export function PrivateLockButton() {
	const {info} = usePrivateLockInfo();
	if (!privateWindow() || !info?.enabled || info.locked) {
		return null;
	}

	return (
		<IconTooltip label="Lock private windows now">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Lock private windows now"
				onClick={() => void send('LOCK_PRIVATE')}
			>
				<Lock aria-hidden="true" />
			</Button>
		</IconTooltip>
	);
}

type DialogName = 'enable' | 'change' | 'remove';

export function PrivateLockSettings({
	showStatus,
	lock,
}: {
	showStatus: ShowStatus;
	/**
	The page's lock state, shared with the storage mode form so the two always agree.
	*/
	lock: ReturnType<typeof usePrivateLockInfo>;
}) {
	const {info} = lock;
	const [dialog, setDialog] = useState<DialogName>();
	const [savingIdle, setSavingIdle] = useState(false);
	const [error, setError] = useState('');
	if (!info || (!info.available && !info.enabled)) {
		return null;
	}

	const finished = (message: string) => (next: PrivateLockInfo) => {
		lock.setInfo(next);
		setDialog(undefined);
		showStatus(message);
	};

	const saveIdle = async (minutes: number) => {
		setSavingIdle(true);
		setError('');
		const result = await send('SET_PRIVATE_LOCK_IDLE', {minutes});
		setSavingIdle(false);
		if (result.ok) {
			lock.setInfo(result);
			showStatus('Lock time saved.');
		} else {
			setError(result.error);
		}
	};

	const retry = async () => {
		setError('');
		const result = await send('TOUCH_PRIVATE_LOCK');
		if (result.ok) {
			lock.setInfo(result);
		} else {
			setError(result.error);
		}
	};

	const label = kindWord(info.kind);
	return (
		<div
			data-private-lock-settings
			className="space-y-3 border-t border-border pt-5"
		>
			<div className="space-y-1">
				<h3 className="flex items-center gap-2 font-medium">
					<Lock className="h-4 w-4" aria-hidden="true" />
					Lock with a PIN or password
				</h3>
				<p className="text-sm text-muted-foreground">
					Encrypts the separate saved library on this device and shows a lock
					screen in private windows until you unlock it. Only the saved separate
					library can be locked.
				</p>
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{info.state === 'damaged' && (
				<p
					role="alert"
					className="flex items-start gap-2 text-sm text-destructive"
				>
					<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					The lock cannot be read, so the private library stays closed.
				</p>
			)}
			{!info.manageHere && (
				<p className="text-sm text-muted-foreground" role="status">
					{info.enabled
						? `The private library is locked with a ${label}. It is ${info.locked ? 'locked' : 'unlocked'} now.`
						: 'The private library is not locked.'}{' '}
					Open Settings in a private window to turn the lock on, change it, or
					remove it.
				</p>
			)}
			{info.manageHere && !info.enabled && (
				<>
					<p className="text-sm text-muted-foreground">
						Nothing can recover a lost PIN or password. Short PINs give little
						protection if someone copies your browser profile.
					</p>
					<Button onClick={() => setDialog('enable')}>
						<Lock aria-hidden="true" />
						Turn on lock…
					</Button>
				</>
			)}
			{info.manageHere && info.enabled && info.state !== 'damaged' && (
				<div className="space-y-3">
					<p className="text-sm" role="status">
						Locked with a {label}. Unlocked now.
					</p>
					{info.state !== 'encrypted' && (
						<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
							<span>
								{info.state === 'encrypting'
									? 'Encrypting was interrupted.'
									: 'Removing the lock was interrupted.'}
							</span>
							<Button variant="outline" size="sm" onClick={() => void retry()}>
								Finish
							</Button>
						</div>
					)}
					<div className="grid gap-1.5">
						<span className="text-sm font-medium">Lock after</span>
						<IdleSelect
							label="Lock after"
							value={info.idleMinutes}
							disabled={savingIdle}
							onChange={(minutes) => void saveIdle(minutes)}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => void send('LOCK_PRIVATE')}>
							<Lock aria-hidden="true" />
							Lock now
						</Button>
						<Button variant="outline" onClick={() => setDialog('change')}>
							Change {label}…
						</Button>
						<Button variant="outline" onClick={() => setDialog('remove')}>
							<LockOpen aria-hidden="true" />
							Remove lock…
						</Button>
					</div>
				</div>
			)}
			{info.manageHere && (
				<>
					<EnableDialog
						open={dialog === 'enable'}
						onOpenChange={(open) => setDialog(open ? 'enable' : undefined)}
						onDone={finished('Private windows are locked.')}
					/>
					<ChangeDialog
						open={dialog === 'change'}
						onOpenChange={(open) => setDialog(open ? 'change' : undefined)}
						onDone={finished('PIN or password changed.')}
					/>
					<RemoveDialog
						open={dialog === 'remove'}
						onOpenChange={(open) => setDialog(open ? 'remove' : undefined)}
						onDone={finished('Lock removed.')}
					/>
				</>
			)}
		</div>
	);
}

/**
Why the storage mode cannot change right now, or null when it can.
*/
export function modeLockedReason(info: PrivateLockInfo | undefined) {
	return info?.enabled
		? 'The saved private library is locked with a PIN or password. Remove the lock in a private window before choosing another storage mode, so no data is lost or left unreadable.'
		: null;
}
