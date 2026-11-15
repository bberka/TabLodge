import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {emptyStore} from '../src/library/store-shape';
import {
	addFolder,
	addSession,
	isArchivedSession,
} from '../src/library/session-edits';
import {
	archiveSessions,
	deleteSessions,
	moveSessions,
	moveSessionsBack,
	restoreSessions,
	returnSessions,
	saveSessionDetails,
	selectionOf,
	sessionCount,
} from '../src/screens/sessions/session-changes';

const NOW = 1_700_000_000_000;
const clock = () => NOW + 1;

function library() {
	let store = addFolder(
		emptyStore(NOW),
		{name: 'Work', icon: '', color: '', colorSessions: false},
		'work',
		NOW,
	);
	store = addSession(
		store,
		{name: 'One', urls: ['https://a.test/'], folderId: 'work'},
		's1',
		['t1'],
		NOW,
	);
	store = addSession(
		store,
		{name: 'Two', urls: ['https://b.test/']},
		's2',
		['t2'],
		NOW,
	);
	return store;
}

const find = (store: ReturnType<typeof library>, id: string) =>
	store.groups.find((session) => session.id === id);
const folderOf = (store: ReturnType<typeof library>, id: string) =>
	find(store, id)?.folderId;

describe('the sessions screen changes', () => {
	test('counts sessions with the right noun', () => {
		assert.equal(sessionCount(1), '1 session');
		assert.equal(sessionCount(0), '0 sessions');
		assert.equal(sessionCount(3), '3 sessions');
	});

	test('reads what a selection means for the buttons', () => {
		const archived = archiveSessions(
			library(),
			[find(library(), 's1')!],
			true,
			clock,
		);
		const shown = archived.groups;
		const none = selectionOf(shown, new Set(), archived.folders);
		assert.deepEqual(none.chosen, []);
		assert.equal(none.isAllSelected, false);
		const one = selectionOf(shown, new Set(['s1']), archived.folders);
		assert.equal(one.chosen.length, 1);
		assert.equal(one.isAllSelected, false);
		assert.equal(one.allArchived, true);
		const both = selectionOf(shown, new Set(['s1', 's2']), archived.folders);
		assert.equal(both.isAllSelected, true);
		assert.equal(both.allArchived, false);
		assert.equal(
			selectionOf([], new Set(['s1']), archived.folders).isAllSelected,
			false,
		);
	});

	test('deletes sessions and restores them', () => {
		const store = library();
		const gone = deleteSessions(store, store.groups, clock);
		assert.equal(gone.groups.length, 0);
		const back = restoreSessions(gone, store.groups, clock);
		assert.deepEqual(back.groups.map((session) => session.id).toSorted(), [
			's1',
			's2',
		]);
	});

	test('archives sessions, unarchives them, and puts them back', () => {
		const store = library();
		const archived = archiveSessions(store, store.groups, true, clock);
		assert.ok(
			archived.groups.every((session) =>
				isArchivedSession(archived.folders, session),
			),
		);
		const open = archiveSessions(archived, archived.groups, false, clock);
		assert.ok(
			open.groups.every((session) => !isArchivedSession(open.folders, session)),
		);
		const returned = returnSessions(archived, store.groups, clock);
		assert.equal(folderOf(returned, 's1'), 'work');
		assert.equal(folderOf(returned, 's2'), find(store, 's2')!.folderId);
	});

	test('moves sessions to a folder and back', () => {
		const store = library();
		const was = new Map(
			store.groups.map((session) => [session.id, session.folderId]),
		);
		const moved = moveSessions(store, ['s1', 's2'], 'work', clock);
		assert.equal(folderOf(moved, 's2'), 'work');
		const undone = moveSessionsBack(moved, ['s1', 's2'], was, 'work', clock);
		assert.equal(folderOf(undone, 's1'), 'work');
		assert.equal(folderOf(undone, 's2'), find(store, 's2')!.folderId);
		// A session with no recorded folder goes to the fallback.
		const fallback = moveSessionsBack(store, ['s2'], new Map(), 'work', clock);
		assert.equal(folderOf(fallback, 's2'), 'work');
	});

	test('saves name, description, folder and color in one change', () => {
		const store = library();
		const session = find(store, 's2')!;
		const saved = saveSessionDetails(
			store,
			session,
			{
				name: ' Renamed ',
				description: 'About it',
				color: '#ff0000',
				folderId: 'work',
			},
			clock,
		);
		const found = saved.groups.find((entry) => entry.id === 's2');
		assert.equal(found?.name, 'Renamed');
		assert.equal(found?.description, 'About it');
		assert.equal(found?.folderId, 'work');
		assert.equal(found?.color, '#ff0000');
		// The folder is left alone when it is the one it is in, and a missing description clears it.
		const same = saveSessionDetails(
			saved,
			saved.groups.find((entry) => entry.id === 's2')!,
			{name: 'Renamed'},
			clock,
		);
		const kept = same.groups.find((entry) => entry.id === 's2');
		assert.equal(kept?.folderId, 'work');
		assert.equal(kept?.description, '');
	});
});
