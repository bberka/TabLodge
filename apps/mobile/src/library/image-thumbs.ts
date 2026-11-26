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

let thumbs: ReadonlyMap<string, PhoneImage> = new Map();
const listeners = new Set<() => void>();

export async function refreshImageThumbs(): Promise<void> {
	thumbs = new Map(
		(await images.thumbs()).map(({thumb, held: _held, ...meta}) => [
			meta.url,
			{...meta, uri: thumbDataUrl(thumb)},
		]),
	);
	for (const listener of listeners) {
		listener();
	}
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
	const [found] = await images.thumbs([url]);
	if (!found) {
		return undefined;
	}

	await images.remove(url);
	await refreshImageThumbs();
	const {held: _held, ...thumb} = found;
	return thumb;
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
