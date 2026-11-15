import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../../ui/bottom-sheet';
import {confirm} from '../../ui/dialog';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {Button, Empty, Segmented} from '../../ui/widgets';
import {useRegularLibrary} from '../../library/library-store';
import {
	deleteForever,
	emptyTrash,
	purgeTrash,
	restoreFromTrash,
	useTrash,
} from '../../library/trash-store';
import {
	DEFAULT_RETENTION_DAYS,
	daysLeft,
	describeEntry,
	filterTrash,
	type TrashEntry,
	type TrashFilter,
} from '../../library/trash';
import {useView} from '../../library/view';
import {SettingsCard} from './settings-card';
import {SECTIONS} from './settings-index';

const countLabel = (count: number) =>
	`${count} ${count === 1 ? 'item' : 'items'}`;

function TrashRow({
	entry,
	daysKept,
	now,
	onRestore,
	onDelete,
}: {
	entry: TrashEntry;
	daysKept: number;
	now: number;
	onRestore: () => void;
	onDelete: () => void;
}) {
	const colors = useColors();
	const {title, origin, links} = describeEntry(entry);
	const left = daysLeft(entry, daysKept, now);
	return (
		<View
			style={[
				styles.row,
				{backgroundColor: colors.surface, borderColor: colors.border},
			]}
		>
			<Text numberOfLines={2} style={[styles.rowTitle, {color: colors.text}]}>
				{title}
			</Text>
			<Text style={{color: colors.muted}}>
				{origin}
				{links > 0 ? ` · ${links} ${links === 1 ? 'link' : 'links'}` : ''}
				{` · ${left} ${left === 1 ? 'day' : 'days'} left`}
			</Text>
			<View style={styles.actions}>
				<Button label="Restore" icon="refresh-outline" onPress={onRestore} />
				<Button
					label="Delete forever"
					icon="trash-outline"
					kind="danger"
					onPress={onDelete}
				/>
			</View>
		</View>
	);
}

/**
What was deleted from the library on screen, with a way back. The private library's trash shows only while that
library is open.
*/
function TrashSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	const name = useView();
	const items = useTrash(name, visible);
	const [filter, setFilter] = useState<TrashFilter>('all');
	const shown = filterTrash(items, filter);
	const [now] = useState(() => Date.now());
	const days =
		useRegularLibrary().settings.trashRetentionDays || DEFAULT_RETENTION_DAYS;
	const restore = (entry: TrashEntry) => {
		void restoreFromTrash(name, entry).then(({note, error}) => {
			showSnack(error ?? (note ? `Restored. ${note}` : 'Restored'));
		});
	};

	const empty = () => {
		confirm(
			'Empty the trash?',
			`${countLabel(items.length)} will be deleted for good. This cannot be undone.`,
			{label: 'Empty trash', destructive: true},
			() => {
				void emptyTrash(name).then(() => {
					showSnack('Trash emptied');
				});
			},
		);
	};

	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label="Trash"
			onClose={onClose}
		>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				showsVerticalScrollIndicator={false}
			>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{name === 'private' ? 'Private trash' : 'Trash'}
				</Text>
				<Text style={{color: colors.muted}}>
					Kept for {days} days, then deleted. With a sync server connected, the
					trash is shared with your other devices. Change the time in the
					TabLodge extension's settings.
				</Text>
				{items.length === 0 ? (
					<Empty icon="trash-outline" title="The trash is empty">
						Sessions, links, bookmarks, columns, and folders you delete show up
						here.
					</Empty>
				) : (
					<>
						<Segmented
							label="Show"
							selected={filter}
							items={[
								{
									id: 'all',
									name: `All ${items.length}`,
									icon: 'apps-outline',
								},
								{
									id: 'sessions',
									name: `Sessions ${filterTrash(items, 'sessions').length}`,
									icon: 'albums-outline',
								},
								{
									id: 'bookmarks',
									name: `Bookmarks ${filterTrash(items, 'bookmarks').length}`,
									icon: 'bookmark-outline',
								},
							]}
							onSelect={setFilter}
						/>
						{shown.length === 0 && (
							<Empty icon="trash-outline" title="Nothing here">
								{filter === 'bookmarks'
									? 'No deleted bookmarks or columns.'
									: 'No deleted sessions, links, or folders.'}
							</Empty>
						)}
						{shown.map((entry) => (
							<TrashRow
								key={entry.id}
								entry={entry}
								daysKept={days}
								now={now}
								onRestore={() => {
									restore(entry);
								}}
								onDelete={() => {
									confirm(
										'Delete forever?',
										`${describeEntry(entry).title} will be deleted for good.`,
										{label: 'Delete forever', destructive: true},
										() => {
											void deleteForever(name, entry.id);
										},
									);
								}}
							/>
						))}
						<Button
							label="Empty trash"
							icon="trash-outline"
							kind="danger"
							onPress={empty}
						/>
					</>
				)}
			</ScrollView>
		</BottomSheet>
	);
}

/**
The way into the trash of the library on screen.
*/
export function TrashCard() {
	const [open, setOpen] = useState(false);
	const name = useView();
	const items = useTrash(name);
	return (
		<SettingsCard
			section={SECTIONS.trash}
			icon="trash-bin-outline"
			description="Bring back what you deleted on this phone."
		>
			<Button
				label={`${name === 'private' ? 'Private trash' : 'Trash'} (${items.length})`}
				icon="trash-bin-outline"
				kind="plain"
				onPress={() => {
					void purgeTrash();
					setOpen(true);
				}}
			/>
			<TrashSheet
				visible={open}
				onClose={() => {
					setOpen(false);
				}}
			/>
		</SettingsCard>
	);
}

const styles = StyleSheet.create({
	scroll: {flexGrow: 0},
	body: {padding: 16, gap: 12},
	title: {fontSize: 20, fontWeight: '700'},
	row: {borderWidth: 1, borderRadius: 12, padding: 12, gap: 6},
	rowTitle: {fontSize: 16, fontWeight: '600'},
	actions: {gap: 8, marginTop: 6},
});
