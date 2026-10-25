// Identifiers written into JSON backups. Change them here only: export writes them, while import
// recognizes backups by their structure (a `groups` array of sessions, or `bookmarks`/`bookmarkColumns`),
// so files carrying any other id still import.

/**
`format` of a sessions backup (and of exported selected tabs).
*/
export const SESSIONS_FORMAT_ID = 'tablodge-sessions';
/**
`format` of a bookmarks backup.
*/
export const BOOKMARKS_FORMAT_ID = 'tablodge';
/**
`format` of a full backup (sessions, bookmarks and settings in one file), written by the automatic and safety backups.
*/
export const BACKUP_FORMAT_ID = 'tablodge-backup';
/**
Version written next to the format id.
*/
export const BACKUP_VERSION = 1;

/**
Lower-case file-name prefix from the display name (the manifest's short_name), e.g. "TabLodge" → "tablodge".
*/
export function fileNamePrefix(appName: string): string {
	return (
		appName
			.toLowerCase()
			.normalize('NFKD')
			.replaceAll(/[^0-9a-z]+/g, '-')
			.replaceAll(/^-+|-+$/g, '') || 'backup'
	);
}
