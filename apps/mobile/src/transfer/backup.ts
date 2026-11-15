/*
Builds the full backup the phone saves: the extension's own ZIP layout, so the extension can restore it, with the whole
library as `data.json`. A password wraps the ZIP in the same envelope the extension writes, using the phone's native
PBKDF2 and AES-GCM, since Hermes has no WebCrypto.
*/
import Constants from 'expo-constants';
import {looksEncrypted} from '../../../extension/src/shared/crypto-envelope';
import {
	buildFullBackup,
	countFullBackup,
	FullBackupError,
	type FullBackupCounts,
	fullBackupFilename,
	protectedFullBackupFilename,
	readFullBackup,
} from '../../../extension/src/shared/full-backup';
import {isRecord} from '../../../extension/src/shared/library-values';
import {normalizeStore} from '../../../extension/src/shared/library-normalize';
import type {Store} from '../../../extension/src/shared/types';
import {unwrapKey, wrapKey} from '../../modules/tablodge-crypto';
import {backupPreferences} from '../settings/preferences';
import {isStore} from '../library/library';

// A few thousand arguments at a time: Hermes has a smaller call stack than the browsers this idiom comes from.
const CHUNK = 0x20_00;

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

// Cleaning a library can add a default folder or column, so each kind is compared on its own.
const KEPT_KINDS = [
	'sessions',
	'links',
	'folders',
	'columns',
	'bookmarks',
] as const;
const lostIn = (file: FullBackupCounts, kept: FullBackupCounts) =>
	KEPT_KINDS.reduce(
		(sum, kind) => sum + Math.max(0, file[kind] - kept[kind]),
		0,
	);

export type BackupFile = {filename: string; bytes: Uint8Array; mime: string};

/**
The library on screen as a full-backup ZIP, or, with a password, as that ZIP inside the credential envelope (a file
that ends in `.zip.enc`, as the extension names it). The private library's file says so in its name, since it looks
like any other backup inside. The phone has no browser snapshots, and its trash bin is not part of a backup, so those
parts are empty.
*/
export async function buildBackup(
	store: Store,
	appName: string,
	password?: string,
	library: 'regular' | 'private' = 'regular',
): Promise<BackupFile> {
	const now = new Date();
	const fileApp = library === 'private' ? `${appName} private` : appName;
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
			filename: fullBackupFilename(fileApp, now),
			bytes,
			mime: 'application/zip',
		};
	}

	const wrapped = await wrapKey(toBase64(bytes), password);
	return {
		filename: protectedFullBackupFilename(fileApp, now),
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
			/**
			How many sessions, links, folders, columns, and bookmarks the file held that cannot be kept: damaged ones, and
			those past the limits the extension has too.
			*/
			skipped: number;
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

		// The extension cleans a backup the same way before it restores one, so a damaged or hostile file cannot put
		// anything into the library that the library would not hold itself.
		const store = normalizeStore(contents.state);
		const counts = countFullBackup({
			state: store,
			preferences: null,
			snapshots: null,
			trash: null,
		});
		return {
			ok: true,
			store,
			phoneSettings: isRecord(contents.state.settings)
				? contents.state.settings.mobileApp
				: undefined,
			createdAt: contents.manifest.createdAt,
			counts,
			skipped: lostIn(contents.counts, counts),
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
