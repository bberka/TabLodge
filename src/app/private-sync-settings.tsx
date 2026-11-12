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
import {messageOf, send, type ShowStatus} from './common';
import {PRIVATE_SYNC_ASK} from './private-sync';
import {FieldMessage, SyncNowButton, SyncStatusLine} from './sync-settings';
import type {PrivateSyncInfo} from './types';

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

/**
Settings › Sync in a private window: whether the separate private library syncs too.
*/
export function PrivateSyncSettings({showStatus}: {showStatus: ShowStatus}) {
	const [info, setInfo] = useState<PrivateSyncInfo>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	// The question the worker asked for a PIN or password, while the dialog is open.
	const [ask, setAsk] = useState<string>();
	const [credentialError, setCredentialError] = useState('');
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

		// The private client keeps its status under the private library's prefix.
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

	const enable = async (credential?: string) => {
		setBusy(true);
		setError('');
		try {
			const result = await send('PRIVATE_SYNC_ENABLE', {credential});
			if (result.ok) {
				setInfo(result.privateSync);
				setAsk(undefined);
				showStatus('Private windows sync now.');
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

	// A regular window opened this page to turn private sync on (see PrivateSyncPrompt). Starts it as if the
	// switch were turned on, so a PIN or password is asked for here.
	const askedRef = useRef(false);
	useEffect(() => {
		if (!info || askedRef.current) {
			return;
		}

		askedRef.current = true;
		if (!location.search.includes(PRIVATE_SYNC_ASK)) {
			return;
		}

		// Dropped from the address, so a reload does not start it again.
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
	const encryption = info.encrypted
		? 'Encrypted with a PIN or password before it leaves this browser. Other browsers need the same one to read it.'
		: info.lock
			? 'Encrypted with this private library’s PIN or password before it leaves this browser.'
			: 'Not encrypted. Set a PIN or password under Private windows to encrypt it before it leaves this browser.';
	const Icon = info.encrypted || info.lock ? Lock : LockOpen;
	const server = info.server?.replace(/^https?:\/\//, '') ?? '';
	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Label htmlFor={switchId}>Sync private windows</Label>
					<p id={helpId} className="text-xs leading-5 text-muted-foreground">
						Keeps this private library the same in your other browsers, as a
						separate library on {server}.
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
					checked={status.connected}
					disabled={busy}
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
								Enter PIN or password
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
				// A fresh dialog each time it opens, so nothing typed before is kept.
				key={ask ?? 'closed'}
				question={ask}
				busy={busy}
				error={credentialError}
				returnFocus={switchRef}
				onSubmit={(credential) => {
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
		</div>
	);
}

/**
Asks for the PIN or password the worker needs to turn private sync on. Open while `question` is set.
*/
function CredentialDialog({
	question,
	busy,
	error,
	returnFocus,
	onSubmit,
	onClose,
	onEdit,
}: {
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
	const message = empty ? 'Enter the PIN or password.' : error;

	// A wrong entry comes back after the check; focus goes back to the field for the next try.
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
						<DialogTitle>Encrypt private sync</DialogTitle>
						<DialogDescription>{question}</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<div className="grid gap-2">
							<Label htmlFor={inputId}>PIN or password</Label>
							<Input
								ref={inputRef}
								id={inputId}
								type="password"
								autoComplete="off"
								spellCheck={false}
								value={credential}
								// Read only rather than disabled while checking, so focus stays here for a wrong entry.
								readOnly={busy}
								aria-invalid={Boolean(message)}
								aria-describedby={message ? errorId : undefined}
								className="aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive"
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
							{busy ? 'Checking…' : 'Turn on'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
