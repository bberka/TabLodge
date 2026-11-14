import {useState} from 'react';
import {FileTooLargeError, pickTextFile} from '../files';
import {notify} from '../dialog';
import {Button} from '../ui';
import {SettingsCard} from './settings-card';
import {SECTIONS} from './settings-index';
import {ExportSheet, ImportSheet, type ImportSource} from './transfer-sheets';

/**
Bringing links in from a file or pasted text, and saving the library out as a file. What an import reads is the
extension's own code, so a file reads the same on both.
*/
export function DataCard() {
	const [source, setSource] = useState<ImportSource>();
	const [exporting, setExporting] = useState(false);
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

	return (
		<SettingsCard
			section={SECTIONS.data}
			icon="swap-vertical-outline"
			description="Bring links in from a file, or save them out."
		>
			<Button
				label="Import from a file"
				icon="document-outline"
				kind="plain"
				onPress={() => void pick()}
			/>
			<Button
				label="Import pasted links"
				icon="clipboard-outline"
				kind="plain"
				onPress={() => {
					setSource({mode: 'paste'});
				}}
			/>
			<Button
				label="Export"
				icon="share-outline"
				kind="plain"
				onPress={() => {
					setExporting(true);
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
