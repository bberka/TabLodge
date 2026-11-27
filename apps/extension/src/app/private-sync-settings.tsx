import {type RefObject, useEffect, useId, useRef, useState} from 'react';
import {Lock, LockOpen} from 'lucide-react';
import {SYNC_STATUS_KEY} from '../shared/sync/client';
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
import {PRIVATE_SYNC_ASK} from '../shared/private-sync';
import type {PrivateSyncInfo} from '../shared/types';
import {messageOf, send, type ShowStatus} from './common';
import {FieldMessage, SyncNowButton, SyncStatusLine} from './sync-settings';

const UNAVAILABLE: Record<
	Exclude<PrivateSyncInfo['availability'], 'ready'>,
	string
> = {
	'no-server':
		'Without a sync server, private windows stay on this device. Connect this browser to one in Settings in a regular window, and private windows can sync too.',
	shared:
		'Private windows use the regular library, so they sync with it whenever this browser syncs.',
	temporary:
		'Temporary private storage is cleared when the browser closes, so it does not sync. Choose saved separate storage under Private windows to sync it.',
	setup: 'Finish setting up private storage under Private windows first.',
	locked: 'Unlock private windows to change how they sync.',
};

export function PrivateSyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [info, setInfo] = useState<PrivateSyncInfo>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [ask, setAsk] = useState<string>();
	const [credentialError, setCredentialError] = useState('');
	const [serverAsk, setServerAsk] = useState<string>();
	const [serverError, setServerError] = useState('');
	const localCredentialRef = useRef('');
	const switchRef = useRef<HTMLButtonElement>(null);
	const switchId = useId();
	const helpId = useId();

	useEffect(() => {
		const refresh = () => {
			void send('PRIVATE_SYNC_STATUS').then((result) => {
				if (result.ok) {
					setInfo(result.privateSync);
				}
			});
		};

		const onChanged = (changes: Record<string, unknown>) => {
			if (Object.keys(changes).some((key) => key.endsWith(SYNC_STATUS_KEY))) {
				refresh();
			}
		};

		refresh();
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	const enable = async (credential?: string, serverCredential?: string) => {
		setBusy(true);
		setError('');
		try {
			const result = await send('PRIVATE_SYNC_ENABLE', {
				credential,
				serverCredential,
			});
			if (result.ok) {
				setInfo(result.privateSync);
				setAsk(undefined);
				setServerAsk(undefined);
				showStatus('Private windows sync now.');
			} else if (result.field === 'serverCredential') {
				setAsk(undefined);
				if (serverAsk === undefined) {
					setServerAsk(result.error);
				} else {
					setServerError(result.error);
				}
			} else if (result.field !== 'credential') {
				setError(result.error);
			} else if (ask === undefined) {
				setAsk(result.error);
			} else {
				setCredentialError(result.error);
			}
		} catch (reason) {
			setError(messageOf(reason) || 'Private sync could not be turned on.');
		} finally {
			setBusy(false);
		}
	};

	const askedRef = useRef(false);
	useEffect(() => {
		if (!info || askedRef.current) {
			return;
		}

		askedRef.current = true;
		if (!location.search.includes(PRIVATE_SYNC_ASK)) {
			return;
		}

		history.replaceState(null, '', `${location.pathname}${location.hash}`);
		if (info.availability === 'ready' && !info.status.connected) {
			void enable();
		}
	});

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

	const {status} = info;
	const encryption = info.lock
		? 'Encrypted with this private library’s password before it leaves this browser. Other browsers need the same one to read it.'
		: info.encrypted
			? 'Encrypted with a password before it leaves this browser.'
			: 'Set a password under Private windows first. It encrypts what syncs.';
	const Icon = info.encrypted || info.lock ? Lock : LockOpen;
	const server = info.server?.replace(/^https?:\/\//, '') ?? '';
	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Label htmlFor={switchId}>Sync private windows</Label>
					<p
						id={helpId}
						className="text-xs leading-[1.6667] text-muted-foreground"
					>
						{status.connected
							? `On: this private library syncs with your other browsers and phone, as a separate library on ${server}.`
							: `Off: this private library stays on this device only. Turn it on to merge it with the library on ${server} and keep your devices the same.`}
					</p>
					<p className="flex gap-1.5 text-xs leading-[1.6667] text-muted-foreground">
						<Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
						{encryption}
					</p>
				</div>
				<Switch
					ref={switchRef}
					id={switchId}
					aria-describedby={helpId}
					checked={status.connected}
					disabled={busy || (!info.lock && !status.connected)}
					onCheckedChange={(checked) => {
						void (checked ? enable() : disable());
					}}
				/>
			</div>
			{status.connected && (
				<>
					<SyncStatusLine status={status} server={server} />
					<div className="flex flex-wrap gap-2">
						{status.needsKey ? (
							<Button
								type="button"
								onClick={() => {
									setAsk(status.error ?? undefined);
								}}
							>
								<Lock aria-hidden="true" />
								Enter password
							</Button>
						) : (
							<SyncNowButton
								busy={busy}
								syncing={status.phase === 'syncing'}
								onSync={() => {
									void send('PRIVATE_SYNC_NOW').then((result) => {
										if (result.ok) {
											setInfo(result.privateSync);
										}
									});
								}}
							/>
						)}
					</div>
				</>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<CredentialDialog
				key={ask ?? 'closed'}
				question={ask}
				busy={busy}
				error={credentialError}
				returnFocus={switchRef}
				onSubmit={(credential) => {
					localCredentialRef.current = credential;
					void enable(credential);
				}}
				onClose={() => {
					setAsk(undefined);
					setCredentialError('');
				}}
				onEdit={() => {
					setCredentialError('');
				}}
			/>
			<CredentialDialog
				key={`server:${serverAsk ?? 'closed'}`}
				title="Use the server’s password"
				submitLabel="Use it and turn on"
				question={serverAsk}
				busy={busy}
				error={serverError}
				returnFocus={switchRef}
				onSubmit={(credential) => {
					void enable(localCredentialRef.current, credential);
				}}
				onClose={() => {
					setServerAsk(undefined);
					setServerError('');
					localCredentialRef.current = '';
				}}
				onEdit={() => {
					setServerError('');
				}}
			/>
		</div>
	);
}

function CredentialDialog({
	title = 'Encrypt private sync',
	submitLabel = 'Turn on',
	question,
	busy,
	error,
	returnFocus,
	onSubmit,
	onClose,
	onEdit,
}: {
	title?: string;
	submitLabel?: string;
	question: string | undefined;
	busy: boolean;
	error: string;
	returnFocus: RefObject<HTMLButtonElement | null>;
	onSubmit: (credential: string) => void;
	onClose: () => void;
	onEdit: () => void;
}) {
	const [credential, setCredential] = useState('');
	const [empty, setEmpty] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();
	const errorId = useId();
	const message = empty ? 'Enter the password.' : error;

	useEffect(() => {
		if (error) {
			inputRef.current?.focus();
		}
	}, [error]);

	return (
		<Dialog
			open={question !== undefined}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					inputRef.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus.current?.focus();
				}}
			>
				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (credential === '') {
							setEmpty(true);
							inputRef.current?.focus();
							return;
						}

						onSubmit(credential);
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{question}</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<div className="grid gap-2">
							<Label htmlFor={inputId}>Password</Label>
							<Input
								ref={inputRef}
								id={inputId}
								type="password"
								autoComplete="off"
								spellCheck={false}
								value={credential}
								readOnly={busy}
								aria-invalid={Boolean(message)}
								aria-describedby={message ? errorId : undefined}
								className="aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
								onChange={(event) => {
									setCredential(event.target.value);
									setEmpty(false);
									onEdit();
								}}
							/>
							<FieldMessage id={errorId} message={message} />
						</div>
					</DialogBody>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							<Lock aria-hidden="true" />
							{busy ? 'Checking…' : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
