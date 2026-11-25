export type Credential = {
	value: string;
	verified?: true;
};

export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
export const STRONG_PASSWORD_LENGTH = 8;

export const sameCredential = (a: string, b: string) =>
	a.normalize('NFKC') === b.normalize('NFKC');

export const PASSWORD_LABEL = 'Password';

export const LOST_CREDENTIAL_NOTE =
	'If you lose this password, nobody can recover it, and the protected data cannot be opened. TabLodge does not store it or any hint.';

export const PASSWORD_RULE = `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, any kind.`;

export function weakPasswordHint(value: string): string | null {
	if (value.length === 0) {
		return null;
	}

	const text = value.normalize('NFKC');
	return [...text].length < STRONG_PASSWORD_LENGTH ||
		/^\p{Decimal_Number}+$/u.test(text)
		? 'Short or number-only passwords are easy to guess.'
		: null;
}

export function validateCredential(value: string): string | null {
	if (value.length === 0) {
		return 'Enter a password.';
	}

	const {length} = [...value.normalize('NFKC')];
	if (length < PASSWORD_MIN_LENGTH) {
		return `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
	}

	return length > PASSWORD_MAX_LENGTH
		? `A password can have at most ${PASSWORD_MAX_LENGTH} characters.`
		: null;
}
