// The password a person chooses to protect something with. Shared by every feature that asks for one (encrypted
// backups and the private library lock), so the limit, the check and the wording live in one place. Pure, no browser
// APIs.
//
// There is one kind of secret. Digits only is allowed, and is just a weak password. Older versions let a person pick a
// PIN of 4 to 8 digits; such a PIN still opens what it protected, because opening never checks the length. Only a new
// password is checked.

export type Credential = {
	value: string;
};

export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
/**
Under this many characters, or digits only, a password is easy to guess, and the field says so while it is typed.
*/
export const STRONG_PASSWORD_LENGTH = 8;

/**
What a field keeps of typed or pasted text, so a form stops the input instead of reporting it afterwards. It stops at
the maximum, counted in characters, like `validateCredential`.
*/
export const clampCredentialInput = (value: string) =>
	[...value].slice(0, PASSWORD_MAX_LENGTH).join('');

export const PASSWORD_LABEL = 'Password';

/**
Shown wherever a password is set. There is no reset: nothing is stored that could recover it.
*/
export const LOST_CREDENTIAL_NOTE =
	'If you lose this password, nobody can recover it, and the protected data cannot be opened. TabLodge does not store it or any hint.';

/**
One-line description of what a password accepts, for the hint next to the field.
*/
export const PASSWORD_RULE = `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, any kind.`;

/**
A short hint under the field while a password is typed, when it is short or only digits: anyone who copies the file can
try those offline. Null for a longer password with something besides digits, and for an empty field.
*/
export function weakPasswordHint(value: string): string | null {
	if (value.length === 0) {
		return null;
	}

	return [...value].length < STRONG_PASSWORD_LENGTH || /^\d+$/.test(value)
		? 'Short or number-only passwords are easy to guess.'
		: null;
}

/**
Returns a message for the person when `value` is not an acceptable new password, or null when it is. UI and encryption
both call this, so the limits cannot drift apart. The value is never trimmed: spaces count. Opening something that is
already protected does not call this.
*/
export function validateCredential(value: string): string | null {
	if (value.length === 0) {
		return 'Enter a password.';
	}

	// Count characters, not UTF-16 units, so an emoji is one.
	const {length} = [...value];
	if (length < PASSWORD_MIN_LENGTH) {
		return `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
	}

	return length > PASSWORD_MAX_LENGTH
		? `A password can have at most ${PASSWORD_MAX_LENGTH} characters.`
		: null;
}
