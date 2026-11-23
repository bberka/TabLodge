import {useCallback} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import type {Settings, Store} from '../../../../extension/src/shared/types';
import {
	ALL_SESSIONS_ID,
	canChangeFolder,
	deleteFolder,
	restoreFolder,
	type SessionFolderView,
	sessionsIn,
} from '../../library/session-edits';
import {edit} from '../../library/library-store';
import {trashDeleted} from '../../library/trash-store';
import {type SheetAction} from '../../ui/action-sheet';
import {columnGlyph, useChipLook} from '../../ui/column-icons';
import {showSnack} from '../../ui/snackbar';
import {type Colors, useColors} from '../../ui/theme';
import {Chips} from '../../ui/widgets';
import {openShare} from '../transfer/transfer-sheets';

const NEW_FOLDER_CHIP = 'new-folder';

export function useFolderLook() {
	const colors = useColors();
	const chipLook = useChipLook();
	return useCallback(
		(folder: {id: string; name: string; icon?: string; count: number}) => {
			if (folder.id === ALL_SESSIONS_ID) {
				return {
					...folder,
					glyph: 'albums-outline' as const,
					tint: colors.accent,
				};
			}

			return folder.name.toLocaleLowerCase() === 'archived'
				? {...folder, glyph: 'archive-outline' as const, tint: colors.muted}
				: {...chipLook(folder), glyph: columnGlyph(folder.icon)};
		},
		[chipLook, colors.accent, colors.muted],
	);
}

export function FolderChips({
	folders,
	selected,
	onSelect,
	onNewFolder,
	onMenu,
}: {
	folders: SessionFolderView[];
	selected: string;
	onSelect: (id: string) => void;
	onNewFolder: () => void;
	onMenu: (id: string) => void;
}) {
	const colors = useColors();
	const look = useFolderLook();
	return (
		<View style={styles.pad}>
			<ScrollView horizontal showsHorizontalScrollIndicator={false}>
				<Chips
					items={[
						...folders.map((folder) => look(folder)),
						{
							id: NEW_FOLDER_CHIP,
							name: 'New folder',
							glyph: 'add' as const,
							tint: colors.accent,
						},
					]}
					selected={selected}
					onSelect={(id) => {
						if (id === NEW_FOLDER_CHIP) {
							onNewFolder();
						} else {
							onSelect(id);
						}
					}}
					onLongPress={(id) => {
						if (id !== NEW_FOLDER_CHIP) {
							onMenu(id);
						}
					}}
				/>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	pad: {paddingHorizontal: 16, gap: 12, paddingBottom: 8},
});

export function folderMenuFor(
	id: string,
	store: Store,
	folders: SessionFolderView[],
	{
		sort,
		colors,
		edit: editFolder,
		removed,
	}: {
		sort: Settings['sessionSort'];
		colors: Colors;
		edit: (id: string) => void;
		removed: (id: string) => void;
	},
): {title: string; actions: SheetAction[]} | undefined {
	const view = folders.find((folder) => folder.id === id);
	if (!view) {
		return undefined;
	}

	const sessions = sessionsIn(store, id, sort);
	const folder = store.folders.find((entry) => entry.id === id);
	const actions: SheetAction[] = [];
	actions.push({
		icon: 'share-outline',
		label: 'Share',
		onPress() {
			openShare({
				title: view.name,
				data: {kind: 'sessions', groups: sessions, folders: store.folders},
			});
		},
	});

	if (folder && canChangeFolder(folder)) {
		actions.push(
			{
				icon: 'create-outline',
				label: 'Edit folder',
				color: colors.teal,
				hint: 'Rename it, or change its icon and color',
				onPress() {
					editFolder(id);
				},
			},
			{
				icon: 'trash-outline',
				label: 'Delete folder',
				destructive: true,
				onPress() {
					const held = sessions.map((session) => session.id);
					void edit((current) => deleteFolder(current, id, Date.now()));
					void trashDeleted([{kind: 'folder', folder, sessionIds: held}]);
					removed(id);
					showSnack(`Deleted ${folder.name}`, {
						label: 'Undo',
						run() {
							void edit((current) =>
								restoreFolder(current, folder, held, Date.now()),
							);
						},
					});
				},
			},
		);
	}

	return {title: view.name, actions};
}
