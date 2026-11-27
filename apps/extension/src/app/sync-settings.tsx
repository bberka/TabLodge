import {type Ref, useEffect, useId, useRef, useState} from 'react';
import {
	CircleCheck,
	CircleHelp,
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
	readCompat,
	releaseWithAll,
	UPDATE_GUIDE_URL,
	versionText,
} from '../shared/sync/compat';
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
	Input,
	Label,
	Switch,
} from '../shared/ui';
import {DeviceNameField} from './device-name';
import {messageOf, send, type ShowStatus} from './common';
import {writeClipboard} from './interaction-actions';
import {PROJECT} from './project';
import {SharedPagesSettings} from './shared-pages';
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
	'shared pages',
	'link',
	'publish',
];

const GUIDE_URL = `${PROJECT.repoUrl}/blob/master/docs/self-hosting.md`;
const CLOUDFLARE_DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${PROJECT.repoUrl}/tree/release/apps/server/cloudflare-deploy`;

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
	const [syncSettings, setSyncSettings] = useState(true);
	const settingsSwitchId = useId();
	const settingsHelpId = useId();
	const [error, setError] = useState('');
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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

	const recheck = (field: Field, value: string) => {
		setFieldErrors((errors) => ({...errors, [field]: CHECKS[field](value)}));
	};

	const edit = (field: Field, value: string) => {
		setError('');
		if (fieldErrors[field] !== undefined) {
			recheck(field, value);
		}
	};

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
					Only connect to a server you run and trust.
				</p>
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
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={busy}>
						<Link2 aria-hidden="true" />
						{busy ? 'Connecting…' : 'Connect'}
					</Button>
					<ServerSetupDialog
						showStatus={showStatus}
						onToken={(next) => {
							setToken(next);
							setFieldErrors((errors) => ({...errors, token: undefined}));
						}}
					/>
				</div>
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
	const syncing = action === 'sync' || status.phase === 'syncing';
	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-2">
					<SyncStatusLine status={status} server={server} />
				</div>
				<div className="flex shrink-0 flex-wrap gap-2">
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
			</div>
			<ServerReport status={status} />
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
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Label htmlFor={settingsSwitchId}>Sync settings</Label>
					<p
						id={settingsHelpId}
						className="text-xs leading-[1.6667] text-muted-foreground"
					>
						Link settings such as removing tracking parameters reach every
						browser and phone you connect. The theme, the accent, and the
						dashboard layout follow your other browsers but not your phones. The
						device name and Copy backups to Downloads stay on this device.
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
			<SharedPagesSettings showStatus={showStatus} />
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
						to the same server, encrypted with its password. You turn this on in
						a private window, which opens next.
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

function ServerSetupDialog({
	showStatus,
	onToken,
}: {
	showStatus: ShowStatus;
	onToken: (token: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [token, setToken] = useState('');

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
		<>
			<Button
				type="button"
				variant="outline"
				onClick={() => {
					setOpen(true);
				}}
			>
				<CircleHelp aria-hidden="true" />
				No server yet?
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent size="lg">
					<DialogHeader>
						<DialogTitle>Set up a sync server</DialogTitle>
						<DialogDescription>
							Run the server yourself, with Docker or on your own Cloudflare
							account. It receives your sessions, saved tabs, bookmarks, and
							notes in plain text, so only connect to one you trust.
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="space-y-3">
						<ol className="space-y-3 text-sm">
							<li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<span>
									<span className="font-medium">1.</span> Make a token. It is
									copied and filled in below.
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
									<span className="font-medium">2.</span> Deploy the server to
									your free Cloudflare account, and paste the token when it asks
									for <code className="text-xs">TABLODGE_SYNC_TOKEN</code>.
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
								<span className="font-medium">3.</span> Paste the address
								Cloudflare shows, such as{' '}
								<code className="text-xs">
									https://tablodge-sync.you.workers.dev
								</code>
								, into Server address, then choose Connect.
							</li>
						</ol>
						<p className="text-xs text-muted-foreground">
							Cloudflare also asks you to sign in with GitHub or GitLab, where
							it keeps a copy of the server. To run it with Docker instead, read{' '}
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
					</DialogBody>
					<DialogFooter>
						<Button
							type="button"
							onClick={() => {
								setOpen(false);
							}}
						>
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

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

function ServerReport({status}: {status: SyncStatus}) {
	const {server, incompatible, missing} = readCompat(status);
	if (!server) {
		return null;
	}

	const release = releaseWithAll(missing);
	return (
		<div className="space-y-2 text-sm">
			<p className="text-muted-foreground">
				Server version: {versionText(server.version)}
			</p>
			{missing.length > 0 && (
				<div className="space-y-1">
					<p className="font-medium">
						Until the server is updated
						{release ? ` to ${release} or later` : ''}:
					</p>
					<ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
						{missing.map((feature) => (
							<li key={feature.name}>{feature.missing}</li>
						))}
					</ul>
				</div>
			)}
			{(missing.length > 0 || incompatible === 'server') && (
				<p>
					<a
						className="inline-flex items-center gap-1 underline underline-offset-2"
						href={UPDATE_GUIDE_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						How to update the server
						<ExternalLink aria-hidden="true" className="size-3.5" />
					</a>
				</p>
			)}
		</div>
	);
}

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
