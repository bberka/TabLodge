import {useEffect, useId, useRef, useState} from 'react';
import {Lock, LockOpen, RefreshCw} from 'lucide-react';
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
	Switch,
} from '../shared/ui';
import {messageOf, send, type ShowStatus} from './common';
import type {PrivateSyncInfo} from './types';
import {cn} from '@/lib/utils';

const UNAVAILABLE: Record<
	Exclude<PrivateSyncInfo['availability'], 'ready'>,
	string
> = {
	'no-server':
		'Connect this browser to a sync server first, in Settings in a regular window. Private windows can then sync too.',
	shared:
		'Private windows use the regular library, so they sync with it whenever this browser syncs.',
	temporary:
		'Temporary private storage is cleared when the browser closes, so it does not sync. Choose saved separate storage under Private windows to sync it.',
	setup: 'Finish setting up private storage under Private windows first.',
	locked: 'Unlock private windows to change how they sync.',
};

function statusLine(info: PrivateSyncInfo): string {
	const {status} = info;
	if (status.phase === 'syncing') {
		return 'Syncing…';
	}

	if (status.phase === 'offline') {
		return 'Cannot reach the server. Changes made here are sent once it is back.';
	}

	if (status.phase === 'error') {
		return status.error ?? 'Sync stopped.';
	}

	if (status.pending > 0) {
		return `${status.pending} ${status.pending === 1 ? 'change' : 'changes'} waiting to be sent.`;
	}

	return status.lastSyncAt
		? `Up to date. Last synced ${new Date(status.lastSyncAt).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}.`
		: 'Not synced yet.';
}

/**
Settings › Sync in a private window: whether the separate private library syncs too.
*/
export function PrivateSyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [info, setInfo] = useState<PrivateSyncInfo>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [ask, setAsk] = useState<string>();
	const [credential, setCredential] = useState('');
	const [credentialError, setCredentialError] = useState('');
	const switchRef = useRef<HTMLButtonElement>(null);
	const credentialRef = useRef<HTMLInputElement>(null);
	const switchId = useId();
	const helpId = useId();
	const credentialId = useId();
	const credentialErrorId = useId();

	useEffect(() => {
		const refresh = () => {
			void send('PRIVATE_SYNC_STATUS').then((result) => {
				if (result.ok) {
					setInfo(result.privateSync);
				}
			});
		};

		// The private client keeps its status in the private library's storage, under its prefix.
		const onChanged = (changes: Record<string, unknown>) => {
			if (Object.keys(changes).some((key) => key.includes('tablodge.sync.'))) {
				refresh();
			}
		};

		refresh();
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	if (!info) {
		return null;
	}

	if (info.availability !== 'ready') {
		return (
			<p className="text-sm text-muted-foreground">
				{UNAVAILABLE[info.availability]}
			</p>
		);
	}

	const on = info.status.connected;
	const enable = async (entered?: string) => {
		setBusy(true);
		setError('');
		try {
			const result = await send('PRIVATE_SYNC_ENABLE', {credential: entered});
			if (result.ok) {
				setInfo(result.privateSync);
				setAsk(undefined);
				setCredential('');
				showStatus('Private windows sync now.');
				return;
			}

			if (result.field === 'credential') {
				if (ask === undefined) {
					setAsk(result.error);
				} else {
					setCredentialError(result.error);
					credentialRef.current?.focus();
				}

				return;
			}

			setError(result.error);
		} catch (reason) {
			setError(messageOf(reason) || 'Private sync could not be turned on.');
		} finally {
			setBusy(false);
		}
	};

	const disable = async () => {
		setBusy(true);
		setError('');
		const result = await send('PRIVATE_SYNC_DISABLE');
		setBusy(false);
		if (result.ok) {
			setInfo(result.privateSync);
			showStatus(
				'Private windows no longer sync. This private library stays here.',
			);
		} else {
			setError(result.error);
		}
	};

	const encryption = info.encrypted
		? 'Encrypted with a PIN or password before it leaves this browser. Other browsers need the same one to read it.'
		: info.lock
			? 'Encrypted with this private library’s PIN or password before it leaves this browser.'
			: 'Not encrypted. Set a PIN or password under Private windows to encrypt it before it leaves this browser.';
	const Icon = info.encrypted || info.lock ? Lock : LockOpen;
	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Label htmlFor={switchId}>Sync private windows</Label>
					<p id={helpId} className="text-xs leading-5 text-muted-foreground">
						Keeps this private library the same in your other browsers, as a
						separate library on {info.server?.replace(/^https?:\/\//, '')}.
					</p>
					<p className="flex gap-1.5 text-xs leading-5 text-muted-foreground">
						<Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
						{encryption}
					</p>
				</div>
				<Switch
					ref={switchRef}
					id={switchId}
					aria-describedby={helpId}
					checked={on}
					disabled={busy}
					onCheckedChange={(checked) => {
						void (checked ? enable() : disable());
					}}
				/>
			</div>
			{on && (
				<div className="flex flex-wrap items-center gap-3">
					<p
						role="status"
						className={cn(
							'text-sm',
							info.status.phase === 'error'
								? 'text-destructive'
								: 'text-muted-foreground',
						)}
					>
						{statusLine(info)}
					</p>
					{info.status.needsKey ? (
						<Button
							type="button"
							size="sm"
							onClick={() => {
								setAsk(info.status.error ?? undefined);
							}}
						>
							Enter PIN or password
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							variant="outline"
							aria-disabled={busy || info.status.phase === 'syncing'}
							className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
							onClick={() => {
								if (busy || info.status.phase === 'syncing') {
									return;
								}

								void send('PRIVATE_SYNC_NOW').then((result) => {
									if (result.ok) {
										setInfo(result.privateSync);
									}
								});
							}}
						>
							<RefreshCw
								aria-hidden="true"
								className={
									info.status.phase === 'syncing'
										? 'motion-safe:animate-spin'
										: undefined
								}
							/>
							{info.status.phase === 'syncing' ? 'Syncing…' : 'Sync now'}
						</Button>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<Dialog
				open={ask !== undefined}
				onOpenChange={(open) => {
					if (open) {
						return;
					}

					setAsk(undefined);
					setCredential('');
					setCredentialError('');
				}}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						credentialRef.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						switchRef.current?.focus();
					}}
				>
					<form
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							if (credential === '') {
								setCredentialError('Enter the PIN or password.');
								credentialRef.current?.focus();
								return;
							}

							void enable(credential);
						}}
					>
						<DialogHeader>
							<DialogTitle>Encrypt private sync</DialogTitle>
							<DialogDescription>{ask}</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="grid gap-2">
								<Label htmlFor={credentialId}>PIN or password</Label>
								<Input
									ref={credentialRef}
									id={credentialId}
									type="password"
									autoComplete="off"
									spellCheck={false}
									value={credential}
									// Read only rather than disabled while checking, so focus stays here for a wrong entry.
									readOnly={busy}
									aria-invalid={Boolean(credentialError)}
									aria-describedby={
										credentialError ? credentialErrorId : undefined
									}
									className="aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive"
									onChange={(event) => {
										setCredential(event.target.value);
										setCredentialError('');
									}}
								/>
								<p
									id={credentialErrorId}
									aria-live="polite"
									className={cn(
										'text-xs font-medium text-destructive',
										!credentialError && 'sr-only',
									)}
								>
									{credentialError}
								</p>
							</div>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setAsk(undefined);
								}}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={busy}>
								<Lock aria-hidden="true" />
								{busy ? 'Checking…' : 'Turn on'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
