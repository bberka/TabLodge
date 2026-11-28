import {useSyncExternalStore} from 'react';
import {
	createImageStore,
	thumbDataUrl,
	type ImageStorage,
	type SavedThumb,
	type SyncedThumb,
} from '../../../extension/src/shared/image-store';
import {readJson, removeKeys, writeJson} from '../platform/storage';

const storage: ImageStorage = {
	async get(keys) {
		const values = await Promise.all(keys.map(async (key) => readJson(key)));
		return Object.fromEntries(
			keys.flatMap((key, index) =>
				values[index] === undefined ? [] : [[key, values[index]]],
			),
		);
	},
	async set(items) {
		await Promise.all(
			Object.entries(items).map(async ([key, value]) => writeJson(key, value)),
		);
	},
	remove: removeKeys,
};

const images = createImageStore(storage);

export type PhoneImage = Omit<SavedThumb, 'thumb'> & {uri: string};

let allThumbs: ReadonlyMap<string, PhoneImage> = new Map();
let thumbs: ReadonlyMap<string, PhoneImage> = new Map();
const hiddenUrls = new Set<string>();
const listeners = new Set<() => void>();

function publish(): void {
	if (hiddenUrls.size === 0) {
		thumbs = allThumbs;
	} else {
		const visible = new Map<string, PhoneImage>();
		for (const [url, image] of allThumbs) {
			if (!hiddenUrls.has(url)) {
				visible.set(url, image);
			}
		}

		thumbs = visible;
	}

	for (const listener of listeners) {
		listener();
	}
}

export async function refreshImageThumbs(): Promise<void> {
	allThumbs = new Map(
		(await images.thumbs()).map(({thumb, held: _held, ...meta}) => [
			meta.url,
			{...meta, uri: thumbDataUrl(thumb)},
		]),
	);
	publish();
}

export const getImageThumbs = (): ReadonlyMap<string, PhoneImage> => thumbs;

export function hideImageThumb(url: string): boolean {
	if (hiddenUrls.has(url) || !allThumbs.has(url)) {
		return false;
	}

	hiddenUrls.add(url);
	publish();
	return true;
}

export function showImageThumb(url: string): void {
	if (!hiddenUrls.delete(url)) {
		return;
	}

	publish();
}

export const useImageThumbs = (): ReadonlyMap<string, PhoneImage> =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => thumbs,
	);

export const thumbSync = {
	read: async (): Promise<SyncedThumb[]> => images.synced(),
	async apply(put: unknown[], remove: string[]): Promise<void> {
		await images.applySynced(put, remove);
		await refreshImageThumbs();
	},
};

export async function removeImageThumb(
	url: string,
): Promise<SavedThumb | undefined> {
	try {
		const [found] = await images.thumbs([url]);
		if (!found) {
			return undefined;
		}

		await images.remove(url);
		const {held: _held, ...thumb} = found;
		return thumb;
	} finally {
		hiddenUrls.delete(url);
		await refreshImageThumbs();
	}
}

export async function putImageThumbs(
	values: readonly unknown[],
): Promise<void> {
	await images.applySynced(values, []);
	await refreshImageThumbs();
}

export async function sweepImageThumbs(
	liveUrls: ReadonlySet<string>,
): Promise<number> {
	const gone = await images.sweep(liveUrls);
	if (gone > 0) {
		await refreshImageThumbs();
	}

	return gone;
}

export const allImageThumbs = async (): Promise<SavedThumb[]> =>
	(await images.thumbs()).map(({held: _held, ...thumb}) => thumb);
