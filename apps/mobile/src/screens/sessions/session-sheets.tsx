import {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, useColorScheme, View} from 'react-native';
import type {Folder, Session} from '../../../../extension/src/shared/types';
import {BottomSheet} from '../../ui/bottom-sheet';
import {ColorPicker} from '../../ui/color-picker';
import {columnGlyph, columnTint} from '../../ui/column-icons';
import {TARGET, useColors} from '../../ui/theme';
import {Button, Chips, Field, Icon} from '../../ui/widgets';

export function RenameSheet({
	session,
	title = 'Rename session',
	label = 'Session name',
	description,
	color,
	folders,
	folderId,
	check,
	onSave,
	onClose,
}: {
	session: {id: string; name: string} | undefined;
	title?: string;
	label?: string;
	description?: string;
	color?: string;
	folders?: Folder[];
	folderId?: string;
	check?: (name: string) => string | undefined;
	onSave: (
		name: string,
		description?: string,
		color?: string,
		folderId?: string,
	) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	const [name, setName] = useState('');
	const [notes, setNotes] = useState('');
	const [tint, setTint] = useState('');
	const [folder, setFolder] = useState('');
	const id = session?.id;
	const original = session?.name ?? '';
	useEffect(() => {
		setName(original);
		setNotes(description ?? '');
		setTint(color ?? '');
		setFolder(folderId ?? '');
	}, [id, original, description, color, folderId]);
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
						if (!problem && description === undefined) {
							onSave(name);
						}
					}}
				/>
				{description !== undefined && (
					<Field
						multiline
						label="Description (optional)"
						value={notes}
						placeholder="What this session is for"
						onChangeText={setNotes}
					/>
				)}
				{folders !== undefined && (
					<>
						<Text style={{color: colors.muted}}>Folder</Text>
						<Chips
							scroll
							items={folders.map((entry) => ({
								id: entry.id,
								name: entry.name,
								glyph: columnGlyph(entry.icon),
								tint: columnTint(entry.color, scheme) ?? colors.accent,
							}))}
							selected={folder}
							onSelect={setFolder}
						/>
					</>
				)}
				{color !== undefined && (
					<>
						<Text style={{color: colors.muted}}>Color</Text>
						<ColorPicker selected={tint} onSelect={setTint} />
					</>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={Boolean(problem)}
					onPress={() => {
						onSave(
							name,
							description === undefined ? undefined : notes,
							color === undefined ? undefined : tint,
							folders === undefined ? undefined : folder,
						);
					}}
				/>
			</View>
		</BottomSheet>
	);
}

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

export function MoveSessionsSheet({
	visible,
	count,
	folders,
	onPick,
	onClose,
}: {
	visible: boolean;
	count: number;
	folders: Folder[];
	onPick: (folderId: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	return (
		<BottomSheet visible={visible} label="Move sessions" onClose={onClose}>
			<View style={styles.body}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Move {count} to
				</Text>
				{folders.map((folder) => (
					<Pressable
						key={folder.id}
						accessibilityRole="button"
						accessibilityLabel={folder.name}
						style={({pressed}) => [
							styles.row,
							pressed && {backgroundColor: colors.pressed},
						]}
						onPress={() => {
							onClose();
							onPick(folder.id);
						}}
					>
						<Icon name="folder-outline" size={24} color={colors.accent} />
						<Text style={[styles.name, {color: colors.text}]}>
							{folder.name}
						</Text>
					</Pressable>
				))}
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
