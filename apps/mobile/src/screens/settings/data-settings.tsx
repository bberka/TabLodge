import {useEffect, useState} from 'react';
import {
	FileTooLargeError,
	pickBinaryFile,
	pickTextFile,
} from '../../transfer/files';
import {confirm, notify, showDialog} from '../../ui/dialog';
import {edit, useLibrary} from '../../library/library-store';
import {showSnack} from '../../ui/snackbar';
import {useView} from '../../library/view';
import {ActionSheet} from '../../ui/action-sheet';
import {Button} from '../../ui/widgets';
import {readSafetyCopy} from '../../transfer/restore';
import {
	RestoreSheet,
	type RestoreSource,
	undoRestore,
} from '../transfer/restore-sheet';
import {StatisticsSheet} from '../transfer/statistics-sheet';
import {ShareSheet} from '../transfer/transfer-sheets';
import {ImportSheet, type ImportSource} from '../transfer/import-sheet';
import {SettingsCard} from './settings-card';
import {SECTIONS} from './settings-index';

type Erasing = 'sessions' | 'bookmarks' | 'everything';

export function DataCard() {
	const [source, setSource] = useState<ImportSource>();
	const [exporting, setExporting] = useState(false);
	const [restoring, setRestoring] = useState<RestoreSource>();
	const [menu, setMenu] = useState<'transfer' | 'erase'>();
	const [statistics, setStatistics] = useState(false);
	const store = useLibrary();
	const view = useView();
	const [canUndo, setCanUndo] = useState(false);
	useEffect(() => {
		if (menu === 'transfer') {
			void readSafetyCopy(view).then((copy) => {
				setCanUndo(copy !== undefined);
			});
		}
	}, [menu, view]);
	const erase = (what: Erasing) => {
		const target = view === 'private' ? 'the private library' : 'the library';
		const label =
			what === 'everything'
				? 'sessions and bookmarks'
				: what === 'sessions'
					? 'sessions'
					: 'bookmarks';
		confirm(
			`Erase all ${label}?`,
			`Every ${what === 'everything' ? 'session and bookmark' : what === 'sessions' ? 'session' : 'bookmark'} in ${target} on this phone is deleted. Settings are kept. With a server connected they are deleted there too. They do not go to the trash, and what is already in the trash stays there. This cannot be undone.`,
			{label: 'Erase', destructive: true},
			() => {
				void edit((current) => ({
					...current,
					...(what !== 'bookmarks' && {groups: []}),
					...(what !== 'sessions' && {bookmarks: []}),
					updatedAt: Date.now(),
				})).then(() => {
					showSnack(`Erased ${label}`);
				});
			},
		);
	};

	const pick = async () => {
		try {
			const picked = await pickTextFile();
			if (picked) {
				setSource({mode: 'file', ...picked});
			}
		} catch (error) {
			notify(
				'Could not open the file',
				error instanceof FileTooLargeError
					? error.message
					: 'It could not be read as text.',
			);
		}
	};

	const pickBackup = async () => {
		try {
			const picked = await pickBinaryFile();
			if (picked) {
				setRestoring(picked);
			}
		} catch (error) {
			notify(
				'Could not open the file',
				error instanceof FileTooLargeError
					? error.message
					: 'It could not be read.',
			);
		}
	};

	return (
		<SettingsCard
			section={SECTIONS.data}
			icon="swap-vertical-outline"
			description="Bring links in, save them out, or erase them."
		>
			<Button
				label="Import and export"
				icon="swap-vertical-outline"
				kind="plain"
				onPress={() => {
					setMenu('transfer');
				}}
			/>
			<Button
				label="Erase"
				icon="trash-outline"
				kind="danger"
				disabled={store.groups.length === 0 && store.bookmarks.length === 0}
				onPress={() => {
					setMenu('erase');
				}}
			/>
			<ActionSheet
				visible={menu === 'transfer'}
				title="Import and export"
				actions={[
					{
						icon: 'document-outline',
						label: 'Import from a file',
						onPress() {
							void pick();
						},
					},
					{
						icon: 'clipboard-outline',
						label: 'Import pasted links',
						onPress() {
							setSource({mode: 'paste'});
						},
					},
					{
						icon: 'link-outline',
						label: 'Import from a link',
						hint: 'A TabLodge shared page',
						onPress() {
							setSource({mode: 'link'});
						},
					},
					{
						icon: 'globe-outline',
						label: 'From another browser',
						hint: 'Open tabs and bookmarks',
						onPress() {
							showDialog(
								'Bring in tabs and bookmarks',
								"Android keeps each browser's data private, so no app can read another browser directly. Two ways in:\n\nOpen tabs: in Firefox, open the tabs tray, tap the three-dot menu, then Share all tabs and choose TabLodge. Other browsers share one page at a time through Share. A shared list of links opens in TabLodge ready to save as a session.\n\nBookmarks: export them from the browser on a computer as an HTML file, send it to this phone, and share it to TabLodge or use Import from a file. Or install the TabLodge extension there and sync.",
								[
									{label: 'Import from a file', run: () => void pick()},
									{label: 'Close', kind: 'cancel'},
								],
							);
						},
					},
					{
						icon: 'share-outline',
						label: 'Share and export',
						onPress() {
							setExporting(true);
						},
					},
					{
						icon: 'refresh-outline',
						label: 'Restore a backup',
						onPress() {
							void pickBackup();
						},
					},
					...(canUndo
						? [
								{
									icon: 'arrow-undo-outline' as const,
									label: 'Undo the last restore',
									hint: 'Puts back what it replaced',
									onPress() {
										confirm(
											'Undo the last restore?',
											'The library goes back to what it was before the restore. Changes made since then are lost.',
											{label: 'Undo restore', destructive: true},
											() => void undoRestore(view),
										);
									},
								},
							]
						: []),
					{
						icon: 'stats-chart-outline',
						label: 'Statistics',
						onPress() {
							setStatistics(true);
						},
					},
				]}
				onClose={() => {
					setMenu(undefined);
				}}
			/>
			<ActionSheet
				visible={menu === 'erase'}
				title="Erase"
				actions={[
					...(store.groups.length > 0
						? [
								{
									icon: 'trash-outline' as const,
									label: 'Erase sessions',
									destructive: true,
									onPress() {
										erase('sessions');
									},
								},
							]
						: []),
					...(store.bookmarks.length > 0
						? [
								{
									icon: 'trash-outline' as const,
									label: 'Erase bookmarks',
									destructive: true,
									onPress() {
										erase('bookmarks');
									},
								},
							]
						: []),
					{
						icon: 'trash-outline',
						label: 'Erase everything',
						destructive: true,
						onPress() {
							erase('everything');
						},
					},
				]}
				onClose={() => {
					setMenu(undefined);
				}}
			/>
			<StatisticsSheet
				visible={statistics}
				onClose={() => {
					setStatistics(false);
				}}
			/>
			<RestoreSheet
				source={restoring}
				onClose={() => {
					setRestoring(undefined);
				}}
			/>
			<ImportSheet
				source={source}
				onClose={(finished) => {
					setSource((current) =>
						finished === undefined || current === finished
							? undefined
							: current,
					);
				}}
			/>
			<ShareSheet
				visible={exporting}
				onClose={() => {
					setExporting(false);
				}}
			/>
		</SettingsCard>
	);
}
