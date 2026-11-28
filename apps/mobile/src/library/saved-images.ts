import {IMAGE_DELETED} from '../../../extension/src/shared/image-store';
import {copyLinkUrls} from '../../../extension/src/shared/page-copy';
import {isRecord} from '../../../extension/src/shared/library-values';
import {showSnack} from '../ui/snackbar';
import {
	hideImageThumb,
	putImageThumbs,
	refreshImageThumbs,
	removeImageThumb,
	showImageThumb,
	sweepImageThumbs,
} from './image-thumbs';
import {
	getLibrary,
	mutateRegular,
	nudgeRegular,
	subscribeLibrary,
	whenLibraryLoaded,
} from './library-store';
import {onTrashChange, readTrash} from './trash-storage';
import {isPrivateView} from './view';

const SWEEP_DELAY_MS = 2 * 60_000;
const pendingUrls = new Set<string>();

async function liveUrls(): Promise<Set<string>> {
	const library = getLibrary();
	const live = copyLinkUrls(
		library,
		await readTrash('regular', library.settings.trashRetentionDays),
	);
	for (const url of pendingUrls) {
		live.add(url);
	}

	return live;
}

async function sweep() {
	const gone = await mutateRegular(async () => {
		const live = await liveUrls();
		return sweepImageThumbs(live);
	});
	if (gone > 0) {
		nudgeRegular();
	}
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleSweep = () => {
	clearTimeout(sweepTimer);
	sweepTimer = setTimeout(() => {
		void sweep().catch(() => undefined);
	}, SWEEP_DELAY_MS);
};

export async function startSavedImages(): Promise<void> {
	await refreshImageThumbs();
	if (!(await whenLibraryLoaded())) {
		return;
	}

	subscribeLibrary(scheduleSweep);
	onTrashChange(scheduleSweep);
	await sweep().catch(() => undefined);
}

async function commitDelete(url: string): Promise<void> {
	let removed = false;
	try {
		removed = Boolean(await mutateRegular(async () => removeImageThumb(url)));
	} finally {
		pendingUrls.delete(url);
	}

	if (removed) {
		nudgeRegular();
	}
}

export async function deleteImageWithUndo(
	url: string,
	reopen: (url: string) => void,
): Promise<void> {
	if (!hideImageThumb(url)) {
		return;
	}

	pendingUrls.add(url);
	let undone = false;
	showSnack(IMAGE_DELETED, {
		label: 'Undo',
		run() {
			undone = true;
			pendingUrls.delete(url);
			showImageThumb(url);
			if (!isPrivateView()) {
				reopen(url);
			}
		},
		closed() {
			if (undone) {
				return;
			}

			void commitDelete(url).catch(() => undefined);
		},
	});
}

export async function restoreImageThumbs(
	values: readonly unknown[],
): Promise<void> {
	await mutateRegular(async () => {
		const live = await liveUrls();
		await putImageThumbs(
			values.filter(
				(value) =>
					isRecord(value) &&
					typeof value.url === 'string' &&
					live.has(value.url),
			),
		);
	});
	nudgeRegular();
}
