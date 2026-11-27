import {useSyncExternalStore} from 'react';
import {
	IMAGE_DELETED,
	IMAGE_INDEX_KEY,
	thumbDataUrl,
	base64ToBytes,
	type SavedImage,
	type SavedThumb,
} from '../shared/image-store';
import {
	backupImageFile,
	backupImages,
	type FullBackupParts,
} from '../shared/full-backup';
import {send} from './message-client';
import type {ShowStatus} from './common';

export type BoardImage = {thumb: string; held: boolean; savedAt: number};

export function imageViewerUrl(url: string) {
	return chrome.runtime.getURL(
		`image.html?${new URLSearchParams({url}).toString()}`,
	);
}

export async function openSavedImage(url: string, windowId?: number) {
	await chrome.tabs.create({
		url: imageViewerUrl(url),
		...(windowId !== undefined && {windowId}),
	});
}

let images: ReadonlyMap<string, BoardImage> = new Map();
const listeners = new Set<() => void>();
let watching = false;
let latestLoad = 0;

async function loadImages() {
	const run = ++latestLoad;
	const listed = await send('GET_SAVED_IMAGES');
	if (!listed.ok || run !== latestLoad) {
		return;
	}

	const next = new Map<string, BoardImage>();
	const missing: string[] = [];
	for (const item of listed.items) {
		const known = images.get(item.url);
		if (known?.savedAt === item.savedAt) {
			next.set(item.url, {...known, held: item.held > 0});
		} else {
			missing.push(item.url);
		}
	}

	if (missing.length > 0) {
		const fetched = await send('GET_IMAGE_THUMBS', {urls: missing});
		if (run !== latestLoad) {
			return;
		}

		for (const thumb of fetched.ok ? fetched.thumbs : []) {
			next.set(thumb.url, {
				thumb: thumbDataUrl(thumb.thumb),
				held: listed.items.some(
					(item) => item.url === thumb.url && item.held > 0,
				),
				savedAt: thumb.savedAt,
			});
		}
	}

	images = next;
	for (const listener of listeners) {
		listener();
	}
}

export function getSavedImages(): ReadonlyMap<string, BoardImage> {
	return images;
}

export function watchSavedImages(listener: () => void) {
	listeners.add(listener);
	if (!watching && !chrome.extension.inIncognitoContext) {
		watching = true;
		void loadImages();
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === 'local' && Object.hasOwn(changes, IMAGE_INDEX_KEY)) {
				void loadImages();
			}
		});
	}

	return () => {
		listeners.delete(listener);
	};
}

export function useSavedImages(): ReadonlyMap<string, BoardImage> {
	return useSyncExternalStore(watchSavedImages, getSavedImages);
}

export type LoadedSavedImage = {
	image: SavedImage | null;
	thumb: SavedThumb | null;
	error: string;
};

export async function loadSavedImage(
	url: string,
	showStatus: ShowStatus,
	isLive: () => boolean = () => true,
): Promise<LoadedSavedImage | undefined> {
	const result = url
		? await send('GET_SAVED_IMAGE', {url})
		: {ok: true as const, image: null, thumb: null};
	if (!isLive()) {
		return undefined;
	}

	if (!result.ok) {
		showStatus(result.error, true);
		return {image: null, thumb: null, error: result.error};
	}

	return {image: result.image, thumb: result.thumb, error: ''};
}

export async function deleteSavedImage(
	url: string,
	showStatus: ShowStatus,
	after: () => unknown = () => undefined,
) {
	const before = await send('GET_SAVED_IMAGE', {url});
	if (!before.ok) {
		showStatus(before.error, true);
		return;
	}

	const kept: SavedImage | SavedThumb | null = before.image ?? before.thumb;
	const result = await send('DELETE_SAVED_IMAGE', {url});
	if (!result.ok) {
		showStatus(result.error, true);
		return;
	}

	await after();
	showStatus(
		IMAGE_DELETED,
		false,
		kept
			? {
					action: {
						label: 'Undo',
						async onClick() {
							const back = await send('ADD_SAVED_IMAGES', {images: [kept]});
							if (back.ok && back.images === 1) {
								showStatus('Undone: Delete image.', false, {toast: true});
								await after();
							} else {
								showStatus('Could not undo that.', true);
							}
						},
					},
				}
			: {toast: true},
	);
}

export async function backupImageParts(
	thumbs: ReadonlyArray<SavedThumb & {held: boolean}>,
): Promise<Required<Pick<FullBackupParts, 'images' | 'imageFiles'>>> {
	const imageFiles: Record<string, Uint8Array> = {};
	for (const thumb of thumbs) {
		if (!thumb.held) {
			continue;
		}

		const read = await send('GET_SAVED_IMAGE', {url: thumb.url});
		if (!read.ok) {
			throw new Error(read.error || 'Could not read a saved image.');
		}

		if (!read.image) {
			throw new Error('Could not read a saved image.');
		}

		imageFiles[backupImageFile(read.image)] = base64ToBytes(read.image.data);
	}

	return {images: thumbs.map(({held: _held, ...thumb}) => thumb), imageFiles};
}

export type RestoreImagesResult = {
	restored: number;
	failed: number;
	error?: string;
};

export async function restoreBackupImages(
	parts: Pick<FullBackupParts, 'images' | 'imageFiles'>,
): Promise<RestoreImagesResult> {
	let restored = 0;
	let failed = 0;
	let error: string | undefined;
	for (const image of backupImages(parts)) {
		const added = await send('ADD_SAVED_IMAGES', {images: [image]});
		if (added.ok) {
			restored += added.images;
		} else {
			failed += 1;
			error ??= added.error;
		}
	}

	return {restored, failed, error};
}
