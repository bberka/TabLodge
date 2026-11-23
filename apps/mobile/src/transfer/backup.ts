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
import type {PageCopy} from '../../../extension/src/shared/page-copy';
import {unwrapKey, wrapKey} from '../../modules/tablodge-crypto';
import {backupPreferences} from '../settings/preferences';
import {isStore} from '../library/store-shape';

const CHUNK = 0x20_00;

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(index, index + CHUNK));
	}

	// eslint-disable-next-line no-restricted-globals -- Hermes has no base64 for typed arrays, so the platform's btoa does it
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
	// eslint-disable-next-line no-restricted-globals -- Hermes has no base64 for typed arrays, so the platform's atob does it
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.codePointAt(index) ?? 0;
	}

	return bytes;
}

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

export async function buildBackup(
	store: Store,
	appName: string,
	password?: string,
	library: 'regular' | 'private' = 'regular',
	copies: readonly PageCopy[] = [],
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
			copies,
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
			phoneSettings: unknown;
			createdAt: string;
			counts: FullBackupCounts;
			copies: unknown[];
			skipped: number;
	  }
	| {ok: false; reason: 'password' | 'wrong' | 'damaged'; message: string};

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
			counts: {...counts, copies: contents.counts.copies},
			copies: Array.isArray(contents.copies) ? contents.copies : [],
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
