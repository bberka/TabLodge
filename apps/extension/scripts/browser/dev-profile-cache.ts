import {rm} from 'node:fs/promises';
import {join} from 'node:path';

export function serviceWorkerCachePath(userDataDir: string): string {
	return join(userDataDir, 'Default', 'Service Worker');
}

export function clearServiceWorkerCache(userDataDir: string): Promise<void> {
	return rm(serviceWorkerCachePath(userDataDir), {
		recursive: true,
		force: true,
	});
}
