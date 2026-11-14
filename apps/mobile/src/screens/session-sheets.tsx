import {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {Folder, Session} from '../../../extension/src/shared/types';
import {BottomSheet} from '../bottom-sheet';
import {TARGET, useColors} from '../theme';
import {Button, Field, Icon} from '../ui';

/**
The drawer for renaming a session, or another named thing such as a folder when `title` and `label` say so. `check`
returns what is wrong with a name, if anything, on top of it being empty.
*/
export function RenameSheet({
	session,
	title = 'Rename session',
	label = 'Session name',
	check,
	onSave,
	onClose,
}: {
	session: {id: string; name: string} | undefined;
	title?: string;
	label?: string;
	check?: (name: string) => string | undefined;
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
	const problem = name.trim() === '' ? 'Enter a name' : check?.(name);
	return (
		<BottomSheet
			visible={session !== undefined}
			label={title}
			onClose={onClose}
		>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{title}
				</Text>
				<Field
					autoFocus
					label={label}
					value={name}
					returnKeyType="done"
					error={problem}
					onChangeText={setName}
					onSubmitEditing={() => {
						if (!problem) {
							onSave(name);
						}
					}}
				/>
				<Button
					label="Save"
					icon="checkmark"
					disabled={Boolean(problem)}
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
							style={({pressed}) => [
								styles.row,
								pressed && {backgroundColor: colors.pressed},
							]}
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
		borderRadius: 12,
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
	},
	name: {flex: 1, fontSize: 16},
});
