import {useSyncExternalStore} from 'react';
import {
	IMAGE_DELETED,
	IMAGE_INDEX_KEY,
	thumbDataUrl,
	type SavedImage,
} from '../shared/image-store';
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

async function loadImages() {
	const listed = await send('GET_SAVED_IMAGES');
	if (!listed.ok) {
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

function watchImages(listener: () => void) {
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
	return useSyncExternalStore(watchImages, () => images);
}

export async function deleteSavedImage(
	url: string,
	showStatus: ShowStatus,
	after: () => unknown = () => undefined,
) {
	const before = await send('GET_SAVED_IMAGE', {url});
	const kept: SavedImage | null = before.ok ? before.image : null;
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
