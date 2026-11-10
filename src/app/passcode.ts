// The credential a person chooses to protect something with: a PIN or a password.
// Shared by every feature that asks for one (encrypted backups today; locked storage and the private
// window password later), so the limits, the check and the wording live in one place. Pure, no browser APIs.

export type CredentialKind = 'pin' | 'password';

export type Credential = {
	kind: CredentialKind;
	value: string;
};

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const LIMITS: Record<CredentialKind, {min: number; max: number}> = {
	pin: {min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH},
	password: {min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH},
};

export const CREDENTIAL_LABELS: Record<CredentialKind, string> = {
	pin: 'PIN',
	password: 'Password',
};

/**
Shown whenever a PIN is chosen. A PIN has at most 100 million combinations, which a computer can try offline in a short time.
*/
export const PIN_WEAKNESS_NOTE =
	'A PIN is weak. Anyone who copies the file can try every PIN offline, and 4 to 8 digits do not take long. Choose a password for sensitive data.';

/**
Shown wherever a credential is set. There is no reset: nothing is stored that could recover it.
*/
export const LOST_CREDENTIAL_NOTE =
	'If you lose this PIN or password, nobody can recover it, and the protected data cannot be opened. TabLodge does not store it or any hint.';

/**
One-line description of what a kind accepts, for hints next to the field.
*/
export function credentialRule(kind: CredentialKind): string {
	const {min, max} = LIMITS[kind];
	return kind === 'pin'
		? `${min} to ${max} digits (0 to 9).`
		: `${min} to ${max} characters, any kind.`;
}

/**
Returns a message for the person when `value` is not an acceptable credential of `kind`, or null when it is.
UI and encryption both call this, so the limits cannot drift apart. The value is never trimmed: spaces count.
*/
export function validateCredential(
	kind: CredentialKind,
	value: string,
): string | null {
	const {min, max} = LIMITS[kind];
	const label = CREDENTIAL_LABELS[kind];
	if (value.length === 0) {
		return `Enter a ${label}.`;
	}

	if (kind === 'pin' && !/^\d+$/.test(value)) {
		return 'A PIN can only contain the digits 0 to 9.';
	}

	// Count characters, not UTF-16 units, so an emoji is one.
	const {length} = [...value];
	if (length < min) {
		return `A ${label} needs at least ${min} ${kind === 'pin' ? 'digits' : 'characters'}.`;
	}

	return length > max
		? `A ${label} can have at most ${max} ${kind === 'pin' ? 'digits' : 'characters'}.`
		: null;
}
