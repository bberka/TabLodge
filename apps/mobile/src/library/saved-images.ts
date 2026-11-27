import {IMAGE_DELETED} from '../../../extension/src/shared/image-store';
import {copyLinkUrls} from '../../../extension/src/shared/page-copy';
import {isRecord} from '../../../extension/src/shared/library-values';
import {showSnack} from '../ui/snackbar';
import {
	putImageThumbs,
	refreshImageThumbs,
	removeImageThumb,
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

const SWEEP_DELAY_MS = 2 * 60_000;

async function liveUrls(): Promise<Set<string>> {
	const library = getLibrary();
	return copyLinkUrls(
		library,
		await readTrash('regular', library.settings.trashRetentionDays),
	);
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

export async function deleteImageWithUndo(
	url: string,
	reopen: (url: string) => void,
): Promise<void> {
	const removed = await mutateRegular(async () => removeImageThumb(url));
	if (!removed) {
		return;
	}

	nudgeRegular();
	showSnack(IMAGE_DELETED, {
		label: 'Undo',
		async run() {
			await mutateRegular(async () => {
				await putImageThumbs([removed]);
			});
			nudgeRegular();
			reopen(url);
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
