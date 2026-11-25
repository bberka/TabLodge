export const SESSIONS_FORMAT_ID = 'tablodge-sessions';
export const BOOKMARKS_FORMAT_ID = 'tablodge';
export const BACKUP_FORMAT_ID = 'tablodge-backup';
export const BACKUP_VERSION = 1;

export function fileNamePrefix(appName: string): string {
	return (
		appName
			.toLowerCase()
			.normalize('NFKD')
			.replaceAll(/[^0-9a-z]+/g, '-')
			.replaceAll(/^-+|-+$/g, '') || 'backup'
	);
}

export const FULL_BACKUP_FORMAT_ID = 'tablodge-full-backup';
export const FULL_BACKUP_VERSION = 1;
