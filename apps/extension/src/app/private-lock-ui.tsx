// The password lock of private windows, on the page side: the lock screen that replaces a private page
// until it is unlocked, the Lock button, and the Settings panel to turn it on, change it, or remove it.
// All state lives in the worker (see src/shared/private-lock.ts); the credential only passes through form state.
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {
	ArrowRightLeft,
	Check,
	Cloud,
	KeyRound,
	Laptop,
	Lock,
	LockOpen,
	RefreshCw,
	ShieldAlert,
	Trash2,
} from 'lucide-react';
import {Button, IconTooltip, Label, Switch} from '../shared/ui';
import {
	LOCK_ACTIVITY_KEY,
	LOCK_RECORD_KEY,
	LOCK_SESSION_KEY,
} from '../shared/private-lock';
import type {PrivateLockInfo, PrivateServerInfo} from '../shared/types';
import {send} from './message-client';
import {
	ChangeDialog,
	EnableDialog,
	IdleSelect,
	RemoveDialog,
	JoinServerForm,
	ResetDialog,
	SetLockForm,
} from './private-lock-dialogs';
import type {ShowStatus} from './common';
import {PasscodeEntry} from './passcode-fields';
import {PROJECT} from './project';

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
	const [erasing, setErasing] = useState(false);
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
			<section className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs">
				<div className="grid gap-2">
					<Lock className="h-6 w-6 text-primary" aria-hidden="true" />
					<h1 id={headingId} className="text-lg font-semibold">
						Private {PROJECT.name} is locked
					</h1>
					<p className="text-sm text-muted-foreground">
						{damaged
							? 'The lock on the private library cannot be read, so it stays closed to protect your data.'
							: 'Enter the password you chose to open your private sessions and bookmarks.'}
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
				<Button
					type="button"
					variant="destructive"
					onClick={() => setErasing(true)}
				>
					<Trash2 aria-hidden="true" />
					Forgot it? Erase private data
				</Button>
				<ResetDialog
					open={erasing}
					onOpenChange={setErasing}
					onDone={(next) => {
						setErasing(false);
						onUnlocked(next);
					}}
				/>
			</section>
		</main>
	);
}

/**
Asks for a first password before the saved separate library opens. When the sync server already holds a private
library, the first choice is its password, so every browser ends up with one. The only other ways past are to
keep the library on this device with its own password, or to stop using a separate saved library.
*/
function SetLockScreen({onDone}: {onDone: (info: PrivateLockInfo) => void}) {
	const headingId = useId();
	const syncId = useId();
	const [error, setError] = useState('');
	const [server, setServer] = useState<PrivateServerInfo>();
	const [deviceOnly, setDeviceOnly] = useState(false);
	const [syncNew, setSyncNew] = useState(true);
	useEffect(() => {
		void send('GET_PRIVATE_SERVER').then((result) => {
			setServer(
				result.ok ? result.privateServer : {connected: false, hasKey: false},
			);
		});
	}, []);
	if (!server) {
		return (
			<p className="sr-only" role="status">
				Loading private {PROJECT.name}…
			</p>
		);
	}

	const switchToRegular = async () => {
		const result = await send('SET_PRIVATE_CONFIG', {mode: 'shared'});
		if (result.ok) {
			const lock = await send('GET_PRIVATE_LOCK');
			if (lock.ok) {
				onDone(lock);
			}
		} else {
			setError(result.error);
		}
	};

	const fromServer = server.hasKey && !deviceOnly;
	return (
		<main
			className="grid min-h-screen place-items-center p-4"
			aria-labelledby={headingId}
		>
			<section className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs">
				<div className="grid gap-2">
					<Lock className="h-6 w-6 text-primary" aria-hidden="true" />
					<h1 id={headingId} className="text-lg font-semibold">
						{fromServer ? 'Use your sync server’s password' : 'Set a password'}
					</h1>
					<p className="text-sm text-muted-foreground">
						{fromServer
							? 'Your sync server already holds a private library. Enter its password once: it becomes this library’s lock, and the server’s data joins what is here.'
							: 'The separate private library is encrypted on this device and opens only with a password. Nothing can recover a lost one. It also protects what private sync sends.'}
					</p>
					{server.hasKey && deviceOnly && (
						<p className="text-sm text-muted-foreground">
							Kept only on this device, this library does not match the one on
							your server. Syncing it later needs the server’s password.
						</p>
					)}
				</div>
				{fromServer ? (
					<JoinServerForm onDone={onDone} />
				) : (
					<>
						{server.connected && !server.hasKey && (
							<div className="flex items-start justify-between gap-3">
								<div className="grid gap-1">
									<Label htmlFor={syncId}>Sync private windows</Label>
									<p className="text-xs leading-5 text-muted-foreground">
										{syncNew
											? 'This library goes to your sync server, encrypted, and your other browsers and phone can join it with this password.'
											: 'Kept only on this device. It will not match your other devices until you turn on Sync private windows in Settings.'}
									</p>
								</div>
								<Switch
									id={syncId}
									checked={syncNew}
									onCheckedChange={setSyncNew}
								/>
							</div>
						)}
						<SetLockForm
							sync={server.connected && !server.hasKey && syncNew}
							onDone={onDone}
						/>
					</>
				)}
				{server.hasKey && (
					<Button
						type="button"
						variant="outline"
						onClick={() => setDeviceOnly(!deviceOnly)}
					>
						{deviceOnly ? (
							<>
								<Cloud aria-hidden="true" />
								Use the password from your sync server
							</>
						) : (
							<>
								<Laptop aria-hidden="true" />
								Keep only on this device instead
							</>
						)}
					</Button>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<Button
					type="button"
					variant="outline"
					onClick={() => void switchToRegular()}
				>
					<ArrowRightLeft aria-hidden="true" />
					Use the regular library instead
				</Button>
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
	// The set-a-password screen replaces the page like the lock screen, so focus returns the same way when it goes.
	const locked = Boolean((info?.enabled && info.locked) || info?.needsLock);
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
						<RefreshCw aria-hidden="true" />
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

	if (info.needsLock) {
		return <SetLockScreen onDone={setInfo} />;
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

type DialogName = 'enable' | 'change' | 'remove' | 'reset';

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

	const label = 'password';
	return (
		<div data-private-lock-settings className="space-y-3 py-5">
			<div className="space-y-1">
				<h3 className="flex items-center gap-2 text-sm font-medium">
					<Lock className="h-4 w-4" aria-hidden="true" />
					Lock with a password
				</h3>
				<p className="text-xs leading-5 text-muted-foreground">
					Encrypts the separate saved library on this device and shows a lock
					screen in private windows until you enter it. Only a separate saved
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
				<div className="space-y-1 text-sm">
					<p role="status" className="font-medium">
						{info.enabled
							? `On, with a ${label}. ${info.locked ? 'Currently locked.' : 'Currently unlocked.'}`
							: 'Off.'}
					</p>
					<p className="text-xs leading-5 text-muted-foreground">
						To turn the lock on or off, or to change it, open Settings in a
						private window.
					</p>
				</div>
			)}
			{info.manageHere && !info.enabled && (
				<>
					<p className="text-sm text-muted-foreground">
						Nothing can recover a lost password. A short or number-only password
						gives little protection if someone copies your browser profile.
					</p>
					<Button onClick={() => setDialog('enable')}>
						<Lock aria-hidden="true" />
						Turn on lock
					</Button>
				</>
			)}
			{info.manageHere && info.enabled && info.state !== 'damaged' && (
				<div className="space-y-3">
					<p className="text-sm font-medium" role="status">
						On, with a {label}. Currently unlocked.
					</p>
					{info.state !== 'encrypted' && (
						<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
							<span>
								{info.state === 'encrypting'
									? 'Encrypting was interrupted.'
									: 'Removing the lock was interrupted.'}
							</span>
							<Button variant="outline" size="sm" onClick={() => void retry()}>
								<Check aria-hidden="true" />
								Finish
							</Button>
						</div>
					)}
					<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
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
							<Button
								variant="outline"
								onClick={() => void send('LOCK_PRIVATE')}
							>
								<Lock aria-hidden="true" />
								Lock now
							</Button>
							<Button variant="outline" onClick={() => setDialog('change')}>
								<KeyRound aria-hidden="true" />
								Change {label}
							</Button>
							<Button variant="outline" onClick={() => setDialog('remove')}>
								<LockOpen aria-hidden="true" />
								Remove lock
							</Button>
							<Button variant="destructive" onClick={() => setDialog('reset')}>
								<Trash2 aria-hidden="true" />
								Erase private data
							</Button>
						</div>
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
						onDone={finished('Password changed.')}
					/>
					<ResetDialog
						open={dialog === 'reset'}
						onOpenChange={(open) => setDialog(open ? 'reset' : undefined)}
						onDone={finished('Private data erased.')}
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
		? 'The separate library has a lock, so this choice is fixed. To change it, remove the lock from Settings in a private window first, so nothing is left encrypted.'
		: null;
}
