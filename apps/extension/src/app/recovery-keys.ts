const RECOVERY_STORAGE_KEY = /\.(?:trash|backups|snapshots|images)$/;

export function isRecoveryStorageKey(key: string): boolean {
	return RECOVERY_STORAGE_KEY.test(key);
}
