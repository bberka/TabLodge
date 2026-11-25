import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';
import {EnvelopeError, decryptBytes, encryptBytes} from './crypto-envelope';
import type {Credential} from './passcode';
import {
	FULL_BACKUP_FORMAT_ID,
	FULL_BACKUP_VERSION,
	fileNamePrefix,
} from './backup-format';
import {dateStamp} from './export-formats';

export type FullBackupParts = {
	state: unknown;
	preferences: unknown;
	snapshots: unknown;
	trash: unknown;
	copies?: unknown;
};

export type FullBackupCounts = {
	sessions: number;
	links: number;
	folders: number;
	columns: number;
	bookmarks: number;
	snapshots: number;
	trash: number;
	copies: number;
};

export type FullBackupManifest = {
	format: typeof FULL_BACKUP_FORMAT_ID;
	version: number;
	appVersion: string;
	createdAt: string;
	counts: FullBackupCounts;
};

export type FullBackupContents = FullBackupParts & {
	manifest: FullBackupManifest;
	counts: FullBackupCounts;
};

export class FullBackupError extends Error {}

const FILES = {
	manifest: 'manifest.json',
	data: 'data.json',
	preferences: 'preferences.json',
	snapshots: 'snapshots.json',
	trash: 'trash.json',
	copies: 'copies.json',
} as const;
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);

export function looksLikeZip(bytes: Uint8Array): boolean {
	return (
		bytes.length > 3 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 3 &&
		bytes[3] === 4
	);
}

export function countFullBackup(parts: FullBackupParts): FullBackupCounts {
	const state = isRecord(parts.state) ? parts.state : {};
	const groups = Array.isArray(state.groups) ? state.groups : [];
	return {
		sessions: groups.length,
		links: groups.reduce<number>(
			(sum, group) => sum + (isRecord(group) ? lengthOf(group.tabs) : 0),
			0,
		),
		folders: lengthOf(state.folders),
		columns: lengthOf(state.bookmarkColumns),
		bookmarks: lengthOf(state.bookmarks),
		snapshots: isRecord(parts.snapshots)
			? lengthOf(parts.snapshots.history)
			: 0,
		trash: isRecord(parts.trash) ? lengthOf(parts.trash.items) : 0,
		copies: lengthOf(parts.copies),
	};
}

export function fullBackupFilename(appName: string, date = new Date()) {
	return `${fileNamePrefix(appName)}-full-${dateStamp(date)}.zip`;
}

export function protectedFullBackupFilename(
	appName: string,
	date = new Date(),
) {
	return `${fullBackupFilename(appName, date)}.enc`;
}

export function protectFullBackup(
	zip: Uint8Array,
	credential: Credential,
): Promise<Uint8Array> {
	return encryptBytes(zip, credential);
}

export async function readProtectedFullBackup(
	bytes: Uint8Array,
	credential: string,
): Promise<FullBackupContents | null> {
	let zip: Uint8Array;
	try {
		zip = await decryptBytes(bytes, credential);
	} catch (error) {
		throw new FullBackupError(
			error instanceof EnvelopeError
				? error.message
				: 'This file could not be decrypted.',
		);
	}

	return readFullBackup(zip);
}

export function buildFullBackup(
	parts: FullBackupParts,
	{appVersion, now = new Date()}: {appVersion: string; now?: Date},
): {bytes: Uint8Array; manifest: FullBackupManifest} {
	const manifest: FullBackupManifest = {
		format: FULL_BACKUP_FORMAT_ID,
		version: FULL_BACKUP_VERSION,
		appVersion,
		createdAt: now.toISOString(),
		counts: countFullBackup(parts),
	};
	const json = (value: unknown) => strToU8(JSON.stringify(value ?? null));
	const bytes = zipSync(
		{
			[FILES.manifest]: strToU8(JSON.stringify(manifest, null, 2)),
			[FILES.data]: json(parts.state),
			[FILES.preferences]: json(parts.preferences),
			[FILES.snapshots]: json(parts.snapshots),
			[FILES.trash]: json(parts.trash),
			[FILES.copies]: json(parts.copies ?? []),
		},
		{level: 6, mtime: now},
	);
	return {bytes, manifest};
}

function parseEntry(files: Record<string, Uint8Array>, name: string): unknown {
	const file = files[name];
	if (!file) {
		return undefined;
	}

	try {
		return JSON.parse(strFromU8(file)) as unknown;
	} catch {
		throw new FullBackupError(`${name} in this backup is damaged.`);
	}
}

export function readFullBackup(bytes: Uint8Array): FullBackupContents | null {
	if (!looksLikeZip(bytes)) {
		return null;
	}

	const wanted = new Set<string>(Object.values(FILES));
	let unpacked = 0;
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter(file) {
				if (!wanted.has(file.name)) {
					return false;
				}

				unpacked += file.originalSize;
				if (unpacked > MAX_UNPACKED_BYTES) {
					throw new FullBackupError('This backup is too large to import.');
				}

				return true;
			},
		});
	} catch (error) {
		throw error instanceof FullBackupError
			? error
			: new FullBackupError('This ZIP file is damaged and could not be read.');
	}

	let manifest: unknown;
	try {
		manifest = parseEntry(files, FILES.manifest);
	} catch {
		return null;
	}

	if (!isRecord(manifest) || manifest.format !== FULL_BACKUP_FORMAT_ID) {
		return null;
	}

	const version = Number(manifest.version);
	if (!Number.isSafeInteger(version) || version < 1) {
		throw new FullBackupError('This backup has no valid version.');
	}

	if (version > FULL_BACKUP_VERSION) {
		throw new FullBackupError('This backup is from a newer TabLodge version.');
	}

	const state = parseEntry(files, FILES.data);
	if (!isRecord(state)) {
		throw new FullBackupError('This backup has no data.json.');
	}

	const parts: FullBackupParts = {
		state,
		preferences: parseEntry(files, FILES.preferences),
		snapshots: parseEntry(files, FILES.snapshots),
		trash: parseEntry(files, FILES.trash),
		copies: parseEntry(files, FILES.copies) ?? [],
	};
	const counts = countFullBackup(parts);
	return {
		...parts,
		manifest: {
			format: FULL_BACKUP_FORMAT_ID,
			version,
			appVersion:
				typeof manifest.appVersion === 'string'
					? manifest.appVersion.slice(0, 40)
					: '',
			createdAt:
				typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
			counts,
		},
		counts,
	};
}
