import {useState} from 'react';
import {FileTooLargeError, pickBinaryFile, pickTextFile} from '../files';
import {confirm, notify} from '../dialog';
import {edit, useLibrary} from '../library-store';
import {showSnack} from '../snackbar';
import {useView} from '../view';
import type {Store} from '../../../extension/src/shared/types';
import {ActionSheet} from '../action-sheet';
import {Button} from '../ui';
import {SettingsCard} from './settings-card';
import {SECTIONS} from './settings-index';
import {RestoreSheet, type RestoreSource} from './restore-sheet';
import {ExportSheet, ImportSheet, type ImportSource} from './transfer-sheets';

const plural = (count: number, word: string) =>
	`${count} ${count === 1 ? word : `${word}s`}`;

/**
What the library holds, in a few lines, for the Statistics button. The phone cannot list a browser's open tabs, so
this is only what is saved.
*/
function describeLibrary(store: Store, view: 'regular' | 'private'): string {
	const links = store.groups.reduce((sum, group) => sum + group.tabs.length, 0);
	return [
		view === 'private' ? 'The private library holds:' : 'This phone holds:',
		`${plural(store.groups.length, 'session')} with ${plural(links, 'saved tab')} in ${plural(store.folders.length, 'folder')}`,
		`${plural(store.bookmarks.length, 'bookmark')} in ${plural(store.bookmarkColumns.length, 'column')}`,
	].join('\n');
}

type Erasing = 'sessions' | 'bookmarks' | 'everything';

/**
Bringing links in from a file or pasted text, and saving the library out as a file. What an import reads is the
extension's own code, so a file reads the same on both.
*/
export function DataCard() {
	const [source, setSource] = useState<ImportSource>();
	const [exporting, setExporting] = useState(false);
	const [restoring, setRestoring] = useState<RestoreSource>();
	const [menu, setMenu] = useState<'transfer' | 'erase'>();
	const store = useLibrary();
	const view = useView();
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
			`Every ${what === 'everything' ? 'session and bookmark' : what === 'sessions' ? 'session' : 'bookmark'} in ${target} on this phone is deleted. Settings are kept. With a server connected they are deleted there too. This cannot be undone.`,
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
				label="Import, export and backup"
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
				title="Import, export and backup"
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
						icon: 'share-outline',
						label: 'Export or back up',
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
					{
						icon: 'stats-chart-outline',
						label: 'Statistics',
						onPress() {
							notify('Statistics', describeLibrary(store, view));
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
			<RestoreSheet
				source={restoring}
				onClose={() => {
					setRestoring(undefined);
				}}
			/>
			<ImportSheet
				source={source}
				onClose={() => {
					setSource(undefined);
				}}
			/>
			<ExportSheet
				visible={exporting}
				onClose={() => {
					setExporting(false);
				}}
			/>
		</SettingsCard>
	);
}
