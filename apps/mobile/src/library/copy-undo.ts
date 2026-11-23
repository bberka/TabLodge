import {
	COPY_DELETED,
	type PageCopy,
} from '../../../extension/src/shared/page-copy';
import {showSnack} from '../ui/snackbar';
import {deleteCopy, putCopyBack} from './page-copies';

export async function deleteCopyWithUndo(
	url: string,
	reopen: (url: string) => void,
): Promise<void> {
	const removed: PageCopy | undefined = await deleteCopy(url);
	if (!removed) {
		return;
	}

	showSnack(COPY_DELETED, {
		label: 'Undo',
		async run() {
			const outcome = await putCopyBack(removed);
			if (outcome.ok) {
				reopen(url);
			} else {
				showSnack(outcome.error);
			}
		},
	});
}
