/*
Builds the full backup the phone saves: the extension's own ZIP layout, so the extension can restore it, with the whole
library as `data.json`. A password wraps the ZIP in the same envelope the extension writes, using the phone's native
PBKDF2 and AES-GCM, since Hermes has no WebCrypto.
*/
import Constants from 'expo-constants';
import {looksEncrypted} from '../../extension/src/shared/crypto-envelope';
import {
	buildFullBackup,
	FullBackupError,
	type FullBackupCounts,
	fullBackupFilename,
	protectedFullBackupFilename,
	readFullBackup,
} from '../../extension/src/shared/full-backup';
import type {Store} from '../../extension/src/shared/types';
import {unwrapKey, wrapKey} from '../modules/tablodge-crypto';
import {backupPreferences} from './preferences';
import {isStore} from './library';

const CHUNK = 0x80_00;

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(index, index + CHUNK));
	}

	// Hermes has no Uint8Array.toBase64, so the platform's btoa does it.
	// eslint-disable-next-line no-restricted-globals
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	// eslint-disable-next-line no-restricted-globals
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.codePointAt(index) ?? 0;
	}

	return bytes;
}

export type BackupFile = {filename: string; bytes: Uint8Array; mime: string};

/**
The whole library as a full-backup ZIP, or, with a password, as that ZIP inside the credential envelope (a file that
ends in `.zip.enc`, as the extension names it). The phone has no browser snapshots or trash, so those parts are empty.
*/
export async function buildBackup(
	store: Store,
	appName: string,
	password?: string,
): Promise<BackupFile> {
	const now = new Date();
	const {bytes} = buildFullBackup(
		{
			state: {
				...store,
				settings: {...store.settings, mobileApp: backupPreferences()},
			},
			preferences: null,
			snapshots: null,
			trash: null,
		},
		{appVersion: Constants.expoConfig?.version ?? '', now},
	);
	if (password === undefined || password === '') {
		return {
			filename: fullBackupFilename(appName, now),
			bytes,
			mime: 'application/zip',
		};
	}

	const wrapped = await wrapKey(toBase64(bytes), password);
	return {
		filename: protectedFullBackupFilename(appName, now),
		bytes: fromBase64(wrapped),
		mime: 'application/octet-stream',
	};
}

export type BackupRead =
	| {
			ok: true;
			store: Store;
			/**
			The phone's own settings in the backup, or undefined when it was made by the extension.
			*/
			phoneSettings: unknown;
			createdAt: string;
			counts: FullBackupCounts;
	  }
	| {ok: false; reason: 'password' | 'wrong' | 'damaged'; message: string};

/**
Reads a backup file: a full-backup ZIP, or the same inside the credential envelope, which asks for its password first.
*/
export async function readBackup(
	bytes: Uint8Array,
	password?: string,
): Promise<BackupRead> {
	let zip = bytes;
	if (looksEncrypted(bytes)) {
		if (password === undefined || password === '') {
			return {
				ok: false,
				reason: 'password',
				message: 'This backup is locked with a password.',
			};
		}

		try {
			const opened = await unwrapKey(toBase64(bytes), password);
			if (opened === null) {
				return {
					ok: false,
					reason: 'wrong',
					message: 'The password is wrong, or the file has been changed.',
				};
			}

			zip = fromBase64(opened);
		} catch {
			return {
				ok: false,
				reason: 'damaged',
				message: 'This encrypted file is damaged.',
			};
		}
	}

	try {
		const contents = readFullBackup(zip);
		if (!contents || !isStore(contents.state)) {
			return {
				ok: false,
				reason: 'damaged',
				message: 'This is not a TabLodge backup.',
			};
		}

		return {
			ok: true,
			store: contents.state,
			phoneSettings: contents.state.settings?.mobileApp,
			createdAt: contents.manifest.createdAt,
			counts: contents.counts,
		};
	} catch (error) {
		return {
			ok: false,
			reason: 'damaged',
			message:
				error instanceof FullBackupError
					? error.message
					: 'This file could not be read.',
		};
	}
}
