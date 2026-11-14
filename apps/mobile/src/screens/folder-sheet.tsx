import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../bottom-sheet';
import {ColorPicker} from '../color-picker';
import {columnGlyph} from '../column-icons';
import {IconPicker} from '../icon-picker';
import {addFolder, folderNameProblem, updateFolder} from '../library';
import {edit, newId, useLibrary} from '../library-store';
import {useColors} from '../theme';
import {Button, Field, IconButton, Switch} from '../ui';

type Editing = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	colorSessions?: boolean;
};

function FolderForm({
	folder,
	onDone,
}: {
	folder?: Editing;
	onDone: (id?: string) => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const [name, setName] = useState(folder?.name ?? '');
	const [icon, setIcon] = useState(folder?.icon ?? '');
	const [color, setColor] = useState(folder?.color ?? '');
	const [colorSessions, setColorSessions] = useState(
		folder?.colorSessions ?? false,
	);
	const [saving, setSaving] = useState(false);
	// A name that is not allowed is only reported once it was typed, so an empty new form does not start in error.
	const problem =
		name === '' && !folder
			? undefined
			: folderNameProblem(store, name, folder?.id);

	const save = async () => {
		if (folderNameProblem(store, name, folder?.id)) {
			return;
		}

		setSaving(true);
		const values = {name, icon, color, colorSessions};
		const id = folder?.id ?? newId();
		await edit((current) =>
			folder
				? updateFolder(current, id, values, Date.now())
				: addFolder(current, values, id, Date.now()),
		);
		setSaving(false);
		onDone(id);
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{folder ? 'Edit folder' : 'New folder'}
				</Text>
				<IconButton
					icon="close"
					label="Close"
					onPress={() => {
						onDone();
					}}
				/>
			</View>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				<Field
					label="Name"
					icon={columnGlyph(icon)}
					value={name}
					maxLength={60}
					error={problem}
					onChangeText={setName}
				/>
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>Icon</Text>
					<IconPicker selected={icon} onSelect={setIcon} />
				</View>
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>Color</Text>
					<ColorPicker selected={color} onSelect={setColor} />
				</View>
				{color !== '' && (
					<View accessible={false} style={styles.switchRow}>
						<View style={styles.switchText}>
							<Text style={{color: colors.text, fontSize: 16}}>
								Color its sessions
							</Text>
							<Text style={{color: colors.muted}}>
								A session moved into this folder takes its color
							</Text>
						</View>
						<Switch
							label="Color its sessions"
							hint="A session moved into this folder takes its color"
							value={colorSessions}
							onValueChange={setColorSessions}
						/>
					</View>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={Boolean(folderNameProblem(store, name, folder?.id))}
					loading={saving}
					onPress={() => void save()}
				/>
			</ScrollView>
		</View>
	);
}

/**
The drawer for making a session folder, or changing one's name, icon, and color. Pass the folder to change, or nothing for
a new one.
*/
export function FolderEditSheet({
	visible,
	folder,
	onClose,
}: {
	visible: boolean;
	folder?: Editing;
	onClose: (id?: string) => void;
}) {
	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label={folder ? 'Edit folder' : 'New folder'}
			onClose={() => {
				onClose();
			}}
		>
			{visible && (
				<FolderForm
					key={folder?.id ?? 'new'}
					folder={folder}
					onDone={onClose}
				/>
			)}
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	screen: {flexShrink: 1},
	top: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {fontSize: 20, fontWeight: '700'},
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
	switchRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
	switchText: {flex: 1, gap: 2},
});
