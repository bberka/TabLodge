/*
Pure edits of the synced library's sessions and their folders, on the same `Store` as `board-edits.ts`.
*/
import type {
	Folder,
	SavedTab,
	Session,
	Settings,
	Store,
} from '../../../extension/src/shared/types';
import {isColumnColor} from '../../../extension/src/shared/accent-colors';
import type {DeviceStamp} from '../../../extension/src/shared/device';
import {
	findOrAddArchivedFolder,
	normalizeNotes,
} from '../../../extension/src/shared/library-normalize';
import {
	FOLDER_LIMIT_MESSAGE,
	folderLimitReached,
	folderNameProblem as sharedFolderNameProblem,
	normalizeFolderName,
} from '../../../extension/src/shared/session-folders';
import {
	hasOperators,
	parseSearchQuery,
	passesOperators,
	sessionFacets,
} from '../../../extension/src/shared/search-query';
import {
	duplicateHandlingOf,
	sessionDuplicates,
} from '../../../extension/src/shared/save-rules';
import {staleSessions} from '../../../extension/src/shared/session-rules';
import {extractUrl, hostOf} from './store-shape';

export const ALL_SESSIONS_ID = 'all';
const ARCHIVED_FOLDER_ID = 'archived-sessions';
const OTHER_FOLDER_ID = 'other-sessions';

const isArchived = (folder: {id: string; name: string}) =>
	folder.id === ARCHIVED_FOLDER_ID ||
	folder.name.toLocaleLowerCase() === 'archived';

/**
Whether a session folder can be renamed or deleted: not Unfiled, which holds whatever has no other home, and not
Archived, as in the extension.
*/
export const canChangeFolder = (folder: {
	id: string;
	name: string;
	isDefault: boolean;
}): boolean => !folder.isDefault && !isArchived(folder);

/**
The message to show when the library holds the most folders it can, so a new one cannot be made, or undefined.
*/
export const folderLimitProblem = (store: Store): string | undefined =>
	folderLimitReached(store.folders) ? FOLDER_LIMIT_MESSAGE : undefined;

/**
Why this name cannot be a folder's, or undefined when it can: empty, the reserved "All sessions", another folder's, or, for
a new folder (no `exceptId`), the limit of 200 folders. The rules are the extension's.
*/
export const folderNameProblem = (
	store: Store,
	name: string,
	exceptId?: string,
): string | undefined =>
	sharedFolderNameProblem(store.folders, name, exceptId ?? null);

/**
Renames a session folder. A folder that cannot change, or a name that is not allowed, leaves the library as it was.
*/
export function renameFolder(
	store: Store,
	id: string,
	name: string,
	now: number,
): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (
		!folder ||
		!canChangeFolder(folder) ||
		folderNameProblem(store, name, id)
	) {
		return store;
	}

	return {
		...store,
		folders: store.folders.map((entry) =>
			entry.id === id ? {...entry, name: normalizeFolderName(name)} : entry,
		),
		updatedAt: now,
	};
}

export type FolderEdit = {
	name: string;
	icon: string;
	color: string;
	colorSessions: boolean;
};

const folderFields = (edit: FolderEdit) => ({
	name: normalizeFolderName(edit.name),
	...(edit.icon && {icon: edit.icon}),
	...(isColumnColor(edit.color) && {
		color: edit.color,
		...(edit.colorSessions && {colorSessions: true as const}),
	}),
});

/**
Makes a session folder with a name, an icon, and a color. A name that is not allowed leaves the library as it was.
*/
export function addFolder(
	store: Store,
	edit: FolderEdit,
	id: string,
	now: number,
): Store {
	if (folderNameProblem(store, edit.name)) {
		return store;
	}

	return {
		...store,
		folders: [
			...store.folders,
			{id, createdAt: now, isDefault: false, ...folderFields(edit)},
		],
		updatedAt: now,
	};
}

/**
Changes a session folder's name, icon, color, and whether it colors the sessions moved into it. The icon and color are
rebuilt, so an empty value drops the field. A folder that cannot change, or a name that is not allowed, leaves the
library as it was.
*/
export function updateFolder(
	store: Store,
	id: string,
	edit: FolderEdit,
	now: number,
): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (
		!folder ||
		!canChangeFolder(folder) ||
		folderNameProblem(store, edit.name, id)
	) {
		return store;
	}

	const {
		icon: _icon,
		color: _color,
		colorSessions: _colorSessions,
		...rest
	} = folder;
	return {
		...store,
		folders: store.folders.map((entry) =>
			entry.id === id ? {...rest, ...folderFields(edit)} : entry,
		),
		updatedAt: now,
	};
}

/**
Deletes a session folder and moves its sessions to Unfiled, as the extension does. A folder that cannot change leaves
the library as it was.
*/
export function deleteFolder(store: Store, id: string, now: number): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (!folder || !canChangeFolder(folder)) {
		return store;
	}

	let {folders} = store;
	let fallback = folders.find((entry) => entry.isDefault)?.id;
	if (!fallback) {
		fallback = DEFAULT_SESSION_FOLDER_ID;
		folders = [
			...folders,
			{id: fallback, name: 'Unfiled', createdAt: now, isDefault: true},
		];
	}

	const target = fallback;
	return {
		...store,
		folders: folders.filter((entry) => entry.id !== id),
		groups: store.groups.map((session) =>
			session.folderId === id
				? {...session, folderId: target, updatedAt: now}
				: session,
		),
		updatedAt: now,
	};
}

/**
Puts back a folder that was deleted, with the sessions it held, for Undo.
*/
export function restoreFolder(
	store: Store,
	folder: Store['folders'][number],
	sessionIds: readonly string[],
	now: number,
): Store {
	if (store.folders.some((entry) => entry.id === folder.id)) {
		return store;
	}

	const back = new Set(sessionIds);
	return {
		...store,
		folders: [...store.folders, folder],
		groups: store.groups.map((session) =>
			back.has(session.id)
				? {...session, folderId: folder.id, updatedAt: now}
				: session,
		),
		updatedAt: now,
	};
}

export type SessionFolderView = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	count: number;
};

/**
The folders to filter sessions by, as the extension shows them: All (without what is archived), each folder in
its own order, and Archived last. Sessions in a folder that no longer exists fall under Other.
*/
export function sessionFolders(store: Store): SessionFolderView[] {
	const known = new Set(store.folders.map((folder) => folder.id));
	const archivedIds = new Set(
		store.folders.filter((folder) => isArchived(folder)).map(({id}) => id),
	);
	const count = (id: string) =>
		store.groups.filter((session) => session.folderId === id).length;
	const views: SessionFolderView[] = [
		{
			id: ALL_SESSIONS_ID,
			name: 'All',
			count: store.groups.filter(
				(session) => !archivedIds.has(session.folderId),
			).length,
		},
	];
	const plain = store.folders.filter((folder) => !isArchived(folder));
	const archived = store.folders.filter((folder) => isArchived(folder));
	for (const folder of [...plain, ...archived]) {
		views.push({
			id: folder.id,
			name: folder.name,
			icon: folder.icon,
			color: folder.color,
			count: count(folder.id),
		});
	}

	const loose = store.groups.filter(
		(session) => !known.has(session.folderId),
	).length;
	if (loose > 0) {
		views.splice(1 + plain.length, 0, {
			id: OTHER_FOLDER_ID,
			name: 'Other',
			count: loose,
		});
	}

	return views;
}

/**
The sessions in one filter, ordered like the extension's sort setting. All leaves out archived ones. `custom` keeps
the library's own order.
*/
export function sessionsIn(
	store: Store,
	folderId: string,
	sort: Settings['sessionSort'],
): Session[] {
	const known = new Set(store.folders.map((folder) => folder.id));
	const archivedIds = new Set(
		store.folders.filter((folder) => isArchived(folder)).map(({id}) => id),
	);
	const picked = store.groups.filter((session) => {
		if (folderId === ALL_SESSIONS_ID) {
			return !archivedIds.has(session.folderId);
		}

		return folderId === OTHER_FOLDER_ID
			? !known.has(session.folderId)
			: session.folderId === folderId;
	});
	switch (sort) {
		case 'newest': {
			return picked.toSorted((a, b) => b.createdAt - a.createdAt);
		}

		case 'oldest': {
			return picked.toSorted((a, b) => a.createdAt - b.createdAt);
		}

		case 'opened': {
			return picked.toSorted(
				(a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
			);
		}

		case 'name': {
			return picked.toSorted((a, b) => a.name.localeCompare(b.name));
		}

		case 'tabs': {
			return picked.toSorted((a, b) => b.tabs.length - a.tabs.length);
		}

		default: {
			return picked;
		}
	}
}

const DEFAULT_SESSION_FOLDER_ID = 'unfiled';

const savedTab = (
	url: string,
	id: string,
	index: number,
	now: number,
	title = '',
): SavedTab => ({
	id,
	title: title.trim() || hostOf(url),
	url,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: now,
	originalIndex: index,
});

/**
Saves links as a new session, in the chosen folder or the default one. `tabIds` gives each tab its id.
*/
export function addSession(
	store: Store,
	input: {
		name: string;
		urls: readonly string[];
		folderId?: string;
		/**
		Where it was saved: the device's name and kind.
		*/
		device?: DeviceStamp;
		/**
		A title for each link, in order; a link without one is named by its site.
		*/
		titles?: readonly string[];
	},
	id: string,
	tabIds: readonly string[],
	now: number,
): Store {
	// In a new session only the duplicate setting applies (save-rules.ts); nothing left means no session.
	const duplicates = sessionDuplicates(
		store.groups,
		undefined,
		duplicateHandlingOf(store.settings),
	);
	const kept: number[] = [];
	for (const [index, url] of input.urls.entries()) {
		if (duplicates.isDuplicate(url)) {
			continue;
		}

		duplicates.saved(url);
		kept.push(index);
	}

	if (kept.length === 0) {
		return store;
	}

	let {folders} = store;
	let folderId = folders.find((folder) => folder.id === input.folderId)?.id;
	folderId ??= folders.find((folder) => folder.isDefault)?.id;

	if (!folderId) {
		folderId = DEFAULT_SESSION_FOLDER_ID;
		folders = [
			...folders,
			{id: folderId, name: 'Unfiled', createdAt: now, isDefault: true},
		];
	}

	const session: Session = {
		id,
		name: input.name.trim() || 'Shared links',
		folderId,
		description: '',
		createdAt: now,
		updatedAt: now,
		sourceWindowName: 'Phone',
		sourceWindowId: null,
		...input.device,
		tabs: kept.map((source, index) =>
			savedTab(
				input.urls[source],
				tabIds[source] ?? `${id}-${index}`,
				index,
				now,
				input.titles?.[source],
			),
		),
	};
	return {
		...store,
		folders,
		groups: [session, ...store.groups],
		updatedAt: now,
	};
}

/**
Adds links to the end of an existing session, skipping duplicates under the shared rule (`save-rules.ts`).
*/
export function addTabsToSession(
	store: Store,
	sessionId: string,
	urls: readonly string[],
	tabIds: readonly string[],
	now: number,
	titles: readonly string[] = [],
): Store {
	const session = store.groups.find((group) => group.id === sessionId);
	if (!session || urls.length === 0) {
		return store;
	}

	// A duplicate (save-rules.ts) is skipped, and the store comes back as it was when nothing is left.
	const duplicates = sessionDuplicates(
		store.groups,
		sessionId,
		duplicateHandlingOf(store.settings),
	);
	const fresh: number[] = [];
	for (const [index, url] of urls.entries()) {
		if (duplicates.isDuplicate(url)) {
			continue;
		}

		duplicates.saved(url);
		fresh.push(index);
	}

	if (fresh.length === 0) {
		return store;
	}

	const start = session.tabs.length;
	const changed: Session = {
		...session,
		updatedAt: now,
		tabs: [
			...session.tabs,
			...fresh.map((index, position) =>
				savedTab(
					urls[index],
					tabIds[index] ?? `${sessionId}-${start + position}`,
					start + position,
					now,
					titles[index],
				),
			),
		],
	};
	return {
		...store,
		groups: store.groups.map((group) =>
			group.id === sessionId ? changed : group,
		),
		updatedAt: now,
	};
}

const changeSession = (
	store: Store,
	id: string,
	change: (session: Session) => Session,
	now: number,
): Store =>
	store.groups.some((session) => session.id === id)
		? {
				...store,
				groups: store.groups.map((session) =>
					session.id === id ? change(session) : session,
				),
				updatedAt: now,
			}
		: store;

/**
Renames a session. A blank name, or an unknown session, leaves the store as it was.
*/
export function renameSession(
	store: Store,
	id: string,
	name: string,
	now: number,
): Store {
	const trimmed = name.trim();
	return trimmed
		? changeSession(
				store,
				id,
				(session) => ({...session, name: trimmed, updatedAt: now}),
				now,
			)
		: store;
}

// The longest description the extension keeps (`SESSION_TEXT_MAX` in its library-normalize.ts).
const DESCRIPTION_MAX = 10_502;

/**
Sets a session's description, which the extension shows under its name and syncs. It is cut to the extension's limit.
*/
export function describeSession(
	store: Store,
	id: string,
	description: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			description: description.trim().slice(0, DESCRIPTION_MAX),
			updatedAt: now,
		}),
		now,
	);
}

/**
Puts a session in another folder. An unknown folder or session leaves the store as it was.
*/
export function moveSession(
	store: Store,
	id: string,
	folderId: string,
	now: number,
): Store {
	const target = store.folders.find((folder) => folder.id === folderId);
	if (!target) {
		return store;
	}

	// A folder that colors its sessions gives a session moved into it the folder's color, as in the extension.
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			folderId,
			updatedAt: now,
			...(session.folderId !== folderId &&
				target.colorSessions &&
				target.color && {color: target.color}),
		}),
		now,
	);
}

/**
Moves a session to the Archived folder, which is made when there is none yet.
*/
export function archiveSession(store: Store, id: string, now: number): Store {
	const found = store.folders.find((folder) => isArchived(folder));
	const withFolder: Store = found
		? store
		: {
				...store,
				folders: [
					...store.folders,
					{
						id: ARCHIVED_FOLDER_ID,
						name: 'Archived',
						createdAt: now,
						isDefault: false,
					},
				],
			};
	return moveSession(withFolder, id, found?.id ?? ARCHIVED_FOLDER_ID, now);
}

/**
Moves every session not opened, saved, or edited for the Archive setting's days into the Archived folder, as the
extension does each day. Like the extension it leaves `updatedAt` alone, so the move is not an edit. The same store
comes back when there is nothing to move. Nothing is deleted.
*/
export function archiveStale(store: Store, now: number): Store {
	const stale = new Set(
		staleSessions(
			store.groups,
			store.folders,
			store.settings.autoArchiveDays,
			now,
		).map((session) => session.id),
	);
	if (stale.size === 0) {
		return store;
	}

	const folders = store.folders.map((folder) => ({...folder}));
	const archived = findOrAddArchivedFolder(folders);
	return {
		...store,
		folders,
		groups: store.groups.map((session) =>
			stale.has(session.id) ? {...session, folderId: archived.id} : session,
		),
		updatedAt: now,
	};
}

/**
Whether a session sits in the Archived folder.
*/
export function isArchivedSession(
	folders: readonly Folder[],
	session: Session,
): boolean {
	const folder = folders.find((entry) => entry.id === session.folderId);
	return folder !== undefined && isArchived(folder);
}

/**
Takes a session out of the Archived folder, into Unfiled (or the first folder that is not Archived; Unfiled is made
when there is none).
*/
export function unarchiveSession(store: Store, id: string, now: number): Store {
	const open = store.folders.filter((folder) => !isArchived(folder));
	const target = open.find((folder) => folder.isDefault) ?? open[0];
	if (target) {
		return moveSession(store, id, target.id, now);
	}

	return moveSession(
		{
			...store,
			folders: [
				...store.folders,
				{
					id: DEFAULT_SESSION_FOLDER_ID,
					name: 'Unfiled',
					createdAt: now,
					isDefault: true,
				},
			],
		},
		id,
		DEFAULT_SESSION_FOLDER_ID,
		now,
	);
}

/**
Deletes a session.
*/
export function removeSession(store: Store, id: string, now: number): Store {
	return store.groups.some((session) => session.id === id)
		? {
				...store,
				groups: store.groups.filter((session) => session.id !== id),
				updatedAt: now,
			}
		: store;
}

/**
Puts a deleted session back, under its own id, unless one with that id exists again. A folder that is gone sends it
to the first folder.
*/
export function restoreSession(
	store: Store,
	session: Session,
	now: number,
): Store {
	if (store.groups.some((existing) => existing.id === session.id)) {
		return store;
	}

	const known = store.folders.some((folder) => folder.id === session.folderId);
	return {
		...store,
		groups: [
			{
				...session,
				folderId: known
					? session.folderId
					: (store.folders[0]?.id ?? session.folderId),
				updatedAt: now,
			},
			...store.groups,
		],
		updatedAt: now,
	};
}

/**
Changes the title, notes, and address of one saved tab. An address that is not a web address leaves the library as it
was. Like the extension, a new address belongs to this one saved link only, while a changed title or note is also
written to every other saved copy of the same address.
*/
export function updateSessionTab(
	store: Store,
	id: string,
	tabId: string,
	change: {title: string; url: string; notes?: string},
	now: number,
): Store {
	const url = extractUrl(change.url);
	const current = store.groups
		.find((session) => session.id === id)
		?.tabs.find((tab) => tab.id === tabId);
	if (!url || !current) {
		return store;
	}

	const title = change.title.trim().slice(0, 500) || url;
	const notes =
		change.notes === undefined ? undefined : normalizeNotes(change.notes);
	if (url !== current.url) {
		return changeSession(
			store,
			id,
			(session) => ({
				...session,
				tabs: session.tabs.map((tab) =>
					tab.id === tabId
						? {...tab, url, title, notes: notes ?? tab.notes}
						: tab,
				),
				updatedAt: now,
			}),
			now,
		);
	}

	return {
		...store,
		groups: store.groups.map((session) =>
			session.tabs.some((tab) => tab.url === current.url)
				? {
						...session,
						tabs: session.tabs.map((tab) =>
							tab.url === current.url
								? {...tab, title, notes: notes ?? tab.notes}
								: tab,
						),
						updatedAt: now,
					}
				: session,
		),
		updatedAt: now,
	};
}

/**
Takes one tab out of a session.
*/
export function removeSessionTab(
	store: Store,
	id: string,
	tabId: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			tabs: session.tabs.filter((tab) => tab.id !== tabId),
			updatedAt: now,
		}),
		now,
	);
}

/**
The addresses of a session's tabs, one per line, for sharing or copying.
*/
export const sessionLinks = (session: Session): string =>
	session.tabs.map((tab) => tab.url).join('\n');

/**
Notes that a session was opened now, which the "recently opened" sort uses.
*/
export function markSessionOpened(
	store: Store,
	id: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({...session, lastOpenedAt: now}),
		now,
	);
}

/**
The sessions a search matches: the plain words as one piece of a name, note, tab title or address, and the operators
on top of that.
*/
export function searchSessions(
	sessions: readonly Session[],
	query: string,
	folders: readonly Folder[],
): Session[] {
	const search = parseSearchQuery(query.trim());
	const filtering = hasOperators(search);
	const needle = search.text.toLocaleLowerCase();
	const folderName = new Map(folders.map((folder) => [folder.id, folder.name]));
	return sessions.filter((session) => {
		const texts = [
			session.name,
			session.description,
			...session.tabs.flatMap((tab) => [tab.title, tab.url]),
		];
		return (
			texts.some((text) => text.toLocaleLowerCase().includes(needle)) &&
			(!filtering ||
				passesOperators(
					search,
					texts,
					sessionFacets(session, folderName.get(session.folderId)),
				))
		);
	});
}
