import type {DeleteQuestion} from '../../../extension/src/shared/delete-question';
import {confirm} from '../ui/dialog';
import {getLibrary} from './library-store';
import {isPrivateView} from './view';

export function askBeforeDeleting(
	{title, description}: DeleteQuestion,
	remove: () => void,
): void {
	if (!getLibrary().settings.askBeforeDeleting) {
		remove();
		return;
	}

	const askedInPrivate = isPrivateView();
	confirm(title, description, {label: 'Delete', destructive: true}, () => {
		if (isPrivateView() === askedInPrivate) {
			remove();
		}
	});
}
