import type {TabLodgeMessageType} from './types';

export const UNDOABLE_EDITS = [
	{type: 'UPDATE_GROUP', label: 'Edit session', done: 'Session updated.'},
	{type: 'ARCHIVE_GROUP', label: 'Archive session', done: 'Session archived.'},
	{
		type: 'SET_GROUP_ORDER',
		label: 'Reorder sessions',
		done: 'Sessions reordered.',
	},
	{type: 'CREATE_FOLDER', label: 'Create folder', done: 'Folder created.'},
	{type: 'UPDATE_FOLDER', label: 'Edit folder', done: 'Folder updated.'},
	{type: 'MOVE_TAB', label: 'Move link', done: 'Link moved.'},
	{type: 'UPDATE_TAB', label: 'Edit link', done: 'Link updated.'},
	{type: 'ADD_BOOKMARK', label: 'Add bookmark', done: 'Bookmark saved.'},
	{
		type: 'UPDATE_BOOKMARK',
		label: 'Edit bookmark',
		done: 'Bookmark updated.',
	},
	{
		type: 'CREATE_BOOKMARK_COLUMN',
		label: 'Create column',
		done: 'Column created.',
	},
	{
		type: 'UPDATE_BOOKMARK_COLUMN',
		label: 'Edit column',
		done: 'Column updated.',
	},
	{
		type: 'REORDER_BOOKMARK_COLUMN',
		label: 'Move column',
		done: 'Column moved.',
	},
	{type: 'REORDER_BOOKMARK', label: 'Move bookmark', done: 'Bookmark moved.'},
] as const satisfies ReadonlyArray<{
	type: TabLodgeMessageType;
	label: string;
	done: string;
}>;

export type UndoableEdit = (typeof UNDOABLE_EDITS)[number]['type'];

export const UNDO_WINDOW_MS = 120_000;
export const UNDO_OFFER_MS = UNDO_WINDOW_MS - 10_000;
export const undoExpiry = () => Date.now() + UNDO_OFFER_MS;

export const undoableEdit = (type: string) =>
	UNDOABLE_EDITS.find((edit) => edit.type === type);
