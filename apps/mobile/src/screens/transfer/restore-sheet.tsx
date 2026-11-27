import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {restoreImageThumbs} from '../../library/saved-images';
import {BottomSheet} from '../../ui/bottom-sheet';
import {type BackupRead, readBackup} from '../../transfer/backup';
import {confirm, notify} from '../../ui/dialog';
import {editIn, useLibrary} from '../../library/library-store';
import {
	dropSafetyCopy,
	keepSafetyCopy,
	readSafetyCopy,
	replaceLibrary,
} from '../../transfer/restore';
import {
	backupPreferences,
	restorePreferences,
} from '../../settings/preferences';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {Button, Field} from '../../ui/widgets';
import {useView} from '../../library/view';
import {restoreCopies} from '../../library/page-copies';

export type RestoreSource = {name: string; bytes: Uint8Array};

type Read = Extract<BackupRead, {ok: true}>;

export async function undoRestore(
	library: 'regular' | 'private',
): Promise<void> {
	const copy = await readSafetyCopy(library);
	if (!copy) {
		showSnack('Nothing to undo');
		return;
	}

	await editIn(library, () => copy.store);
	restorePreferences(copy.preferences);
	await dropSafetyCopy(library);
	showSnack('Restore undone');
}

const plural = (count: number, word: string) =>
	`${count} ${count === 1 ? word : `${word}s`}`;

export function RestoreSheet({
	source,
	onClose,
}: {
	source: RestoreSource | undefined;
	onClose: () => void;
}) {
	return (
		<BottomSheet
			visible={source !== undefined}
			label="Restore a backup"
			onClose={onClose}
		>
			{source && (
				<RestoreForm key={source.name} source={source} onDone={onClose} />
			)}
		</BottomSheet>
	);
}

function RestoreForm({
	source,
	onDone,
}: {
	source: RestoreSource;
	onDone: () => void;
}) {
	const colors = useColors();
	const view = useView();
	const store = useLibrary();
	const [password, setPassword] = useState('');
	const [problem, setProblem] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<BackupRead | undefined>();
	useEffect(() => {
		void readBackup(source.bytes).then(setResult);
	}, [source]);

	const open = async () => {
		setBusy(true);
		setProblem(undefined);
		const next = await readBackup(source.bytes, password);
		setBusy(false);
		if (next.ok) {
			setResult(next);
		} else {
			setProblem(next.message);
		}
	};

	const target = view === 'private' ? 'the private library' : 'the library';
	const restoreAll = (read: Read) => {
		confirm(
			`Replace ${target} with this backup?`,
			`Everything in ${target} on this phone is replaced by the backup's ${plural(read.counts.sessions, 'session')} and ${plural(read.counts.bookmarks, 'bookmark')}, and the phone's settings come back. With a server connected, the replaced items are removed there too. A copy of what is there now is kept, so Undo brings it back.`,
			{label: 'Replace', destructive: true},
			() => {
				void (async () => {
					try {
						await keepSafetyCopy(view, store, Date.now(), backupPreferences());
						await editIn(view, (current) =>
							replaceLibrary(current, read.store, Date.now()),
						);
						restorePreferences(read.phoneSettings);
						if (view === 'regular') {
							await restoreCopies(read.copies);
							await restoreImageThumbs(read.images);
						}

						showSnack('Backup restored', {
							label: 'Undo',
							run() {
								void undoRestore(view);
							},
						});
						onDone();
					} catch {
						notify('Could not restore', 'Nothing was changed. Try again.');
					}
				})();
			},
		);
	};

	const restoreSettings = (read: Read) => {
		restorePreferences(read.phoneSettings);
		showSnack('Phone settings restored');
		onDone();
	};

	const needsPassword = result?.ok === false && result.reason === 'password';
	return (
		<View style={styles.body}>
			<Text
				accessibilityRole="header"
				style={[styles.title, {color: colors.text}]}
			>
				Restore a backup
			</Text>
			{result === undefined && (
				<Text style={{color: colors.muted}}>Reading {source.name}…</Text>
			)}
			{result?.ok === false && !needsPassword && (
				<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
					{result.message}
				</Text>
			)}
			{needsPassword && (
				<>
					<Text style={{color: colors.muted}}>
						This backup is locked. Enter its password.
					</Text>
					<Field
						secureTextEntry
						autoFocus
						label="Password"
						icon="lock-closed-outline"
						value={password}
						autoCapitalize="none"
						autoCorrect={false}
						error={problem}
						onChangeText={(text) => {
							setPassword(text);
							setProblem(undefined);
						}}
					/>
					<Button
						label="Open the backup"
						icon="lock-open-outline"
						disabled={password === ''}
						loading={busy}
						onPress={() => void open()}
					/>
				</>
			)}
			{result?.ok === true && (
				<>
					<Text style={{color: colors.text, fontWeight: '600'}}>
						{result.createdAt
							? `Made ${new Date(result.createdAt).toLocaleString()}`
							: 'A TabLodge backup'}
					</Text>
					<Text style={{color: colors.muted}}>
						{plural(result.counts.sessions, 'session')} with{' '}
						{plural(result.counts.links, 'link')},{' '}
						{plural(result.counts.bookmarks, 'bookmark')} in{' '}
						{plural(result.counts.columns, 'column')}, and{' '}
						{plural(result.counts.folders, 'folder')}. This phone holds{' '}
						{plural(store.groups.length, 'session')} and{' '}
						{plural(store.bookmarks.length, 'bookmark')} now.
						{view === 'regular' && result.counts.copies > 0
							? ` Its page copies (${result.counts.copies}) come back with it.`
							: ''}
					</Text>
					{result.skipped > 0 && (
						<Text style={{color: colors.warn}}>
							{plural(result.skipped, 'item')} in the file cannot be kept and
							are left out because they are damaged.
						</Text>
					)}
					<Button
						label="Restore everything"
						icon="refresh-outline"
						onPress={() => {
							restoreAll(result);
						}}
					/>
					<Button
						kind="plain"
						label="Restore phone settings only"
						icon="phone-portrait-outline"
						disabled={result.phoneSettings === undefined}
						onPress={() => {
							confirm(
								'Restore phone settings?',
								"This phone's settings are replaced with the ones in the backup. Sessions and bookmarks stay.",
								{label: 'Restore', destructive: true},
								() => {
									restoreSettings(result);
								},
							);
						}}
					/>
					{result.phoneSettings === undefined && (
						<Text style={{color: colors.muted}}>
							This backup has no phone settings: it was made by the extension.
						</Text>
					)}
				</>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
});
