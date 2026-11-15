import {useState} from 'react';
import type {Session, Store} from '../../../../extension/src/shared/types';
import {edit} from '../../library/library-store';
import {linkToOpen, type LinkSettings} from '../../library/links';
import {openAll} from '../../platform/open-links';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {trashDeleted} from '../../library/trash-store';
import {ActionBar} from '../bookmarks/bookmark-parts';
import {openShare} from '../transfer/transfer-sheets';
import {MoveSessionsSheet} from './session-sheets';
import {
	archiveSessions,
	deleteSessions,
	moveSessions,
	moveSessionsBack,
	restoreSessions,
	returnSessions,
	sessionCount,
} from './session-changes';

/**
The buttons at the bottom while sessions are being selected, and the drawer the Move button opens. Each acts on the
`chosen` sessions, ends the selection, and offers Undo.
*/
export function SessionSelectionBar({
	active,
	chosen,
	allArchived,
	folders,
	links,
	stop,
}: {
	active: boolean;
	chosen: Session[];
	allArchived: boolean;
	folders: Store['folders'];
	links: LinkSettings;
	stop: () => void;
}) {
	const colors = useColors();
	const [moving, setMoving] = useState(false);
	const deleteChosen = () => {
		const gone = chosen;
		if (gone.length === 0) {
			return;
		}

		void edit((current) => deleteSessions(current, gone, Date.now));
		void trashDeleted(gone.map((session) => ({kind: 'session', session})));
		stop();
		showSnack(`Deleted ${sessionCount(gone.length)}`, {
			label: 'Undo',
			run() {
				void edit((current) => restoreSessions(current, gone, Date.now));
			},
		});
	};

	// Sessions in the Archived folder come out of it when the whole selection is archived already, and go in otherwise.
	const archiveChosen = () => {
		// The button is off while nothing is picked.
		void edit((current) =>
			archiveSessions(current, chosen, !allArchived, Date.now),
		);
		stop();
		showSnack(
			`${allArchived ? 'Unarchived' : 'Archived'} ${sessionCount(chosen.length)}`,
			{
				label: 'Undo',
				run() {
					void edit((current) => returnSessions(current, chosen, Date.now));
				},
			},
		);
	};

	return (
		<>
			{active && (
				<ActionBar
					actions={[
						{
							icon: 'albums-outline',
							label: 'Open',
							disabled: chosen.length === 0,
							onPress() {
								openAll(
									chosen.flatMap((session) =>
										session.tabs.map((tab) => linkToOpen(tab.url, links)),
									),
									sessionCount(chosen.length),
								);
							},
						},
						{
							icon: 'share-outline',
							label: 'Share',
							disabled: chosen.length === 0,
							onPress() {
								openShare({
									title: sessionCount(chosen.length),
									data: {
										kind: 'sessions',
										groups: chosen,
										folders,
									},
								});
							},
						},
						{
							icon: 'folder-open-outline',
							label: 'Move',
							disabled: chosen.length === 0 || folders.length < 2,
							onPress() {
								setMoving(true);
							},
						},
						{
							icon: allArchived ? 'arrow-undo-outline' : 'archive-outline',
							label: allArchived ? 'Unarchive' : 'Archive',
							color: colors.warn,
							disabled: chosen.length === 0,
							onPress: archiveChosen,
						},
						{
							icon: 'trash-outline',
							label: 'Delete',
							color: colors.danger,
							disabled: chosen.length === 0,
							onPress: deleteChosen,
						},
					]}
				/>
			)}
			<MoveSessionsSheet
				visible={moving}
				count={chosen.length}
				folders={folders}
				onPick={(target) => {
					const ids = chosen.map((session) => session.id);
					const was = new Map(
						chosen.map((session) => [session.id, session.folderId]),
					);
					void edit((current) => moveSessions(current, ids, target, Date.now));
					stop();
					showSnack(`Moved ${sessionCount(ids.length)}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								moveSessionsBack(current, ids, was, target, Date.now),
							);
						},
					});
				}}
				onClose={() => {
					setMoving(false);
				}}
			/>
		</>
	);
}
