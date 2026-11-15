import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {BottomSheet, SheetHeader} from '../../ui/bottom-sheet';
import {ColorPicker} from '../../ui/color-picker';
import {columnGlyph} from '../../ui/column-icons';
import {IconPicker} from '../../ui/icon-picker';
import {
	addFolder,
	folderLimitProblem,
	folderNameProblem,
	updateFolder,
} from '../../library/session-edits';
import {edit, newId, useLibrary} from '../../library/library-store';
import {useColors} from '../../ui/theme';
import {Button, Field, Switch} from '../../ui/widgets';

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
	// A name that is not allowed is only reported once it was typed, so an empty new form does not start in error. A
	// library at its folder limit says so at once, because no name would work.
	const problem =
		name === '' && !folder
			? folderLimitProblem(store)
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
			<SheetHeader
				title={folder ? 'Edit folder' : 'New folder'}
				onClose={() => {
					onDone();
				}}
			/>
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
					<View style={styles.switchRow}>
						<Text style={[styles.switchLabel, {color: colors.text}]}>
							Color its sessions
						</Text>
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
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
	switchRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
	switchLabel: {flex: 1, fontSize: 16},
});
