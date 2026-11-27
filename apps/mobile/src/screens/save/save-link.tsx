import {useEffect, useState} from 'react';
import {
	ActivityIndicator,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import type {Bookmark} from '../../../../extension/src/shared/types';
import {ColumnChoice, useColumnChoice} from '../../library/column-choice';
import {
	addBookmark,
	setBookmarkTags,
	updateBookmark,
} from '../../library/board-edits';
import {
	parseTagInput,
	removedByEdit,
} from '../../../../extension/src/shared/bookmark-tags';
import {
	type SaveOutcome,
	saveMessage,
} from '../../../../extension/src/shared/save-feedback';
import {bookmarkCount, counted, tabCount} from '../../library/save-outcome';
import {showSnack} from '../../ui/snackbar';
import {type TagEdit, TagsField} from '../bookmarks/tags';
import {
	addSession,
	addTabsToSession,
	ALL_SESSIONS_ID,
	sessionsIn,
} from '../../library/session-edits';
import {extractUrl, extractUrls, hostOf} from '../../library/store-shape';
import {phoneStamp} from '../../platform/device';
import {
	editIn,
	type LibraryName,
	newId,
	useLibraryOf,
	useRegularLibrary,
} from '../../library/library-store';
import {hostIsExcluded} from '../../../../extension/src/shared/excluded-sites';
import {LibraryChoice} from '../../library/library-choice';
import {ChoiceGroup} from '../settings/select-row';
import {useView} from '../../library/view';
import {cleanPageTitle, linkSettings} from '../../library/links';
import {useLinkPreview} from '../../library/link-preview';
import {setPreferences, usePreferences} from '../../settings/preferences';
import {SiteIcon} from '../../ui/site-icon';
import {defaultSessionName} from '../../library/session-name';
import {useLinkSettings} from '../../library/use-link-settings';
import {SheetHeader} from '../../ui/bottom-sheet';
import {useColors} from '../../ui/theme';
import {Button, Chips, Field, Icon} from '../../ui/widgets';
import {SAVE_TARGET_ROWS, type SaveTarget} from './save-target';

const NEW_SESSION = '__new-session__';

export function SaveLinkForm({
	initialText,
	initialTitle,
	editing,
	onMany,
	onQuote,
	onDone,
}: {
	initialText: string;
	initialTitle: string;
	editing?: Bookmark;
	onMany?: (text: string) => void;
	onQuote?: () => void;
	onDone: (saved?: string) => void;
}) {
	const colors = useColors();
	const settings = useLinkSettings();
	const view = useView();
	const [library, setLibrary] = useState<LibraryName>(
		view === 'private' ? 'private' : 'regular',
	);
	const choice = useColumnChoice(editing?.columnId, library);
	const store = useLibraryOf(library);
	const sessions = sessionsIn(store, ALL_SESSIONS_ID, settings.sessionSort);
	const [destination, setDestination] = useState<SaveTarget>('bookmark');
	const [sessionPick, setSessionPick] = useState(NEW_SESSION);
	const [sessionName, setSessionName] = useState('');
	const toSession = destination === 'session' && !editing;
	const sessionId = sessions.some((session) => session.id === sessionPick)
		? sessionPick
		: NEW_SESSION;
	const [text, setText] = useState(
		() => extractUrl(initialText) ?? initialText,
	);
	const [title, setTitle] = useState(initialTitle);
	const [titleEdited, setTitleEdited] = useState(initialTitle !== '');
	const [notes, setNotes] = useState(editing?.notes ?? '');
	const [tagged, setTagged] = useState<TagEdit>({
		tags: editing?.tags,
		hiddenKinds: editing?.hiddenKinds,
	});
	const [tagsTouched, setTagsTouched] = useState(false);
	const [tagDraft, setTagDraft] = useState('');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');
	const [notice, setNotice] = useState('');

	const url = extractUrl(text);
	const excludedSites = useRegularLibrary().settings.excludedOrigins ?? [];
	const isExcluded =
		!editing && url !== undefined && hostIsExcluded(hostOf(url), excludedSites);
	const {savePreview} = usePreferences();
	const {loading, preview} = useLinkPreview(url, savePreview && !editing);
	useEffect(() => {
		if (preview?.title && !titleEdited) {
			setTitle(preview.title);
		}
	}, [preview?.title, titleEdited]);

	const finish = (outcome: SaveOutcome) => {
		if (outcome.kind === 'saved') {
			onDone(saveMessage(outcome));
			return true;
		}

		(outcome.kind === 'duplicate' ? setNotice : setProblem)(
			saveMessage(outcome),
		);
		return false;
	};

	const save = async () => {
		if (!url) {
			return;
		}

		setSaving(true);
		setProblem('');
		setNotice('');
		try {
			const saved = {
				url,
				title: cleanPageTitle(title, settings.cleanTitles),
			};
			if (toSession) {
				const label =
					sessionId === NEW_SESSION
						? sessionName.trim() ||
							defaultSessionName(linkSettings(store.settings), [saved])
						: (sessions.find((session) => session.id === sessionId)?.name ??
							'the session');
				const run = counted(tabCount, (current) =>
					sessionId === NEW_SESSION
						? addSession(
								current,
								{
									name: label,
									urls: [saved.url],
									titles: [saved.title],
									device: phoneStamp(),
								},
								newId(),
								[newId()],
								Date.now(),
							)
						: addTabsToSession(
								current,
								sessionId,
								[saved.url],
								[newId()],
								Date.now(),
								[saved.title],
							),
				);
				await editIn(library, run.change);
				finish(run.outcome(1, 'link', label));
				return;
			}

			const {id: target, name} = await choice.resolve();
			const tags = {
				tags: [...(tagged.tags ?? []), ...parseTagInput(tagDraft)],
				hiddenKinds: tagged.hiddenKinds ?? [],
			};
			const tagEdit =
				!editing || tagsTouched || tagDraft.trim() !== '' ? tags : {};

			const run = counted(bookmarkCount, (current) =>
				editing
					? updateBookmark(
							current,
							editing.id,
							{...saved, notes, ...tagEdit, columnId: target},
							Date.now(),
						)
					: addBookmark(
							current,
							{
								...saved,
								notes,
								...tagEdit,
								columnId: target,
								device: phoneStamp(),
							},
							newId(),
							Date.now(),
						),
			);
			await editIn(library, run.change);
			if (editing) {
				onDone();
			} else if (!finish(run.outcome(1, 'bookmark', name))) {
				return;
			}

			setPreferences({lastColumnId: target});
			const removed = editing && tagsTouched && removedByEdit(editing, tags);
			if (editing && removed) {
				showSnack(
					removed.length === 1
						? `Removed tag ${removed[0]}`
						: `Removed ${removed.length} tags`,
					{
						label: 'Undo',
						run() {
							void editIn(library, (current) =>
								setBookmarkTags(current, editing.id, editing, Date.now()),
							);
						},
					},
				);
			}
		} catch {
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={styles.screen}>
			<SheetHeader
				title={editing ? 'Edit link' : 'Save link'}
				onClose={() => {
					onDone();
				}}
			/>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				{!editing && <LibraryChoice value={library} onChange={setLibrary} />}
				{!editing && (
					<ChoiceGroup
						title="Save to"
						choices={SAVE_TARGET_ROWS}
						value={destination}
						onPick={setDestination}
					/>
				)}
				{editing?.deviceName && (
					<View style={styles.savedOn}>
						<Icon
							name={
								editing.deviceKind === 'mobile'
									? 'phone-portrait-outline'
									: 'desktop-outline'
							}
							size={16}
							color={colors.muted}
						/>
						<Text style={{color: colors.muted}}>
							Saved on {editing.deviceName}
						</Text>
					</View>
				)}
				<Field
					label="Link"
					icon="link-outline"
					value={text}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					error={
						text.length > 0 && !url
							? 'Enter a web address that starts with http:// or https://.'
							: isExcluded
								? 'This website is in your excluded websites, so it is not saved.'
								: undefined
					}
					onChangeText={(next) => {
						if (onMany && extractUrls(next).length > 1) {
							onMany(next);
						} else {
							setText(next);
						}
					}}
					onClear={() => {
						setText('');
					}}
				/>
				{onMany && !editing && (
					<Button
						kind="plain"
						label="Add several links"
						icon="list-outline"
						onPress={() => {
							onMany(text);
						}}
					/>
				)}
				{onQuote && !editing && (
					<Button
						kind="plain"
						label="Save as quote"
						icon="chatbox-ellipses-outline"
						onPress={onQuote}
					/>
				)}
				{savePreview && !editing && url && (
					<View style={styles.preview}>
						<SiteIcon always host={hostOf(url)} size={40} />
						<View style={styles.previewText}>
							<Text
								numberOfLines={2}
								style={{color: colors.text, fontWeight: '600'}}
							>
								{preview?.title ?? hostOf(url)}
							</Text>
							{preview?.description && (
								<Text numberOfLines={2} style={{color: colors.muted}}>
									{preview.description}
								</Text>
							)}
						</View>
						{loading && <ActivityIndicator color={colors.muted} />}
					</View>
				)}
				<Field
					label="Title (optional)"
					value={title}
					onChangeText={(next) => {
						setTitleEdited(true);
						setTitle(next);
					}}
				/>
				{toSession ? (
					<View style={styles.sessionChoice}>
						<Text style={{color: colors.muted}}>Session</Text>
						<Chips
							scroll
							items={[
								{
									id: NEW_SESSION,
									name: 'New session',
									glyph: 'add' as const,
									tint: colors.accent,
								},
								...sessions.map((session) => ({
									id: session.id,
									name: session.name,
									count: session.tabs.length,
									glyph: 'albums-outline' as const,
								})),
							]}
							selected={sessionId}
							onSelect={setSessionPick}
						/>
						{sessionId === NEW_SESSION && (
							<Field
								label="Session name"
								icon="albums-outline"
								placeholder={
									url
										? defaultSessionName(linkSettings(store.settings), [
												{url, title},
											])
										: 'Saved links'
								}
								value={sessionName}
								onChangeText={setSessionName}
							/>
						)}
					</View>
				) : (
					<>
						<ColumnChoice choice={choice} />
						<Field
							multiline
							label="Notes (optional)"
							value={notes}
							onChangeText={setNotes}
						/>
						<TagsField
							url={url ?? ''}
							value={tagged}
							draft={tagDraft}
							onDraftChange={setTagDraft}
							onChange={(next) => {
								setTagged(next);
								setTagsTouched(true);
							}}
						/>
					</>
				)}
			</ScrollView>
			<View style={[styles.footer, {borderColor: colors.border}]}>
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				{notice !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.muted}}>
						{notice}
					</Text>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={!url || isExcluded || (!toSession && choice.incomplete)}
					loading={saving}
					onPress={() => void save()}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flexShrink: 1},
	scroll: {flexGrow: 0, flexShrink: 1},
	footer: {
		gap: 8,
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderTopWidth: StyleSheet.hairlineWidth,
	},
	sessionChoice: {gap: 8},
	preview: {flexDirection: 'row', alignItems: 'center', gap: 12},
	previewText: {flex: 1, gap: 2},
	savedOn: {flexDirection: 'row', alignItems: 'center', gap: 6},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
});
