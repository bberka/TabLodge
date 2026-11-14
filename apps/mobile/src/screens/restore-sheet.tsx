import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../bottom-sheet';
import {type BackupRead, readBackup} from '../backup';
import {confirm, notify} from '../dialog';
import {edit, useLibrary} from '../library-store';
import {restorePreferences} from '../preferences';
import {showSnack} from '../snackbar';
import {useColors} from '../theme';
import {Button, Field} from '../ui';
import {useView} from '../view';

export type RestoreSource = {name: string; bytes: Uint8Array};

type Read = Extract<BackupRead, {ok: true}>;

const plural = (count: number, word: string) =>
	`${count} ${count === 1 ? word : `${word}s`}`;

/**
Restores a backup the phone or the extension made. A password-protected one asks for its password. Then the person
chooses what comes back: everything (the library and the phone's settings) or only the phone's own settings.
*/
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
			`Everything in ${target} on this phone is replaced by the backup's ${plural(read.counts.sessions, 'session')} and ${plural(read.counts.bookmarks, 'bookmark')}, and the phone's settings come back. With a server connected, the replaced items are removed there too.`,
			{label: 'Replace', destructive: true},
			() => {
				void (async () => {
					try {
						await edit((current) => ({
							...current,
							groups: read.store.groups,
							folders: read.store.folders,
							bookmarkColumns: read.store.bookmarkColumns,
							bookmarks: read.store.bookmarks,
							updatedAt: Date.now(),
						}));
						restorePreferences(read.phoneSettings);
						showSnack('Backup restored');
						onDone();
					} catch {
						notify('Could not restore', 'Try again.');
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
					</Text>
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
							restoreSettings(result);
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
