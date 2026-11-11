import {useEffect, useId, useRef, useState} from 'react';
import {Link2, Link2Off, RefreshCw} from 'lucide-react';
import {
	MIN_TOKEN_LENGTH,
	parseServerUrl,
	SYNC_STATUS_KEY,
	type SyncStatus,
} from '../shared/sync/client';
import {Button, Input, Label} from '../shared/ui';
import {messageOf, send, type ShowStatus} from './common';
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

function describe(status: SyncStatus): string {
	const when = status.lastSyncAt
		? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}.`
		: 'Not synced yet.';
	switch (status.phase) {
		case 'syncing': {
			return 'Syncing…';
		}

		case 'offline': {
			return `The server cannot be reached. Changes wait on this device until it can. ${when}`;
		}

		case 'error': {
			return when;
		}

		default: {
			return status.live
				? `Up to date. Changes from other devices arrive right away. ${when}`
				: when;
		}
	}
}

type Field = 'url' | 'token';
type FieldErrors = Partial<Record<Field, string>>;
type FocusTarget = Field | 'sync' | undefined;

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
	'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive';

export function SyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [status, setStatus] = useState<SyncStatus>();
	const [address, setAddress] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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
		work: () => Promise<SyncStatus>,
		done: string,
		focus: {done: FocusTarget; failed: FocusTarget},
	) => {
		setBusy(true);
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
			setBusy(false);
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
			async () => {
				const result = await send('SYNC_CONNECT', {url: address, token});
				if (!result.ok) {
					throw result.field === 'url' || result.field === 'token'
						? new FieldError(result.field, result.error)
						: new Error(result.error);
				}

				setToken('');
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
					in plain text, so only connect to one you trust.{' '}
					<a
						className="underline underline-offset-2"
						href={GUIDE_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						How to set up a server
					</a>
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
				<Button type="submit" disabled={busy}>
					<Link2 aria-hidden="true" />
					{busy ? 'Connecting…' : 'Connect'}
				</Button>
			</form>
		);
	}

	return (
		<div className="space-y-4">
			<div className="space-y-1 text-sm">
				<p className="font-medium">Syncing with {status.url}</p>
				<p role="status" className="text-muted-foreground">
					{describe(status)}
					{status.pending > 0 &&
						` ${status.pending} ${status.pending === 1 ? 'change waits' : 'changes wait'} to be sent.`}
				</p>
				{status.phase === 'error' && status.error && (
					<p role="alert" className="text-destructive">
						{status.error}
					</p>
				)}
				{status.refused > 0 && (
					<p className="text-muted-foreground">
						The server refused {status.refused} old{' '}
						{status.refused === 1 ? 'change' : 'changes'} from this device,
						because {status.refused === 1 ? 'it was' : 'they were'} about items
						deleted elsewhere long ago.
					</p>
				)}
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					ref={syncNowRef}
					type="button"
					disabled={busy}
					onClick={() => {
						void run(
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
					}}
				>
					<RefreshCw aria-hidden="true" />
					Sync now
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={() => {
						void run(
							async () => {
								const result = await send('SYNC_DISCONNECT');
								if (!result.ok) {
									throw new Error(result.error);
								}

								return result.status;
							},
							'Sync is off. The library on this device is unchanged.',
							{done: 'url', failed: 'sync'},
						);
					}}
				>
					<Link2Off aria-hidden="true" />
					Disconnect
				</Button>
			</div>
			<p className="text-sm text-muted-foreground">
				Disconnecting keeps everything on this device. Connecting again later
				merges this device&apos;s library with the server&apos;s.
			</p>
		</div>
	);
}

function FieldMessage({id, message}: {id: string; message?: string}) {
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
