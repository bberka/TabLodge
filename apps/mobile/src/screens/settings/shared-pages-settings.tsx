import {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {SharedPage} from '../../../../extension/src/shared/sync/shared-pages-client';
import {
	copyLink,
	deletePage,
	sharedPages,
	useSharedPagesServer,
} from '../../library/shared-pages';
import {openLink} from '../../platform/open-links';
import {BottomSheet} from '../../ui/bottom-sheet';
import {confirm} from '../../ui/dialog';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {Button, Empty} from '../../ui/widgets';

const sizeLabel = (bytes: number) =>
	bytes < 1000 ? `${bytes} B` : `${Math.ceil(bytes / 1000)} kB`;

function PageRow({page, onDelete}: {page: SharedPage; onDelete: () => void}) {
	const colors = useColors();
	return (
		<View
			style={[
				styles.row,
				{backgroundColor: colors.surface, borderColor: colors.border},
			]}
		>
			<Text numberOfLines={2} style={[styles.rowTitle, {color: colors.text}]}>
				{page.title || 'Untitled page'}
			</Text>
			<Text style={{color: colors.muted}}>
				{new Date(page.createdAt).toLocaleString()} · {sizeLabel(page.size)}
			</Text>
			<Text selectable style={{color: colors.muted}}>
				{page.url}
			</Text>
			<View style={styles.actions}>
				<Button
					label="Copy link"
					icon="copy-outline"
					kind="plain"
					onPress={() => void copyLink(page.url)}
				/>
				<Button
					label="Open"
					icon="open-outline"
					kind="plain"
					onPress={() => {
						openLink(page.url);
					}}
				/>
				<Button
					label="Delete"
					icon="trash-outline"
					kind="danger"
					onPress={onDelete}
				/>
			</View>
		</View>
	);
}

/**
Every page uploaded from Share › HTML page, read from the server each time the sheet opens. Delete takes the page off
the server, so its link stops working.
*/
function SharedPagesSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	const server = useSharedPagesServer();
	const [pages, setPages] = useState<SharedPage[]>();
	const [failed, setFailed] = useState(false);
	const load = useCallback(async () => {
		try {
			setPages(await sharedPages());
			setFailed(false);
		} catch {
			setFailed(true);
		}
	}, []);
	useEffect(() => {
		// Asked also while the server's features are unknown, so an unreachable server ends in an error, not a wait.
		if (visible && server !== 'old') {
			void load();
		}
	}, [visible, server, load]);

	const remove = (page: SharedPage) => {
		confirm(
			'Delete this shared page?',
			'It is removed from your server, and its link stops working for everyone who has it.',
			{label: 'Delete', destructive: true},
			() => {
				void deletePage(page.id)
					.then(async () => {
						showSnack('Page deleted');
						await load();
					})
					.catch(() => {
						showSnack('Could not delete the page');
					});
			},
		);
	};

	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label="Shared pages"
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
					Shared pages
				</Text>
				{server === 'old' ? (
					<Empty icon="cloud-offline-outline" title="Update your server">
						This sync server is too old to keep shared pages.
					</Empty>
				) : failed ? (
					<Empty icon="cloud-offline-outline" title="Cannot reach the server">
						Try again when the phone is online.
					</Empty>
				) : pages === undefined ? (
					<Text style={{color: colors.muted}}>Checking the server…</Text>
				) : pages.length === 0 ? (
					<Empty icon="globe-outline" title="No pages shared yet">
						Share a column or session as a web page and choose Upload to my
						server.
					</Empty>
				) : (
					pages.map((page) => (
						<PageRow
							key={page.id}
							page={page}
							onDelete={() => {
								remove(page);
							}}
						/>
					))
				)}
			</ScrollView>
		</BottomSheet>
	);
}

/**
The way into Shared pages, in Settings › Sync while a server is connected.
*/
export function SharedPagesButton() {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				label="Shared pages"
				icon="globe-outline"
				kind="plain"
				onPress={() => {
					setOpen(true);
				}}
			/>
			<SharedPagesSheet
				visible={open}
				onClose={() => {
					setOpen(false);
				}}
			/>
		</>
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
