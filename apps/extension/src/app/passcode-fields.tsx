import {useId, useState} from 'react';
import {CircleAlert, Eye, EyeOff} from 'lucide-react';
import {Checkbox, Input, Label} from '../shared/ui';
import {
	LOST_CREDENTIAL_NOTE,
	PASSWORD_LABEL,
	sameCredential,
	validateCredential,
	weakPasswordHint,
} from '../shared/passcode';
import {cn} from '@/lib/utils';

export type PasscodeDraft = {
	value: string;
	confirm: string;
	acknowledged: boolean;
};

export const EMPTY_PASSCODE_DRAFT: PasscodeDraft = {
	value: '',
	confirm: '',
	acknowledged: false,
};

export function passcodeDraftProblem(draft: PasscodeDraft): string | null {
	return (
		validateCredential(draft.value) ??
		(sameCredential(draft.confirm, draft.value)
			? null
			: 'The two entries do not match.') ??
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
	problem,
	describedBy,
	hint,
	autoComplete,
	disabled,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	shown?: boolean;
	onToggleShown?: () => void;
	problem?: string | null;
	hint?: string | null;
	describedBy?: string;
	autoComplete: string;
	disabled?: boolean;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<Input
					required
					id={id}
					type={shown ? 'text' : 'password'}
					inputMode="text"
					autoComplete={autoComplete}
					autoCapitalize="off"
					spellCheck={false}
					value={value}
					disabled={disabled}
					aria-required="true"
					aria-invalid={problem ? true : undefined}
					aria-describedby={describedBy}
					onChange={(event) => onChange(event.target.value)}
				/>
				{onToggleShown && (
					<ShowHideButton
						shown={Boolean(shown)}
						label={label.toLowerCase()}
						onToggle={onToggleShown}
					/>
				)}
			</div>
			<p
				id={describedBy}
				role="status"
				className={cn(
					'text-xs empty:-mt-1.5',
					problem ? 'text-destructive' : 'text-muted-foreground',
				)}
			>
				{problem ?? hint}
			</p>
		</div>
	);
}

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
	const valueProblem =
		draft.value.length > 0 ? validateCredential(draft.value) : null;
	const confirmProblem =
		draft.confirm.length > 0 && !sameCredential(draft.confirm, draft.value)
			? 'The two entries do not match.'
			: null;
	return (
		<div className="grid gap-3">
			<ShowHideField
				id={`${id}-value`}
				label={PASSWORD_LABEL}
				value={draft.value}
				shown={shown}
				problem={valueProblem}
				hint={weakPasswordHint(draft.value)}
				describedBy={`${id}-value-help`}
				autoComplete="new-password"
				disabled={disabled}
				onToggleShown={() => setShown(!shown)}
				onChange={(value) => onChange({...draft, value})}
			/>
			<ShowHideField
				id={`${id}-confirm`}
				label={`Confirm ${PASSWORD_LABEL.toLowerCase()}`}
				value={draft.confirm}
				shown={shown}
				problem={confirmProblem}
				describedBy={`${id}-confirm-help`}
				autoComplete="new-password"
				disabled={disabled}
				onChange={(confirm) => onChange({...draft, confirm})}
			/>
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
					I understand that a lost password cannot be recovered.
				</Label>
			</div>
		</div>
	);
}

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
			<Label htmlFor={`${id}-entry`}>{PASSWORD_LABEL}</Label>
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
					onChange={(event) => onChange(event.target.value)}
				/>
				<ShowHideButton
					shown={shown}
					label="password"
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
