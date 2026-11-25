import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {phoneStamp} from '../../platform/device';
import {ColumnChoice, useColumnChoice} from '../../library/column-choice';
import {addBookmarks} from '../../library/board-edits';
import {
	type SaveOutcome,
	saveMessage,
} from '../../../../extension/src/shared/save-feedback';
import {bookmarkCount, counted, tabCount} from '../../library/save-outcome';
import {
	addSession,
	addTabsToSession,
	sessionsIn,
} from '../../library/session-edits';
import {hostOf, extractUrls} from '../../library/store-shape';
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
import {setPreferences} from '../../settings/preferences';
import {SheetHeader} from '../../ui/bottom-sheet';
import {useColors} from '../../ui/theme';
import {linkSettings} from '../../library/links';
import {defaultSessionName} from '../../library/session-name';
import {useLinkSettings} from '../../library/use-link-settings';
import {Button, Chips, Field} from '../../ui/widgets';
import {SAVE_TARGET_ROWS, type SaveTarget} from './save-target';

const NEW_SESSION = '__new-session__';

export function SaveLinksForm({
	urls: shared,
	entry = false,
	initialText = '',
	onDone,
}: {
	urls: string[];
	entry?: boolean;
	initialText?: string;
	onDone: (saved?: string) => void;
}) {
	const colors = useColors();
	const view = useView();
	const [library, setLibrary] = useState<LibraryName>(
		view === 'private' ? 'private' : 'regular',
	);
	const store = useLibraryOf(library);
	const settings = useLinkSettings(true);
	const choice = useColumnChoice('', library);
	const sessions = sessionsIn(store, 'all', settings.sessionSort);
	const [text, setText] = useState(initialText);
	const urls = entry ? extractUrls(text) : shared;
	const [mode, setMode] = useState<SaveTarget>('bookmark');
	const [name, setName] = useState('');
	const [target, setTarget] = useState(NEW_SESSION);
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');

	const creating = target === NEW_SESSION || sessions.length === 0;
	const sessionId = sessions.some((session) => session.id === target)
		? target
		: undefined;
	const excludedSites = useRegularLibrary().settings.excludedOrigins ?? [];
	const allowed = urls.filter(
		(url) => !hostIsExcluded(hostOf(url), excludedSites),
	);
	const skipped = urls.length - allowed.length;
	const links = allowed;
	const ids = () => links.map(() => newId());
	const placeholder = defaultSessionName(
		linkSettings(store.settings),
		links.map((url) => ({url})),
	);
	const blocked =
		links.length === 0 ||
		(mode === 'bookmark' && choice.incomplete) ||
		(mode === 'session' && !creating && !sessionId);

	const finish = (outcome: SaveOutcome) => {
		if (outcome.kind === 'saved') {
			onDone(saveMessage(outcome));
		} else {
			setProblem(saveMessage(outcome));
		}
	};

	const saveLinks = async () => {
		if (mode === 'bookmark') {
			const column = await choice.resolve();
			const run = counted(bookmarkCount, (current) =>
				addBookmarks(
					current,
					links,
					column.id,
					ids(),
					Date.now(),
					phoneStamp(),
				),
			);
			await editIn(library, run.change);
			setPreferences({lastColumnId: column.id});
			finish(run.outcome(links.length, 'link', column.name));
		} else if (creating) {
			const label =
				name.trim() ||
				defaultSessionName(
					linkSettings(store.settings),
					links.map((url) => ({url})),
				);
			const run = counted(tabCount, (current) =>
				addSession(
					current,
					{name: label, urls: links, device: phoneStamp()},
					newId(),
					ids(),
					Date.now(),
				),
			);
			await editIn(library, run.change);
			finish(run.outcome(links.length, 'link', label));
		} else if (sessionId) {
			const run = counted(tabCount, (current) =>
				addTabsToSession(current, sessionId, links, ids(), Date.now()),
			);
			await editIn(library, run.change);
			finish(
				run.outcome(
					links.length,
					'link',
					sessions.find((s) => s.id === sessionId)?.name ?? 'the session',
				),
			);
		}
	};

	const save = async () => {
		setSaving(true);
		setProblem('');
		try {
			await saveLinks();
		} catch {
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={styles.screen}>
			<SheetHeader
				title={entry ? 'Add links' : `${urls.length} links shared`}
				onClose={() => {
					onDone();
				}}
			/>
			{skipped > 0 && (
				<Text
					accessibilityLiveRegion="polite"
					style={{color: colors.muted, paddingHorizontal: 20}}
				>
					{`${skipped} ${skipped === 1 ? 'link is' : 'links are'} from excluded websites and will not be saved.`}
				</Text>
			)}
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				{entry && (
					<Field
						autoFocus
						multiline
						label="Links, one per line"
						icon="link-outline"
						placeholder="https://example.com"
						value={text}
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						error={
							text.trim() !== '' && urls.length === 0
								? 'Enter web addresses that start with http:// or https://.'
								: undefined
						}
						onChangeText={setText}
					/>
				)}
				<LibraryChoice value={library} onChange={setLibrary} />
				<ChoiceGroup
					title="Save to"
					choices={SAVE_TARGET_ROWS}
					value={mode}
					onPick={setMode}
				/>
				{mode === 'bookmark' && <ColumnChoice choice={choice} />}
				{mode === 'session' && (
					<View style={styles.group}>
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
							selected={creating ? NEW_SESSION : (sessionId ?? '')}
							onSelect={setTarget}
						/>
						{creating && (
							<Field
								label="Session name"
								icon="albums-outline"
								placeholder={placeholder}
								value={name}
								onChangeText={setName}
							/>
						)}
					</View>
				)}
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				<Button
					label={`Save ${links.length} ${links.length === 1 ? 'link' : 'links'}`}
					icon="checkmark"
					disabled={blocked}
					loading={saving}
					onPress={() => void save()}
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
});
