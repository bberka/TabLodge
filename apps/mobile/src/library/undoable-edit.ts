import type {Store} from '../../../extension/src/shared/types';
import {
	undoableEdit,
	type UndoableEdit,
} from '../../../extension/src/shared/undo-policy';
import {showSnack} from '../ui/snackbar';
import {edit, editIn, type LibraryName} from './library-store';

export const CANT_UNDO = "Can't undo: your data changed since.";

export const editDone = (type: UndoableEdit) => undoableEdit(type)!.done;

export async function editWithUndo(
	message: string,
	change: (current: Store) => Store,
	library?: LibraryName,
): Promise<void> {
	let before: Store | undefined;
	let after: Store | undefined;
	const run = library
		? async (apply: (current: Store) => Store) => editIn(library, apply)
		: edit;
	await run((current) => {
		before = current;
		after = change(current);
		return after;
	});
	if (!before || !after || before === after) {
		return;
	}

	const restored = before;
	const applied = after;
	showSnack(message, {
		label: 'Undo',
		run() {
			void run((current) => {
				if (current === applied) {
					return restored;
				}

				showSnack(CANT_UNDO);
				return current;
			});
		},
	});
}
