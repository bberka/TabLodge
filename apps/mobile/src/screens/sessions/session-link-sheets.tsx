import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../../ui/bottom-sheet';
import {ColumnChoice, useColumnChoice} from '../../library/column-choice';
import {notify} from '../../ui/dialog';
import {addBookmark} from '../../library/board-edits';
import {addTabsToSession, updateSessionTab} from '../../library/session-edits';
import {extractUrl, extractUrls} from '../../library/store-shape';
import {phoneStamp} from '../../platform/device';
import {edit, editIn, newId} from '../../library/library-store';
import {showSnack} from '../../ui/snackbar';
import {useColors} from '../../ui/theme';
import {Button, Field} from '../../ui/widgets';
import {useView} from '../../library/view';
import type {Session} from '../../../../extension/src/shared/types';

function Title({children}: {children: string}) {
	const colors = useColors();
	return (
		<Text
			accessibilityRole="header"
			style={[styles.title, {color: colors.text}]}
		>
			{children}
		</Text>
	);
}

/**
The drawer for adding links to a session: pasted addresses, one or several.
*/
export function AddLinksSheet({
	session,
	onClose,
}: {
	session: Session | undefined;
	onClose: () => void;
}) {
	const [text, setText] = useState('');
	const urls = extractUrls(text);
	useEffect(() => {
		setText('');
	}, [session?.id]);
	return (
		<BottomSheet
			visible={session !== undefined}
			label="Add links"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Title>Add links</Title>
				<Field
					multiline
					autoFocus
					label={`To ${session?.name ?? 'the session'}`}
					value={text}
					placeholder="Paste one address or several"
					autoCapitalize="none"
					autoCorrect={false}
					onChangeText={setText}
				/>
				<Button
					label={urls.length > 1 ? `Add ${urls.length} links` : 'Add the link'}
					icon="checkmark"
					disabled={urls.length === 0 || session === undefined}
					onPress={() => {
						if (!session) {
							return;
						}

						void edit((current) =>
							addTabsToSession(
								current,
								session.id,
								urls,
								urls.map(() => newId()),
								Date.now(),
							),
						).then(() => {
							showSnack(
								urls.length === 1
									? 'Link added to the session'
									: `${urls.length} links added to the session`,
							);
						});
						onClose();
					}}
				/>
			</View>
		</BottomSheet>
	);
}

/**
Some links of a session, to keep as bookmarks: the column is chosen (or made) here.
*/
export type BookmarkLinks = {
	title: string;
	links: Array<{title: string; url: string}>;
};

export function SaveAsBookmarksSheet({
	target,
	onClose,
}: {
	target: BookmarkLinks | undefined;
	onClose: () => void;
}) {
	const view = useView();
	const library = view === 'private' ? 'private' : 'regular';
	const choice = useColumnChoice('', library);
	const [busy, setBusy] = useState(false);
	const count = target?.links.length ?? 0;
	return (
		<BottomSheet
			visible={target !== undefined}
			label="Save as bookmarks"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Title>Save as bookmarks</Title>
				<ColumnChoice choice={choice} />
				<Button
					label={count === 1 ? 'Save the bookmark' : `Save ${count} bookmarks`}
					icon="bookmark-outline"
					disabled={choice.incomplete || count === 0}
					loading={busy}
					onPress={() => {
						if (!target) {
							return;
						}

						setBusy(true);
						void (async () => {
							try {
								const column = await choice.resolve();
								await editIn(library, (current) => {
									let next = current;
									const now = Date.now();
									for (const link of target.links) {
										next = addBookmark(
											next,
											{
												url: link.url,
												title: link.title,
												columnId: column.id,
												device: phoneStamp(),
											},
											newId(),
											now,
										);
									}

									return next;
								});
								showSnack(
									count === 1
										? `Saved to ${column.name}`
										: `${count} bookmarks saved to ${column.name}`,
								);
								onClose();
							} catch {
								notify('Could not save', 'Try again.');
							} finally {
								setBusy(false);
							}
						})();
					}}
				/>
			</View>
		</BottomSheet>
	);
}

/**
The drawer for changing a saved tab's address, title, and notes.
*/
export function EditLinkSheet({
	target,
	onClose,
}: {
	target: {session: Session; tabId: string} | undefined;
	onClose: () => void;
}) {
	const tab = target?.session.tabs.find((entry) => entry.id === target.tabId);
	const [title, setTitle] = useState('');
	const [url, setUrl] = useState('');
	const [notes, setNotes] = useState('');
	useEffect(() => {
		setTitle(tab?.title ?? '');
		setUrl(tab?.url ?? '');
		setNotes(tab?.notes ?? '');
	}, [tab?.id, tab?.title, tab?.url, tab?.notes]);
	const address = extractUrl(url);
	return (
		<BottomSheet
			visible={target !== undefined}
			label="Edit link"
			onClose={onClose}
		>
			<View style={styles.body}>
				<Title>Edit link</Title>
				<Field
					autoFocus
					label="Link"
					icon="link-outline"
					value={url}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					error={
						url.length > 0 && !address
							? 'Enter a web address that starts with http:// or https://.'
							: undefined
					}
					onChangeText={setUrl}
				/>
				<Field label="Title" value={title} onChangeText={setTitle} />
				<Field multiline label="Notes" value={notes} onChangeText={setNotes} />
				<Button
					label="Save"
					icon="checkmark"
					disabled={!address}
					onPress={() => {
						if (target) {
							void edit((current) =>
								updateSessionTab(
									current,
									target.session.id,
									target.tabId,
									{title, url, notes},
									Date.now(),
								),
							);
						}

						onClose();
					}}
				/>
			</View>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	body: {paddingHorizontal: 20, paddingBottom: 8, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
});
