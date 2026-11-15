import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {columnNameProblem} from '../../../../extension/src/shared/bookmark-rules';
import {checkColumnSite} from '../../../../extension/src/shared/column-sites';
import type {Store} from '../../../../extension/src/shared/types';
import {BottomSheet, SheetHeader} from '../../ui/bottom-sheet';
import {ColorPicker} from '../../ui/color-picker';
import {columnGlyph} from '../../ui/column-icons';
import {IconPicker} from '../../ui/icon-picker';
import {
	addColumn,
	deleteColumn,
	restoreColumn,
	setColumnSites,
	updateColumn,
} from '../../library/library';
import {showSnack} from '../../ui/snackbar';
import {edit, newId, useLibrary} from '../../library/library-store';
import {trashDeleted} from '../../library/trash-store';
import {useColors} from '../../ui/theme';
import {Button, Field, IconButton} from '../../ui/ui';

/**
Deletes a column at once and offers Undo. Its bookmarks move to another column; with no other column they stay unfiled.
`onDeleted` runs right after.
*/
export function confirmDeleteColumn(
	store: Store,
	column: {id: string; name: string},
	onDeleted: () => void,
): void {
	const whole = store.bookmarkColumns.find((entry) => entry.id === column.id);
	if (!whole) {
		return;
	}

	const own = store.bookmarks.filter(
		(bookmark) => bookmark.columnId === column.id,
	);
	const others = store.bookmarkColumns.filter(
		(entry) => entry.id !== column.id,
	);
	const target = others.find((entry) => entry.isDefault) ?? others[0];
	void edit((current) =>
		deleteColumn(current, column.id, target?.id ?? '', Date.now()),
	);
	void trashDeleted([{kind: 'column', column: whole, bookmarks: own}]);
	onDeleted();
	showSnack(`Deleted ${column.name}`, {
		label: 'Undo',
		run() {
			void edit((current) => restoreColumn(current, whole, own, Date.now()));
		},
	});
}

type Editing = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	domains?: readonly string[];
};

function ColumnForm({
	column,
	onDone,
}: {
	/**
	The column to change, or nothing to make a new one.
	*/
	column?: Editing;
	/**
	Called when the drawer should close; `id` is the column that was made or changed.
	*/
	onDone: (id?: string) => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const [name, setName] = useState(column?.name ?? '');
	const [icon, setIcon] = useState(column?.icon ?? '');
	const [color, setColor] = useState(column?.color ?? '');
	const [sites, setSites] = useState<readonly string[]>(column?.domains ?? []);
	const [siteText, setSiteText] = useState('');
	// Nothing is reported until something was typed; a typed site that cannot be added says why under the field.
	const siteCheck =
		siteText.trim() === '' ? undefined : checkColumnSite(sites, siteText);
	const siteError =
		siteCheck && 'error' in siteCheck ? siteCheck.error : undefined;
	const addSite = () => {
		if (!(siteCheck && 'site' in siteCheck)) {
			return;
		}

		setSites([...sites, siteCheck.site]);
		setSiteText('');
	};

	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');
	// A name that is not allowed is only reported once it was typed, so an empty new form does not start in error.
	const nameProblem =
		name === '' && !column
			? undefined
			: columnNameProblem(store.bookmarkColumns, name, column?.id);

	const save = async () => {
		if (columnNameProblem(store.bookmarkColumns, name, column?.id)) {
			return;
		}

		setSaving(true);
		setProblem('');
		try {
			const id = column?.id ?? newId();
			await edit((current) => {
				const now = Date.now();
				const saved = column
					? updateColumn(current, id, {name, icon, color}, now)
					: addColumn(current, name, id, now, icon, color);
				return setColumnSites(saved, id, sites, now);
			});
			onDone(id);
		} catch {
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	const remove = () => {
		if (column) {
			confirmDeleteColumn(store, column, onDone);
		}
	};

	return (
		<View style={styles.screen}>
			<SheetHeader
				title={column ? 'Edit column' : 'New column'}
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
					error={nameProblem}
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
				<View style={styles.group}>
					<Text style={{color: colors.muted}}>Sites</Text>
					<Text style={[styles.hint, {color: colors.muted}]}>
						Links to these sites, and their subdomains, are saved into this
						column. Add a path such as github.com/bberka to match only that
						part. The longest match wins.
					</Text>
					<Field
						label="Add a site"
						icon="globe-outline"
						value={siteText}
						placeholder="github.com/bberka"
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						returnKeyType="done"
						submitBehavior="submit"
						error={siteError}
						onChangeText={setSiteText}
						onSubmitEditing={addSite}
					/>
					<Button
						label="Add site"
						icon="add"
						kind="plain"
						disabled={!siteCheck || 'error' in siteCheck}
						onPress={addSite}
					/>
					{sites.length === 0 ? (
						<Text style={{color: colors.muted}}>No sites.</Text>
					) : (
						sites.map((site) => (
							<View key={site} style={styles.siteRow}>
								<Text
									numberOfLines={1}
									style={[styles.site, {color: colors.text}]}
								>
									{site}
								</Text>
								<IconButton
									icon="close"
									label={`Remove ${site}`}
									onPress={() => {
										setSites(sites.filter((other) => other !== site));
									}}
								/>
							</View>
						))
					)}
				</View>
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={Boolean(
						columnNameProblem(store.bookmarkColumns, name, column?.id),
					)}
					loading={saving}
					onPress={() => void save()}
				/>
				{column && (
					<Button
						label="Delete column"
						kind="danger"
						icon="trash-outline"
						onPress={remove}
					/>
				)}
			</ScrollView>
		</View>
	);
}

/**
The drawer for making a bookmark column, or changing one's name, icon, color, and sites, or deleting it. Pass the column to
change, or nothing for a new one.
*/
export function ColumnSheet({
	visible,
	column,
	onClose,
}: {
	visible: boolean;
	column?: Editing;
	onClose: (id?: string) => void;
}) {
	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label={column ? 'Edit column' : 'New column'}
			onClose={() => {
				onClose();
			}}
		>
			{visible && (
				<ColumnForm
					key={column?.id ?? 'new'}
					column={column}
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
	hint: {fontSize: 13},
	siteRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
	site: {flex: 1, fontSize: 16},
});
