import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'vite-plus/test';
import {UNDOABLE_EDITS} from '../src/shared/undo-policy';

const read = (...parts: string[]) =>
	readFileSync(join(import.meta.dirname, '..', ...parts), 'utf8');
const typesSource = read('src', 'shared', 'types.ts');
const workerSource = read('shell', 'service-worker.ts');

const block = (source: string, start: string) => {
	const from = source.indexOf(start);
	return source.slice(from, source.indexOf('\n};\n', from));
};

const messageTypes = [
	...block(typesSource, 'export type TabLodgeMessages').matchAll(
		/^\t([A-Z_]+):/gm,
	),
].map((match) => match[1]);

const editsWithOwnUndo = [
	'DELETE_FOLDER',
	'ADD_LINKS_TO_SESSION',
	'CREATE_SESSION_FROM_LINKS',
	'UPDATE_GROUP_FROM_WINDOW',
	'SPLIT_GROUP',
	'MERGE_GROUPS',
	'SEND_TO_PRIVATE',
	'SAVE_QUOTE',
	'ADD_BOOKMARKS',
	'IMPORT_GROUPS',
	'IMPORT_SESSIONS',
	'IMPORT_BOOKMARKS_FILE',
	'IMPORT_BROWSER_BOOKMARKS',
	'RESET_SETTINGS',
	'ERASE_DATA',
	'DELETE_SNAPSHOT',
	'CLEAR_SNAPSHOTS',
	'RESTORE_BACKUP',
	'DELETE_BACKUP',
	'DELETE_TRASH',
	'EMPTY_TRASH',
	'SITE_SOURCE_SAVE',
	'SITE_SOURCE_CATCH_UP_ADD',
];
const deletesUndoneFromTrash = [
	'DELETE_GROUP',
	'DELETE_TAB',
	'DELETE_BOOKMARK',
	'REMOVE_DUPLICATE_BOOKMARKS',
	'DELETE_BOOKMARK_COLUMN',
];
const settingsThatConfirm = [
	'UPDATE_SETTINGS',
	'ADD_EXCLUDED_ORIGIN',
	'ADD_EXCLUDED_ORIGINS',
	'REMOVE_EXCLUDED_ORIGIN',
	'SET_PRIVATE_CONFIG',
	'SET_PRIVATE_NEW_TAB_REDIRECT',
	'SET_PRIVATE_ACCENT',
	'SET_PRIVATE_LOCK_IDLE',
	'SET_SITE_SOURCE',
	'SET_SITE_SOURCE_COLUMN',
	'SET_SITE_SOURCE_KEEP_OFF',
	'SITE_SOURCE_MODE',
	'SITE_SOURCE_CATCH_UP_DISMISS',
	'DISMISS_RECOVERY',
];
const savesAndRestoresWithTheirOwnToast = [
	'SAVE_TABS',
	'SAVE_CURRENT_TAB_TO_GROUP',
	'RESTORE_GROUP',
	'SWITCH_WORKSPACE',
	'RESTORE_SNAPSHOT',
	'SAVE_SNAPSHOT_AS_SESSION',
	'RESTORE_TRASH',
	'RESTORE_FULL_BACKUP',
	'BACKUP_NOW',
	'KEEP_PAGE_COPY',
	'DELETE_PAGE_COPY',
	'ADD_PAGE_COPIES',
	'DELETE_SAVED_IMAGE',
	'ADD_SAVED_IMAGES',
	'UPLOAD_SHARED_PAGE',
	'DELETE_SHARED_PAGE',
	'HANDOFF_NEW_TAB',
];
const notLibraryEdits = [
	'GET_PRIVATE_CONFIG',
	'GET_LINK_PREVIEW',
	'GET_SERVER_ICONS',
	'GET_SERVER_ICON',
	'GET_PRIVATE_LOCK',
	'UNLOCK_PRIVATE',
	'LOCK_PRIVATE',
	'TOUCH_PRIVATE_LOCK',
	'ENABLE_PRIVATE_LOCK',
	'CHANGE_PRIVATE_LOCK_CREDENTIAL',
	'REMOVE_PRIVATE_LOCK',
	'RESET_PRIVATE_LIBRARY',
	'GET_PRIVATE_SERVER',
	'JOIN_PRIVATE_SERVER',
	'GET_STATE',
	'GET_STATE_CHANGES',
	'GET_BOOKMARK_PROMPT',
	'GET_SETTINGS_DEFAULTS',
	'PREVIEW_SESSION_NAME',
	'GET_SNAPSHOTS',
	'GET_BACKUPS',
	'GET_BACKUP_DATA',
	'GET_FULL_BACKUP',
	'GET_PAGE_COPIES',
	'GET_PAGE_COPY',
	'GET_SAVED_IMAGES',
	'GET_IMAGE_THUMBS',
	'GET_SAVED_IMAGE',
	'GET_TRASH',
	'GET_STORAGE_USAGE',
	'SYNC_STATUS',
	'SYNC_CONNECT',
	'SYNC_DISCONNECT',
	'SYNC_NOW',
	'PRIVATE_SYNC_STATUS',
	'PRIVATE_SYNC_ENABLE',
	'PRIVATE_SYNC_DISABLE',
	'PRIVATE_SYNC_NOW',
	'OPEN_PRIVATE_SYNC',
	'GET_SHARED_PAGES',
	'GET_SITE_SOURCES',
	'SITE_SOURCES_POINTED',
	'SITE_SOURCE_UNREADABLE',
	'SITE_SOURCE_PENDING',
	'SITE_SOURCE_CATCH_UP',
	'SITE_SOURCE_UNDO',
	'SITE_SOURCE_UNDO_SEEN',
	'QUOTE_UNDO',
	'TRASH_UNDO',
	'SHOW_TRASH_UNDO',
	'TOAST_PREFS',
	'UNDO',
	'DROP_UNDO',
	'SEND_TO_PRIVATE_STATE',
];

test('every message is classified, so a new library edit cannot skip the shared Undo', () => {
	const classified = new Set([
		...UNDOABLE_EDITS.map((edit) => edit.type),
		...editsWithOwnUndo,
		...deletesUndoneFromTrash,
		...settingsThatConfirm,
		...savesAndRestoresWithTheirOwnToast,
		...notLibraryEdits,
	]);
	const unclassified = messageTypes.filter((type) => !classified.has(type));
	assert.deepEqual(
		unclassified,
		[],
		'A new message must go in UNDOABLE_EDITS (src/shared/undo-policy.ts) when it changes the library, or in one of the lists in this test with a reason.',
	);
	const unknown = [...classified].filter(
		(type) => !messageTypes.includes(type),
	);
	assert.deepEqual(unknown, []);
});

test('every undoable edit replies with an undoId and runs through the shared Undo in the worker', () => {
	const responses = block(typesSource, 'export type TabLodgeResponses');
	for (const {type} of UNDOABLE_EDITS) {
		const rest = responses.slice(responses.indexOf(`\n\t${type}:`) + 1);
		const entry = rest.split(/\n\t[A-Z_]+:/, 1)[0];
		assert.match(entry, /Undoable/, `${type} reply must include Undoable`);
		assert.ok(
			workerSource.includes(`mutateWithUndo('${type}'`),
			`${type} must run through mutateWithUndo in the service worker`,
		);
	}
});
