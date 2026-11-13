import {type Ref, useEffect, useId, useRef, useState} from 'react';
import {
	CircleCheck,
	Cloud,
	CloudAlert,
	CloudOff,
	CloudUpload,
	ExternalLink,
	KeyRound,
	Link2,
	Link2Off,
	type LucideIcon,
	Lock,
	RefreshCw,
} from 'lucide-react';
import {
	createSyncToken,
	MIN_TOKEN_LENGTH,
	parseServerUrl,
	SYNC_SETTINGS_KEY,
	SYNC_STATUS_KEY,
	type SyncStatus,
} from '../shared/sync/client';
import {
	Button,
	ConfirmationDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Switch,
} from '../shared/ui';
import {DeviceNameField} from './device-name';
import {messageOf, send, type ShowStatus} from './common';
import {writeClipboard} from './interaction-actions';
import {PROJECT} from './project';
import {cn} from '@/lib/utils';

export const SYNC_TITLE = 'Sync';
export const SYNC_WORDS = [
	'sync',
	'server',
	'self hosted',
	'docker',
	'cloudflare',
	'devices',
	'token',
	'connect',
	'disconnect',
	'private windows',
	'encrypt',
];

const GUIDE_URL = `${PROJECT.repoUrl}/blob/master/docs/self-hosting.md`;
const CLOUDFLARE_DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${PROJECT.repoUrl}/tree/master/server/cloudflare-deploy`;

/**
When the last sync happened: the time alone for today, the date and time before that.
*/
function syncedAt(time: number): string {
	const date = new Date(time);
	return date.toDateString() === new Date().toDateString()
		? `today at ${date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}`
		: date.toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});
}

function summarize(status: SyncStatus): {
	title: string;
	note?: string;
	Icon: LucideIcon;
	tone?: string;
	spin?: boolean;
} {
	switch (status.phase) {
		case 'syncing': {
			return {title: 'Syncing…', Icon: RefreshCw, spin: true};
		}

		case 'offline': {
			return {
				title: 'Cannot reach the server',
				note: 'Changes made here are kept and sent once it is back.',
				Icon: CloudOff,
			};
		}

		case 'error': {
			return {
				title: 'Sync stopped',
				Icon: CloudAlert,
				tone: 'text-destructive',
			};
		}

		default: {
			if (status.pending > 0) {
				return {
					title: `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} waiting to be sent`,
					Icon: CloudUpload,
				};
			}

			return status.lastSyncAt
				? {title: 'Up to date', Icon: CircleCheck, tone: 'text-primary'}
				: {title: 'Not synced yet', Icon: Cloud};
		}
	}
}

type Field = 'url' | 'token';
type FieldErrors = Partial<Record<Field, string>>;
type FocusTarget = Field | 'sync' | undefined;
type Action = 'connect' | 'sync' | 'disconnect';

function checkAddress(text: string): string | undefined {
	if (text.trim() === '') {
		return 'Enter the server address.';
	}

	try {
		parseServerUrl(text);
		return undefined;
	} catch (error) {
		return messageOf(error);
	}
}

function checkToken(text: string): string | undefined {
	const token = text.trim();
	if (token === '') {
		return 'Enter the token the server printed when you set it up.';
	}

	return token.length < MIN_TOKEN_LENGTH
		? `This token is too short. A sync token is at least ${MIN_TOKEN_LENGTH} characters, so copy all of it.`
		: undefined;
}

const CHECKS: Record<Field, (text: string) => string | undefined> = {
	url: checkAddress,
	token: checkToken,
};

/**
Fails a connect attempt on one field, so the form shows the message under that field.
*/
class FieldError extends Error {
	constructor(
		readonly field: Field,
		message: string,
	) {
		super(message);
	}
}

const FIELD_ERROR_CLASS =
	'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive';

export function SyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [status, setStatus] = useState<SyncStatus>();
	const [address, setAddress] = useState('');
	const [token, setToken] = useState('');
	const [action, setAction] = useState<Action>();
	const busy = action !== undefined;
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);
	// Missing in storage means on.
	const [syncSettings, setSyncSettings] = useState(true);
	const settingsSwitchId = useId();
	const settingsHelpId = useId();
	const [error, setError] = useState('');
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	// After connecting, whether to offer syncing the separate private library too.
	const [askPrivate, setAskPrivate] = useState(false);
	const addressRef = useRef<HTMLInputElement>(null);
	const tokenRef = useRef<HTMLInputElement>(null);
	const syncNowRef = useRef<HTMLButtonElement>(null);
	const focusAfterRef = useRef<FocusTarget>(undefined);
	const addressId = useId();
	const tokenId = useId();
	const addressErrorId = useId();
	const tokenErrorId = useId();
	const helpId = useId();

	useEffect(() => {
		const refresh = () => {
			void send('SYNC_STATUS').then((result) => {
				if (result.ok) {
					setStatus(result.status);
				}
			});
		};

		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, SYNC_STATUS_KEY)) {
				refresh();
			}
		};

		refresh();
		void chrome.storage.local.get(SYNC_SETTINGS_KEY).then((stored) => {
			setSyncSettings(stored[SYNC_SETTINGS_KEY] !== false);
		});
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	// Moves focus once an action is over and the view it leads to is on screen (see `run`).
	useEffect(() => {
		if (busy) {
			return;
		}

		const target = focusAfterRef.current;
		if (target) {
			const refs = {sync: syncNowRef, url: addressRef, token: tokenRef};
			refs[target].current?.focus();
		}

		focusAfterRef.current = undefined;
	}, [busy, status?.connected]);

	if (!status) {
		return null;
	}

	/**
	Runs an action. Its buttons are disabled meanwhile, which drops focus, so focus then goes to `focus.done` or,
	when the action failed, to `focus.failed`.
	*/
	const run = async (
		name: Action,
		work: () => Promise<SyncStatus>,
		done: string,
		focus: {done: FocusTarget; failed: FocusTarget},
	) => {
		setAction(name);
		setError('');
		setFieldErrors({});
		try {
			const next = await work();
			focusAfterRef.current = focus.done;
			setStatus(next);
			showStatus(next.error ?? done, Boolean(next.error));
		} catch (reason) {
			if (reason instanceof FieldError) {
				focusAfterRef.current = reason.field;
				setFieldErrors({[reason.field]: reason.message});
			} else {
				focusAfterRef.current = focus.failed;
				setError(messageOf(reason) || 'Sync could not complete that action.');
			}
		} finally {
			setAction(undefined);
		}
	};

	const connect = async () => {
		const found: FieldErrors = {
			url: checkAddress(address),
			token: checkToken(token),
		};
		const first = found.url ? 'url' : found.token ? 'token' : undefined;
		if (first) {
			setFieldErrors(found);
			setError('');
			(first === 'url' ? addressRef : tokenRef).current?.focus();
			return;
		}

		await run(
			'connect',
			async () => {
				const result = await send('SYNC_CONNECT', {url: address, token});
				if (!result.ok) {
					throw result.field === 'url' || result.field === 'token'
						? new FieldError(result.field, result.error)
						: new Error(result.error);
				}

				setToken('');
				void send('GET_PRIVATE_CONFIG').then((config) => {
					setAskPrivate(
						config.ok && config.mode === 'saved' && config.configured,
					);
				});
				return result.status;
			},
			'Sync is on.',
			{done: 'sync', failed: 'url'},
		);
	};

	/**
	Rechecks a field as it is edited once it shows an error, so the error goes away as soon as it is fixed.
	*/
	const recheck = (field: Field, value: string) => {
		setFieldErrors((errors) => ({...errors, [field]: CHECKS[field](value)}));
	};

	const edit = (field: Field, value: string) => {
		setError('');
		if (fieldErrors[field] !== undefined) {
			recheck(field, value);
		}
	};

	// Leaving a filled in field checks it; an empty one is only flagged on Connect.
	const leave = (field: Field, value: string) => {
		if (value.trim() !== '') {
			recheck(field, value);
		}
	};

	if (!status.connected) {
		return (
			<form
				noValidate
				className="space-y-4"
				aria-describedby={helpId}
				onSubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<p id={helpId} className="text-sm text-muted-foreground">
					Run the server yourself, with Docker or on your own Cloudflare
					account. It receives your sessions, saved tabs, bookmarks, and notes
					in plain text, so only connect to one you trust.
				</p>
				<ServerSetupGuide
					showStatus={showStatus}
					onToken={(next) => {
						setToken(next);
						setFieldErrors((errors) => ({...errors, token: undefined}));
					}}
				/>
				<div className="grid gap-2">
					<Label htmlFor={addressId}>Server address</Label>
					<Input
						ref={addressRef}
						aria-required
						id={addressId}
						type="url"
						inputMode="url"
						autoComplete="url"
						spellCheck={false}
						placeholder="https://sync.example.com"
						value={address}
						disabled={busy}
						aria-invalid={Boolean(fieldErrors.url)}
						aria-describedby={fieldErrors.url ? addressErrorId : undefined}
						className={FIELD_ERROR_CLASS}
						onChange={(event) => {
							setAddress(event.target.value);
							edit('url', event.target.value);
						}}
						onBlur={(event) => {
							leave('url', event.target.value);
						}}
					/>
					<FieldMessage id={addressErrorId} message={fieldErrors.url} />
				</div>
				<div className="grid gap-2">
					<Label htmlFor={tokenId}>Token</Label>
					<Input
						ref={tokenRef}
						aria-required
						id={tokenId}
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={token}
						disabled={busy}
						aria-invalid={Boolean(fieldErrors.token)}
						aria-describedby={fieldErrors.token ? tokenErrorId : undefined}
						className={FIELD_ERROR_CLASS}
						onChange={(event) => {
							setToken(event.target.value);
							edit('token', event.target.value);
						}}
						onBlur={(event) => {
							leave('token', event.target.value);
						}}
					/>
					<FieldMessage id={tokenErrorId} message={fieldErrors.token} />
				</div>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<Button type="submit" disabled={busy}>
					<Link2 aria-hidden="true" />
					{busy ? 'Connecting…' : 'Connect'}
				</Button>
			</form>
		);
	}

	const syncNow = () => {
		void run(
			'sync',
			async () => {
				const result = await send('SYNC_NOW');
				if (!result.ok) {
					throw new Error(result.error);
				}

				return result.status;
			},
			'Synced.',
			{done: 'sync', failed: 'sync'},
		);
	};

	const disconnect = () => {
		setConfirmDisconnect(false);
		void run(
			'disconnect',
			async () => {
				const result = await send('SYNC_DISCONNECT');
				if (!result.ok) {
					throw new Error(result.error);
				}

				return result.status;
			},
			'Sync is off. Everything stays on this device.',
			{done: 'url', failed: 'sync'},
		);
	};

	const server = (status.url ?? '').replace(/^https?:\/\//, '');
	// Covers a sync the worker started on its own as well as one started here.
	const syncing = action === 'sync' || status.phase === 'syncing';
	return (
		<div className="space-y-4">
			<SyncStatusLine status={status} server={server} />
			{status.refused > 0 && (
				<p className="text-sm text-muted-foreground">
					The server turned down {status.refused} old{' '}
					{status.refused === 1 ? 'change' : 'changes'} from this browser,
					because {status.refused === 1 ? 'it was' : 'they were'} about items
					deleted on another device long ago.
				</p>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<SyncNowButton
					ref={syncNowRef}
					busy={busy}
					syncing={syncing}
					onSync={syncNow}
				/>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={() => {
						setConfirmDisconnect(true);
					}}
				>
					<Link2Off aria-hidden="true" />
					Disconnect
				</Button>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Label htmlFor={settingsSwitchId}>Sync settings</Label>
					<p
						id={settingsHelpId}
						className="text-xs leading-5 text-muted-foreground"
					>
						Uses the same TabLodge settings in every browser you connect.
						Recovery snapshots and automatic backups always stay on each device.
						Turning this back on uploads this browser’s settings.
					</p>
				</div>
				<Switch
					id={settingsSwitchId}
					aria-describedby={settingsHelpId}
					checked={syncSettings}
					disabled={busy}
					onCheckedChange={(checked) => {
						setSyncSettings(checked);
						void chrome.storage.local
							.set({[SYNC_SETTINGS_KEY]: checked})
							.then(syncNow);
					}}
				/>
			</div>
			<DeviceNameField />
			<ConfirmationDialog
				open={confirmDisconnect}
				title="Disconnect from sync?"
				description={`This browser stops syncing with ${server}. Everything stays on this device, and the server keeps its copy. If you connect again later, the two are merged.`}
				confirmLabel="Disconnect"
				onOpenChange={setConfirmDisconnect}
				onConfirm={disconnect}
			/>
			<PrivateSyncPrompt
				open={askPrivate}
				showStatus={showStatus}
				onOpenChange={setAskPrivate}
			/>
		</div>
	);
}

/**
Asks, right after connecting, whether the separate private library should sync too. That can only be turned on in a
private window, which can read the library and ask for its PIN or password, so Yes opens Settings there.
*/
function PrivateSyncPrompt({
	open,
	onOpenChange,
	showStatus,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
}) {
	const [opening, setOpening] = useState(false);
	const openPrivateWindow = async () => {
		setOpening(true);
		const result = await send('OPEN_PRIVATE_SYNC');
		setOpening(false);
		onOpenChange(false);
		if (!result.ok) {
			showStatus(result.error, true);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Sync private windows too?</DialogTitle>
					<DialogDescription>
						Private windows in this browser keep a separate library. It can sync
						to the same server, encrypted if it has a PIN or password. You turn
						this on in a private window, which opens next.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							onOpenChange(false);
						}}
					>
						Not now
					</Button>
					<Button
						type="button"
						disabled={opening}
						onClick={() => {
							void openPrivateWindow();
						}}
					>
						<Lock aria-hidden="true" />
						Open a private window
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
For someone without a server: make a token, deploy the server to Cloudflare with it, and come back with the address.
Cloudflare cannot hand the address back, so the last step stays manual.
*/
function ServerSetupGuide({
	showStatus,
	onToken,
}: {
	showStatus: ShowStatus;
	onToken: (token: string) => void;
}) {
	const [token, setToken] = useState('');
	const headingId = useId();

	const copy = async (text: string, fresh: boolean) => {
		try {
			await writeClipboard({text, html: null});
			showStatus(
				fresh ? 'Token copied, and filled in below.' : 'Token copied again.',
			);
		} catch {
			showStatus(
				'The token is filled in below, but it could not be copied. Generate one again to retry.',
				true,
			);
		}
	};

	return (
		<section
			aria-labelledby={headingId}
			className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
		>
			<h3 id={headingId} className="text-sm font-semibold">
				No server yet?
			</h3>
			<ol className="space-y-3 text-sm">
				<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<span>
						<span className="font-medium">1.</span> Make a token. It is copied
						and filled in below.
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start sm:self-auto"
						onClick={() => {
							if (token) {
								void copy(token, false);
								return;
							}

							const next = createSyncToken();
							setToken(next);
							onToken(next);
							void copy(next, true);
						}}
					>
						<KeyRound aria-hidden="true" />
						{token ? 'Copy token' : 'Generate token'}
					</Button>
				</li>
				<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<span>
						<span className="font-medium">2.</span> Deploy the server to your
						free Cloudflare account, and paste the token when it asks for{' '}
						<code className="text-xs">TABLODGE_SYNC_TOKEN</code>.
					</span>
					<Button
						asChild
						variant="outline"
						size="sm"
						className="self-start sm:self-auto"
					>
						<a
							href={CLOUDFLARE_DEPLOY_URL}
							target="_blank"
							rel="noopener noreferrer"
						>
							<ExternalLink aria-hidden="true" />
							Deploy to Cloudflare
						</a>
					</Button>
				</li>
				<li>
					<span className="font-medium">3.</span> Paste the address Cloudflare
					shows, such as{' '}
					<code className="text-xs">https://tablodge-sync.you.workers.dev</code>
					, into Server address, then choose Connect.
				</li>
			</ol>
			<p className="text-xs text-muted-foreground">
				Cloudflare also asks you to sign in with GitHub or GitLab, where it
				keeps a copy of the server. To run it with Docker instead, read{' '}
				<a
					className="underline underline-offset-2"
					href={GUIDE_URL}
					target="_blank"
					rel="noopener noreferrer"
				>
					how to set up a server
				</a>
				.
			</p>
		</section>
	);
}

/**
How sync is doing, for the regular library and the private one: an icon, a headline, the server and the last sync,
and the error when sync stopped.
*/
export function SyncStatusLine({
	status,
	server,
}: {
	status: SyncStatus;
	server: string;
}) {
	const {title, note, Icon, tone, spin} = summarize(status);
	return (
		<>
			<div className="flex gap-3">
				<Icon
					aria-hidden="true"
					className={cn(
						'mt-0.5 size-5 shrink-0',
						tone ?? 'text-muted-foreground',
						spin && 'motion-safe:animate-spin',
					)}
				/>
				<div role="status" className="min-w-0 space-y-0.5 text-sm">
					<p className="font-medium">{title}</p>
					<p className="text-muted-foreground wrap-anywhere">
						{server}
						{status.lastSyncAt
							? ` · Last synced ${syncedAt(status.lastSyncAt)}`
							: ''}
					</p>
					{note && <p className="text-muted-foreground">{note}</p>}
				</div>
			</div>
			{status.phase === 'error' && status.error && (
				<p role="alert" className="text-sm text-destructive">
					{status.error}
				</p>
			)}
		</>
	);
}

/**
Sync now, which reads Syncing… and ignores presses while a sync runs. It stays focusable meanwhile (aria-disabled
rather than disabled), so focus is not dropped to the page.
*/
export function SyncNowButton({
	ref,
	busy,
	syncing,
	onSync,
}: {
	ref?: Ref<HTMLButtonElement>;
	busy: boolean;
	syncing: boolean;
	onSync: () => void;
}) {
	return (
		<Button
			ref={ref}
			type="button"
			aria-disabled={busy || syncing}
			className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
			onClick={() => {
				if (!busy && !syncing) {
					onSync();
				}
			}}
		>
			<RefreshCw
				aria-hidden="true"
				className={syncing ? 'motion-safe:animate-spin' : undefined}
			/>
			{syncing ? 'Syncing…' : 'Sync now'}
		</Button>
	);
}

export function FieldMessage({id, message}: {id: string; message?: string}) {
	return (
		<p
			id={id}
			aria-live="polite"
			className={cn(
				'text-xs font-medium text-destructive',
				!message && 'sr-only',
			)}
		>
			{message}
		</p>
	);
}
