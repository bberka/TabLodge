import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
	pageAddress,
	quoteTarget,
} from '../../../../extension/src/shared/quotes';
import {searchBookmarks} from '../../library/board-edits';
import {ColumnChoice, useColumnChoice} from '../../library/column-choice';
import {LibraryChoice} from '../../library/library-choice';
import {
	editIn,
	type LibraryName,
	newId,
	useLibraryOf,
} from '../../library/library-store';
import {useLinkPreview} from '../../library/link-preview';
import {phoneStamp} from '../../platform/device';
import {type QuoteUndo, saveQuote} from '../../library/quote-edits';
import {extractUrl, hostOf} from '../../library/store-shape';
import {useView} from '../../library/view';
import {cleanPageTitle} from '../../library/links';
import {useLinkSettings} from '../../library/use-link-settings';
import {setPreferences, usePreferences} from '../../settings/preferences';
import {SheetHeader} from '../../ui/bottom-sheet';
import {SiteIcon} from '../../ui/site-icon';
import {useColors} from '../../ui/theme';
import {Button, Field} from '../../ui/widgets';

export type SavedQuote = {
	placed: string;
	library: LibraryName;
	undo: QuoteUndo;
};

/**
The save drawer for text shared as a quote. It goes into the note of the page's bookmark (or saved tab) with a link to
the passage, as the extension's Save quote does. When no page link came with the text, the person pastes one or picks
a bookmark, which the link field searches.
*/
export function SaveQuoteForm({
	initialQuote,
	initialUrl,
	onLink,
	onDone,
}: {
	initialQuote: string;
	initialUrl: string;
	/**
	Opens Save link with the shared text instead.
	*/
	onLink: () => void;
	onDone: (saved?: SavedQuote) => void;
}) {
	const colors = useColors();
	const view = useView();
	const [library, setLibrary] = useState<LibraryName>(
		view === 'private' ? 'private' : 'regular',
	);
	const store = useLibraryOf(library);
	const choice = useColumnChoice('', library);
	const [quote, setQuote] = useState(initialQuote);
	const [text, setText] = useState(initialUrl);
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');

	const link = extractUrl(text);
	const url = link ? pageAddress(link) : undefined;
	const target = url ? quoteTarget(store, url) : undefined;
	const {savePreview} = usePreferences();
	const {cleanTitles} = useLinkSettings();
	const {preview} = useLinkPreview(
		target?.kind === 'new' ? url : undefined,
		savePreview,
	);
	// Words in the link field search the bookmarks, so a quote can go on a page saved before.
	const matches = url
		? []
		: (text.trim()
				? searchBookmarks(store, text)
				: store.bookmarks.toSorted((a, b) => b.updatedAt - a.updatedAt)
			).slice(0, 5);

	const save = async () => {
		if (!url) {
			return;
		}

		setSaving(true);
		setProblem('');
		try {
			const {id: columnId} =
				target?.kind === 'new' ? await choice.resolve() : {id: choice.columnId};
			let saved: SavedQuote | undefined;
			let refused = '';
			await editIn(library, (current) => {
				const result = saveQuote(
					current,
					{
						url,
						quote,
						title: cleanPageTitle(preview?.title ?? '', cleanTitles),
						columnId,
						device: phoneStamp(),
					},
					newId(),
					Date.now(),
				);
				if (!result.ok) {
					refused = result.error;
					return current;
				}

				saved = {placed: result.placed, library, undo: result.undo};
				return result.store;
			});
			if (!saved) {
				setProblem(refused || 'Could not save. Try again.');
				return;
			}

			if (target?.kind === 'new') {
				setPreferences({lastColumnId: columnId});
			}

			onDone(saved);
		} catch {
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={styles.screen}>
			<SheetHeader
				title="Save quote"
				onClose={() => {
					onDone();
				}}
			/>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				<LibraryChoice value={library} onChange={setLibrary} />
				<Field multiline label="Quote" value={quote} onChangeText={setQuote} />
				<Field
					label="Page"
					icon="link-outline"
					value={text}
					placeholder="Paste the page link, or search bookmarks"
					autoCapitalize="none"
					autoCorrect={false}
					onChangeText={setText}
					onClear={() => {
						setText('');
					}}
				/>
				{!url && (
					<View style={styles.group}>
						<Text style={{color: colors.muted}}>
							{initialUrl
								? 'Bookmarks'
								: 'No page link came with this text. Paste it above, or pick a bookmark.'}
						</Text>
						{matches.map((bookmark) => (
							<Pressable
								key={bookmark.id}
								accessibilityRole="button"
								accessibilityLabel={`${bookmark.title}, ${hostOf(bookmark.url)}`}
								accessibilityHint="Saves the quote on this bookmark"
								style={({pressed}) => [
									styles.match,
									{
										borderColor: colors.border,
										backgroundColor: pressed ? colors.pressed : colors.surface,
									},
								]}
								onPress={() => {
									setText(bookmark.url);
								}}
							>
								<SiteIcon host={hostOf(bookmark.url)} size={28} />
								<View style={styles.matchText}>
									<Text numberOfLines={1} style={{color: colors.text}}>
										{bookmark.title}
									</Text>
									<Text numberOfLines={1} style={{color: colors.muted}}>
										{hostOf(bookmark.url)}
									</Text>
								</View>
							</Pressable>
						))}
					</View>
				)}
				{target && target.kind !== 'new' && (
					<Text style={{color: colors.muted}}>
						{target.kind === 'bookmark'
							? `Adds to the note of “${target.bookmark.title}”.`
							: `Adds to the note of this page in “${target.group.name}”.`}
					</Text>
				)}
				{target?.kind === 'new' && <ColumnChoice choice={choice} />}
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				<Button
					label="Save quote"
					icon="checkmark"
					disabled={
						!url ||
						!quote.trim() ||
						(target?.kind === 'new' && choice.incomplete)
					}
					loading={saving}
					onPress={() => void save()}
				/>
				<Button
					kind="plain"
					label="Save as a link instead"
					icon="link-outline"
					onPress={onLink}
				/>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flexShrink: 1},
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
	match: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: 48,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 12,
	},
	matchText: {flex: 1},
});
