/*
What the backup sheet says about the password typed for a protected backup. Pure, so it is tested without the screen.
A backup is protected only when a password is typed, so an empty field is fine. A password that breaks the rule blocks
Share; one that is short or only digits is allowed and gets a note.
*/
import {
	validateCredential,
	weakPasswordHint,
} from '../../../extension/src/shared/passcode';

export type BackupPasswordNote = {
	/**
	Why the password cannot be used, which also blocks Share.
	*/
	problem?: string;
	/**
	A note that never blocks.
	*/
	hint?: string;
};

export function backupPasswordNote(
	isBackup: boolean,
	password: string,
): BackupPasswordNote {
	if (!isBackup || password === '') {
		return {};
	}

	const problem = validateCredential(password) ?? undefined;
	if (problem) {
		return {problem};
	}

	const hint = weakPasswordHint(password) ?? undefined;
	return hint ? {hint} : {};
}
