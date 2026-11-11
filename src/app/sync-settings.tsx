import {useEffect, useId, useRef, useState} from 'react';
import {Link2, Link2Off, RefreshCw} from 'lucide-react';
import {SYNC_STATUS_KEY, type SyncStatus} from '../shared/sync/client';
import {Button, Input, Label} from '../shared/ui';
import {messageOf, send, type ShowStatus} from './common';
import {PROJECT} from './project';

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

type FocusTarget = 'address' | 'sync' | undefined;

export function SyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [status, setStatus] = useState<SyncStatus>();
	const [address, setAddress] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const addressRef = useRef<HTMLInputElement>(null);
	const syncNowRef = useRef<HTMLButtonElement>(null);
	const focusAfterRef = useRef<FocusTarget>(undefined);
	const addressId = useId();
	const tokenId = useId();
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

		if (focusAfterRef.current === 'sync') {
			syncNowRef.current?.focus();
		} else if (focusAfterRef.current === 'address') {
			addressRef.current?.focus();
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
		try {
			const next = await work();
			focusAfterRef.current = focus.done;
			setStatus(next);
			showStatus(next.error ?? done, Boolean(next.error));
		} catch (reason) {
			focusAfterRef.current = focus.failed;
			setError(messageOf(reason) || 'Sync could not complete that action.');
		} finally {
			setBusy(false);
		}
	};

	const connect = async () => {
		await run(
			async () => {
				const result = await send('SYNC_CONNECT', {url: address, token});
				if (!result.ok) {
					throw new Error(result.error);
				}

				setToken('');
				return result.status;
			},
			'Sync is on.',
			{done: 'sync', failed: 'address'},
		);
	};

	if (!status.connected) {
		return (
			<form
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
						required
						id={addressId}
						type="url"
						inputMode="url"
						autoComplete="url"
						placeholder="https://sync.example.com"
						value={address}
						disabled={busy}
						onChange={(event) => {
							setAddress(event.target.value);
						}}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor={tokenId}>Token</Label>
					<Input
						required
						id={tokenId}
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={token}
						disabled={busy}
						onChange={(event) => {
							setToken(event.target.value);
						}}
					/>
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
							{done: 'address', failed: 'sync'},
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
