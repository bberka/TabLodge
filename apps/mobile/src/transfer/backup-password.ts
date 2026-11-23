import {
	validateCredential,
	weakPasswordHint,
} from '../../../extension/src/shared/passcode';

export type BackupPasswordNote = {
	problem?: string;
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
