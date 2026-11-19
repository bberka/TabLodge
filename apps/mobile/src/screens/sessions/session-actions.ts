import type {Session, Store} from '../../../../extension/src/shared/types';
import {
	archiveSession,
	isArchivedSession,
	markSessionOpened,
	moveSession,
	removeSession,
	removeSessionTab,
	restoreSession,
	unarchiveSession,
} from '../../library/session-edits';
import {edit} from '../../library/library-store';
import {linkToOpen, type LinkSettings} from '../../library/links';
import {sessionActionLook} from '../../library/row-actions';
import {trashDeleted} from '../../library/trash-store';
import {openAll, openLink} from '../../platform/open-links';
import {type LinkAction, type SessionAction} from '../../settings/preferences';
import {type SheetAction} from '../../ui/action-sheet';
import {showSnack} from '../../ui/snackbar';
import {type Colors} from '../../ui/theme';
import {openShare} from '../transfer/transfer-sheets';
import {linkOpenActions, openIn} from '../open-in';
import {type BookmarkLinks} from './session-link-sheets';

/**
Runs one action on a session: the library changes, the Undo offers, and the share and open handoffs. The two that only
open a drawer, Edit details and Move, hand the session to `rename` and `move`.
*/
export function runSessionAction(
	action: SessionAction,
	session: Session,
	{
		folders,
		links,
		rename,
		move,
	}: {
		folders: Store['folders'];
		links: LinkSettings;
		rename: (id: string) => void;
		move: (id: string) => void;
	},
) {
	switch (action) {
		case 'open': {
			openAll(
				session.tabs.map((tab) => linkToOpen(tab.url, links)),
				session.name,
			);
			void edit((current) =>
				markSessionOpened(current, session.id, Date.now()),
			);

			break;
		}

		case 'rename': {
			rename(session.id);
			break;
		}

		case 'move': {
			move(session.id);
			break;
		}

		case 'archive': {
			const was = session.folderId;
			const archived = isArchivedSession(folders, session);
			void edit((current) =>
				archived
					? unarchiveSession(current, session.id, Date.now())
					: archiveSession(current, session.id, Date.now()),
			);
			showSnack(`${archived ? 'Unarchived' : 'Archived'} ${session.name}`, {
				label: 'Undo',
				run() {
					void edit((current) =>
						moveSession(current, session.id, was, Date.now()),
					);
				},
			});
			break;
		}

		case 'share': {
			openShare({
				title: session.name,
				data: {kind: 'sessions', groups: [session], folders},
			});
			break;
		}

		case 'delete': {
			void edit((current) => removeSession(current, session.id, Date.now()));
			void trashDeleted([{kind: 'session', session}]);
			showSnack(`Deleted ${session.name}`, {
				label: 'Undo',
				run() {
					void edit((current) => restoreSession(current, session, Date.now()));
				},
			});
			break;
		}

		default:
	}
}

/**
Takes one link out of a session and offers Undo. A session keeps at least one tab, so the last link stays.
*/
export function removeTab(session: Session, tabId: string) {
	if (
		session.tabs.every((candidate) => candidate.id !== tabId) ||
		session.tabs.length < 2
	) {
		showSnack('A session keeps at least one tab. Delete the session instead');
		return;
	}

	const index = session.tabs.findIndex((candidate) => candidate.id === tabId);
	void edit((current) =>
		removeSessionTab(current, session.id, tabId, Date.now()),
	);
	void trashDeleted([
		{
			kind: 'tab',
			tab: session.tabs[index],
			index,
			sessionId: session.id,
			sessionName: session.name,
			folderId: session.folderId,
		},
	]);
	showSnack('Removed from the session', {
		label: 'Undo',
		run() {
			void edit((current) =>
				restoreSession(
					current.groups.some((group) => group.id === session.id)
						? removeSession(current, session.id, Date.now())
						: current,
					session,
					Date.now(),
				),
			);
		},
	});
}

/**
Runs one action on a link inside a session. Edit and Bookmark open drawers, which `edit` and `bookmark` start.
*/
export function runTabAction(
	action: LinkAction,
	session: Session,
	tabId: string,
	{
		links,
		edit: startEdit,
		bookmark,
	}: {
		links: LinkSettings;
		edit: (target: {session: Session; tabId: string}) => void;
		bookmark: (target: BookmarkLinks) => void;
	},
) {
	const tab = session.tabs.find((candidate) => candidate.id === tabId);
	if (!tab) {
		return;
	}

	switch (action) {
		case 'open': {
			openLink(linkToOpen(tab.url, links));

			break;
		}

		case 'edit': {
			startEdit({session, tabId});

			break;
		}

		case 'bookmark': {
			bookmark({
				title: tab.title || tab.url,
				links: [{title: tab.title, url: tab.url}],
			});

			break;
		}

		case 'delete': {
			removeTab(session, tabId);

			break;
		}
		// No default
	}
}

/**
The session's menu, from its More button: the swipe actions with their look, and the ones only the menu has.
*/
export function sessionMenuActions(
	session: Session,
	{
		colors,
		folders,
		links,
		act,
		select,
		addLinks,
		bookmark,
	}: {
		colors: Colors;
		folders: Store['folders'];
		links: LinkSettings;
		act: (action: SessionAction, session: Session) => void;
		select: (id: string) => void;
		addLinks: (id: string) => void;
		bookmark: (target: BookmarkLinks) => void;
	},
): SheetAction[] {
	const menuItem = (action: SessionAction): SheetAction => {
		const actionLook = sessionActionLook(
			action,
			colors,
			isArchivedSession(folders, session),
		);
		return {
			icon: actionLook.icon,
			label: actionLook.label,
			color: actionLook.color,
			destructive: action === 'delete',
			onPress() {
				act(action, session);
			},
		};
	};

	return [
		menuItem('open'),
		{
			icon: 'navigate-outline' as const,
			label: 'Open all in…',
			hint: 'Another browser, this once',
			onPress() {
				openIn({
					urls: session.tabs.map((tab) => linkToOpen(tab.url, links)),
					from: session.name,
					onOpen() {
						void edit((current) =>
							markSessionOpened(current, session.id, Date.now()),
						);
					},
				});
			},
		},
		menuItem('rename'),
		{
			icon: 'checkbox-outline' as const,
			label: 'Select',
			hint: 'Pick several to open, move, archive or delete',
			onPress() {
				select(session.id);
			},
		},
		{
			icon: 'add-circle-outline' as const,
			label: 'Add links',
			color: colors.accent,
			onPress() {
				addLinks(session.id);
			},
		},
		{
			icon: 'bookmark-outline' as const,
			label: 'Save links as bookmarks',
			color: colors.ok,
			onPress() {
				bookmark({
					title: session.name,
					links: session.tabs.map((tab) => ({
						title: tab.title,
						url: tab.url,
					})),
				});
			},
		},
		menuItem('share'),
		...(['archive', 'delete'] as const).map((action) => menuItem(action)),
	];
}

/**
What holding a link of a session offers: nothing that removes it unless asked for by name.
*/
export function tabMenuActions(
	session: Session,
	tab: Session['tabs'][number],
	{
		colors,
		links,
		edit: startEdit,
		bookmark,
	}: {
		colors: Colors;
		links: LinkSettings;
		edit: (target: {session: Session; tabId: string}) => void;
		bookmark: (target: BookmarkLinks) => void;
	},
): SheetAction[] {
	return [
		{
			icon: 'open-outline',
			label: 'Open',
			onPress() {
				openLink(linkToOpen(tab.url, links));
			},
		},
		...linkOpenActions(linkToOpen(tab.url, links), colors),
		{
			icon: 'create-outline',
			label: 'Edit',
			color: colors.teal,
			onPress() {
				startEdit({session, tabId: tab.id});
			},
		},
		{
			icon: 'bookmark-outline',
			label: 'Add to bookmarks',
			color: colors.ok,
			onPress() {
				bookmark({
					title: tab.title || tab.url,
					links: [{title: tab.title, url: tab.url}],
				});
			},
		},
		{
			icon: 'trash-outline',
			label: 'Delete',
			destructive: true,
			onPress() {
				removeTab(session, tab.id);
			},
		},
	];
}
