// The dialogs of the private library lock settings: turn the lock on, change its PIN or password, remove it.
import {useState, type ReactNode} from 'react';
import {Lock} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../shared/ui';
import {
	DEFAULT_IDLE_MINUTES,
	IDLE_MINUTE_CHOICES,
} from '../shared/private-lock';
import type {PrivateLockInfo} from '../shared/types';
import {send} from './message-client';
import {
	EMPTY_PASSCODE_DRAFT,
	PasscodeEntry,
	PasscodeSetup,
	passcodeDraftProblem,
	type PasscodeDraft,
} from './passcode-fields';

const IDLE_LABELS: Record<number, string> = {
	0: 'Never, until private windows close',
	1: '1 minute',
	5: '5 minutes',
	15: '15 minutes',
	30: '30 minutes',
	60: '1 hour',
};

export function IdleSelect({
	value,
	onChange,
	disabled,
	label,
}: {
	value: number;
	onChange: (minutes: number) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<Select
			value={String(value)}
			disabled={disabled}
			onValueChange={(next) => onChange(Number(next))}
		>
			<SelectTrigger className="w-full sm:w-72" aria-label={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{IDLE_MINUTE_CHOICES.map((minutes) => (
					<SelectItem key={minutes} value={String(minutes)}>
						{IDLE_LABELS[minutes]}
						{minutes === DEFAULT_IDLE_MINUTES ? ' (default)' : ''}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Fieldset({legend, children}: {legend: string; children: ReactNode}) {
	return (
		<fieldset className="grid gap-3 border-0 p-0">
			<legend className="mb-2 text-sm font-medium">{legend}</legend>
			{children}
		</fieldset>
	);
}

export function EnableDialog({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDone: (info: PrivateLockInfo) => void;
}) {
	const [draft, setDraft] = useState<PasscodeDraft>(EMPTY_PASSCODE_DRAFT);
	const [idle, setIdle] = useState(DEFAULT_IDLE_MINUTES);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const problem = passcodeDraftProblem(draft);
	const submit = async () => {
		if (busy || problem !== null) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('ENABLE_PRIVATE_LOCK', {
			kind: draft.kind,
			credential: draft.value,
			idleMinutes: idle,
		});
		setBusy(false);
		if (result.ok) {
			setDraft(EMPTY_PASSCODE_DRAFT);
			onDone(result);
			return;
		}

		setError(result.error);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) {
					onOpenChange(next);
				}

				if (next || busy) {
					return;
				}

				setDraft(EMPTY_PASSCODE_DRAFT);
				setError('');
			}}
		>
			<DialogContent size="md">
				<DialogHeader>
					<DialogTitle>Lock private windows</DialogTitle>
					<DialogDescription>
						Encrypt the separate saved library on this device. Its sessions,
						bookmarks, trash, and settings open only after you enter a PIN or
						password.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<DialogBody className="grid gap-4">
						<PasscodeSetup draft={draft} disabled={busy} onChange={setDraft} />
						{draft.kind === 'pin' && (
							<p className="text-xs leading-5 text-muted-foreground">
								Short PINs are weak against copied profile files. Anyone who
								copies your browser profile folder can try every PIN offline.
								Choose a password for anything sensitive.
							</p>
						)}
						<ul className="grid list-disc gap-1 pl-5 text-xs leading-5 text-muted-foreground">
							<li>
								The lock protects files at rest. Exports and backups you make
								from private windows are plain text unless you protect a full
								backup.
							</li>
							<li>
								It locks when you choose Lock now, when the idle time passes,
								when the last private window closes, and when the browser
								closes.
							</li>
							<li>
								The private storage mode cannot change while the lock is on.
							</li>
						</ul>
						<div className="grid gap-1.5">
							<span className="text-sm font-medium">Lock after</span>
							<IdleSelect
								label="Lock after"
								value={idle}
								disabled={busy}
								onChange={setIdle}
							/>
						</div>
						{busy && (
							<p role="status" className="text-sm text-muted-foreground">
								Encrypting the private library. Keep this page open.
							</p>
						)}
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || problem !== null}>
							<Lock aria-hidden="true" />
							{busy ? 'Encrypting…' : 'Turn on lock'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function ChangeDialog({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDone: (info: PrivateLockInfo) => void;
}) {
	const [current, setCurrent] = useState('');
	const [draft, setDraft] = useState<PasscodeDraft>(EMPTY_PASSCODE_DRAFT);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const problem = passcodeDraftProblem(draft);
	const reset = () => {
		setCurrent('');
		setDraft(EMPTY_PASSCODE_DRAFT);
		setError('');
	};

	const submit = async () => {
		if (busy || problem !== null || current.length === 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('CHANGE_PRIVATE_LOCK_CREDENTIAL', {
			current,
			kind: draft.kind,
			credential: draft.value,
		});
		setBusy(false);
		if (result.ok) {
			reset();
			onDone(result);
			return;
		}

		setError(result.error);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) {
					return;
				}

				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
		>
			<DialogContent size="md">
				<DialogHeader>
					<DialogTitle>Change PIN or password</DialogTitle>
					<DialogDescription>
						Your private library stays as it is. Only the way you open it
						changes, and the old PIN or password stops working.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<DialogBody className="grid gap-5">
						<Fieldset legend="Current PIN or password">
							<PasscodeEntry
								value={current}
								disabled={busy}
								onChange={(value) => {
									setCurrent(value);
									setError('');
								}}
							/>
						</Fieldset>
						<Fieldset legend="New PIN or password">
							<PasscodeSetup
								draft={draft}
								disabled={busy}
								onChange={setDraft}
							/>
						</Fieldset>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={busy || problem !== null || current.length === 0}
						>
							{busy ? 'Changing…' : 'Change'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function RemoveDialog({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDone: (info: PrivateLockInfo) => void;
}) {
	const [current, setCurrent] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const submit = async () => {
		if (busy || current.length === 0) {
			return;
		}

		setBusy(true);
		setError('');
		const result = await send('REMOVE_PRIVATE_LOCK', {credential: current});
		setBusy(false);
		if (result.ok) {
			setCurrent('');
			onDone(result);
			return;
		}

		setError(result.error);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) {
					return;
				}

				onOpenChange(next);
				if (next) {
					return;
				}

				setCurrent('');
				setError('');
			}}
		>
			<DialogContent size="md">
				<DialogHeader>
					<DialogTitle>Remove the lock</DialogTitle>
					<DialogDescription>
						This decrypts the private library on this device. Anyone with access
						to your browser profile can read it again. Your sessions and
						bookmarks stay.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<DialogBody className="grid gap-4">
						<PasscodeEntry
							value={current}
							error={error}
							disabled={busy}
							onChange={(value) => {
								setCurrent(value);
								setError('');
							}}
						/>
						{busy && (
							<p role="status" className="text-sm text-muted-foreground">
								Decrypting the private library. Keep this page open.
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="destructive"
							disabled={busy || current.length === 0}
						>
							{busy ? 'Removing…' : 'Remove lock'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
Settings panel for the lock. Regular windows show the status and point to a private window, because the key lives with the private worker.
*/
