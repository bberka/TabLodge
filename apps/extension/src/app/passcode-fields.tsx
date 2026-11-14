// Form pieces for choosing and entering a PIN or password, built on the rules in passcode.ts.
// PasscodeSetup is the "choose one" form (type, value, confirmation, weakness and loss warnings, acknowledgement);
// PasscodeEntry is the single field for unlocking. Both keep the value in the caller's state, never in storage.
import {useId, useState} from 'react';
import {CircleAlert, Eye, EyeOff, TriangleAlert} from 'lucide-react';
import {Checkbox, Input, Label, SegmentedControl} from '../shared/ui';
import {
	CREDENTIAL_LABELS,
	clampCredentialInput,
	LOST_CREDENTIAL_NOTE,
	PIN_WEAKNESS_NOTE,
	credentialRule,
	validateCredential,
	type CredentialKind,
} from '../shared/passcode';

export type PasscodeDraft = {
	kind: CredentialKind;
	value: string;
	confirm: string;
	acknowledged: boolean;
};

export const EMPTY_PASSCODE_DRAFT: PasscodeDraft = {
	kind: 'password',
	value: '',
	confirm: '',
	acknowledged: false,
};

/**
Why the draft cannot be used yet, or null when it can. The first problem wins, in the order the form shows them.
*/
export function passcodeDraftProblem(draft: PasscodeDraft): string | null {
	return (
		validateCredential(draft.kind, draft.value) ??
		(draft.confirm === draft.value ? null : 'The two entries do not match.') ??
		(draft.acknowledged ? null : 'Confirm that you understand.')
	);
}

function ShowHideButton({
	shown,
	label,
	onToggle,
}: {
	shown: boolean;
	label: string;
	onToggle: () => void;
}) {
	const Icon = shown ? EyeOff : Eye;
	return (
		<button
			type="button"
			className="grid size-9 shrink-0 place-items-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
			aria-pressed={shown}
			onClick={onToggle}
		>
			<Icon className="h-4 w-4" aria-hidden="true" />
		</button>
	);
}

function ShowHideField({
	id,
	label,
	value,
	onChange,
	shown,
	onToggleShown,
	kind,
	problem,
	describedBy,
	autoComplete,
	disabled,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	shown?: boolean;
	onToggleShown?: () => void;
	kind: CredentialKind;
	problem?: string | null;
	describedBy?: string;
	autoComplete: string;
	disabled?: boolean;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type={shown ? 'text' : 'password'}
					inputMode={kind === 'pin' ? 'numeric' : 'text'}
					autoComplete={autoComplete}
					autoCapitalize="off"
					spellCheck={false}
					value={value}
					disabled={disabled}
					aria-invalid={problem ? true : undefined}
					aria-describedby={describedBy}
					onChange={(event) =>
						onChange(clampCredentialInput(kind, event.target.value))
					}
				/>
				{onToggleShown && (
					<ShowHideButton
						shown={Boolean(shown)}
						label={CREDENTIAL_LABELS[kind]}
						onToggle={onToggleShown}
					/>
				)}
			</div>
			{problem && (
				<p id={describedBy} className="text-xs text-destructive">
					{problem}
				</p>
			)}
		</div>
	);
}

/**
Choose a PIN or password: type, value with show/hide, confirmation, live limit checks, and the two warnings.
*/
export function PasscodeSetup({
	draft,
	onChange,
	disabled,
}: {
	draft: PasscodeDraft;
	onChange: (draft: PasscodeDraft) => void;
	disabled?: boolean;
}) {
	const id = useId();
	const [shown, setShown] = useState(false);
	const label = CREDENTIAL_LABELS[draft.kind];
	// Stay quiet until something is typed, then check as the person types.
	const valueProblem =
		draft.value.length > 0 ? validateCredential(draft.kind, draft.value) : null;
	const confirmProblem =
		draft.confirm.length > 0 && draft.confirm !== draft.value
			? 'The two entries do not match.'
			: null;
	return (
		<div className="grid gap-3">
			<SegmentedControl
				fullWidth
				label="Protect with"
				value={draft.kind}
				options={[
					{value: 'password', label: 'Password'},
					{value: 'pin', label: 'PIN'},
				]}
				onValueChange={(kind) => onChange({...EMPTY_PASSCODE_DRAFT, kind})}
			/>
			<ShowHideField
				id={`${id}-value`}
				label={label}
				value={draft.value}
				kind={draft.kind}
				shown={shown}
				problem={valueProblem}
				describedBy={`${id}-value-help`}
				autoComplete="new-password"
				disabled={disabled}
				onToggleShown={() => setShown(!shown)}
				onChange={(value) => onChange({...draft, value})}
			/>
			{!valueProblem && (
				<p className="-mt-2 text-xs text-muted-foreground">
					{credentialRule(draft.kind)}
				</p>
			)}
			<ShowHideField
				id={`${id}-confirm`}
				label={`Confirm ${label}`}
				value={draft.confirm}
				kind={draft.kind}
				shown={shown}
				problem={confirmProblem}
				describedBy={`${id}-confirm-help`}
				autoComplete="new-password"
				disabled={disabled}
				onChange={(confirm) => onChange({...draft, confirm})}
			/>
			{draft.kind === 'pin' && (
				<p className="flex items-start gap-2 rounded-md border border-border bg-muted/70 px-3 py-2 text-xs leading-5">
					<TriangleAlert
						className="mt-0.5 h-3.5 w-3.5 shrink-0"
						aria-hidden="true"
					/>
					<span className="min-w-0">{PIN_WEAKNESS_NOTE}</span>
				</p>
			)}
			<p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/6 px-3 py-2 text-xs leading-5">
				<CircleAlert
					className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
					aria-hidden="true"
				/>
				<span className="min-w-0">{LOST_CREDENTIAL_NOTE}</span>
			</p>
			<div className="flex items-start gap-2">
				<Checkbox
					id={`${id}-ack`}
					checked={draft.acknowledged}
					disabled={disabled}
					onCheckedChange={(checked) =>
						onChange({...draft, acknowledged: checked === true})
					}
				/>
				<Label htmlFor={`${id}-ack`} className="text-sm leading-5">
					I understand that a lost {draft.kind === 'pin' ? 'PIN' : 'password'}{' '}
					cannot be recovered.
				</Label>
			</div>
		</div>
	);
}

/**
One field to enter an existing PIN or password, with show/hide. The kind is not stored in the file, so it is not asked.
*/
export function PasscodeEntry({
	value,
	onChange,
	error,
	disabled,
	inputRef,
}: {
	value: string;
	onChange: (value: string) => void;
	error?: string;
	disabled?: boolean;
	inputRef?: React.Ref<HTMLInputElement>;
}) {
	const id = useId();
	const [shown, setShown] = useState(false);
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={`${id}-entry`}>PIN or password</Label>
			<div className="flex items-center gap-2">
				<Input
					ref={inputRef}
					id={`${id}-entry`}
					type={shown ? 'text' : 'password'}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					value={value}
					disabled={disabled}
					data-autofocus=""
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `${id}-entry-error` : undefined}
					onChange={(event) =>
						onChange(clampCredentialInput(undefined, event.target.value))
					}
				/>
				<ShowHideButton
					shown={shown}
					label="PIN or password"
					onToggle={() => setShown(!shown)}
				/>
			</div>
			{error && (
				<p
					id={`${id}-entry-error`}
					role="alert"
					className="flex items-start gap-2 text-xs leading-5 text-destructive"
				>
					<CircleAlert
						className="mt-0.5 h-3.5 w-3.5 shrink-0"
						aria-hidden="true"
					/>
					<span className="min-w-0">{error}</span>
				</p>
			)}
		</div>
	);
}
