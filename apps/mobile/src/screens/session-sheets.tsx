import {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {Folder, Session} from '../../../extension/src/shared/types';
import {BottomSheet} from '../bottom-sheet';
import {TARGET, useColors} from '../theme';
import {Button, Field, Icon} from '../ui';

/**
The drawer for renaming a session.
*/
export function RenameSheet({
	session,
	onSave,
	onClose,
}: {
	session: Session | undefined;
	onSave: (name: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const [name, setName] = useState('');
	const id = session?.id;
	const original = session?.name ?? '';
	useEffect(() => {
		setName(original);
	}, [id, original]);
	const blank = name.trim() === '';
	return (
		<BottomSheet
			visible={session !== undefined}
			label="Rename session"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Rename session
				</Text>
				<Field
					autoFocus
					label="Session name"
					value={name}
					returnKeyType="done"
					error={blank ? 'A session needs a name' : undefined}
					onChangeText={setName}
					onSubmitEditing={() => {
						if (!blank) {
							onSave(name);
						}
					}}
				/>
				<Button
					label="Save"
					icon="checkmark"
					disabled={blank}
					onPress={() => {
						onSave(name);
					}}
				/>
			</View>
		</BottomSheet>
	);
}

/**
The drawer for picking the folder a session goes to.
*/
export function FolderSheet({
	session,
	folders,
	onPick,
	onClose,
}: {
	session: Session | undefined;
	folders: Folder[];
	onPick: (folderId: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet
			visible={session !== undefined}
			label="Move session"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Move to folder
				</Text>
				{folders.map((folder) => {
					const here = folder.id === session?.folderId;
					return (
						<Pressable
							key={folder.id}
							accessibilityRole="radio"
							accessibilityState={{selected: here}}
							accessibilityLabel={folder.name}
							android_ripple={{color: colors.pressed}}
							style={styles.row}
							onPress={() => {
								onClose();
								if (!here) {
									onPick(folder.id);
								}
							}}
						>
							<Icon name="folder-outline" size={24} color={colors.accent} />
							<Text style={[styles.name, {color: colors.text}]}>
								{folder.name}
							</Text>
							{here && <Icon name="checkmark" color={colors.accent} />}
						</Pressable>
					);
				})}
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {gap: 12, paddingHorizontal: 20, paddingBottom: 8},
	title: {fontSize: 20, fontWeight: '700'},
	row: {
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
	},
	name: {flex: 1, fontSize: 16},
});
