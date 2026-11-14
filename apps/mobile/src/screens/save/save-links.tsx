import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {phoneStamp} from '../../platform/device';
import {stripTrackingParameters} from '../../../../extension/src/shared/tracking-parameters';
import {ColumnChoice, useColumnChoice} from '../../library/column-choice';
import {
	addBookmarks,
	addSession,
	addTabsToSession,
	sessionsIn,
	hostOf,
	extractUrls,
} from '../../library/library';
import {
	editIn,
	type LibraryName,
	newId,
	useLibraryOf,
	useRegularLibrary,
} from '../../library/library-store';
import {hostIsExcluded} from '../../../../extension/src/shared/excluded-sites';
import {LibraryChoice} from '../../library/library-choice';
import {useView} from '../../library/view';
import {getPreferences, setPreferences} from '../../settings/preferences';
import {useColors} from '../../ui/theme';
import {useLinkSettings} from '../../library/use-link-settings';
import {Button, Chips, Field, IconButton, Segmented} from '../../ui/ui';

type Mode = 'bookmarks' | 'session' | 'existing';

/**
The drawer for a share that carries several links, such as a browser's "share tabs": save them as bookmarks, as a
new session, or into a session that exists.
*/
export function SaveLinksForm({
	urls: shared,
	entry = false,
	initialText = '',
	onDone,
}: {
	urls: string[];
	/**
	The person types or pastes the links here, one or several, instead of them coming from a share.
	*/
	entry?: boolean;
	initialText?: string;
	/**
	Called when the drawer should close; `saved` says where the links went.
	*/
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
	const [mode, setMode] = useState<Mode>('bookmarks');
	const [name, setName] = useState('');
	const [target, setTarget] = useState('');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');

	const sessionId = sessions.some((session) => session.id === target)
		? target
		: sessions[0]?.id;
	const excludedSites = useRegularLibrary().settings.excludedOrigins ?? [];
	// Links to excluded websites are left out, as in the extension.
	const allowed = urls.filter(
		(url) => !hostIsExcluded(hostOf(url), excludedSites),
	);
	const skipped = urls.length - allowed.length;
	const links = getPreferences().cleanOnSave
		? allowed.map((url) => stripTrackingParameters(url))
		: allowed;
	const ids = () => links.map(() => newId());
	const blocked =
		links.length === 0 ||
		(mode === 'bookmarks' && choice.incomplete) ||
		(mode === 'existing' && !sessionId);

	const saveLinks = async () => {
		const count = `${links.length} links`;
		if (mode === 'bookmarks') {
			const column = await choice.resolve();
			await editIn(library, (current) =>
				addBookmarks(current, links, column.id, ids(), Date.now()),
			);
			setPreferences({lastColumnId: column.id});
			onDone(`${count} saved to ${column.name}`);
		} else if (mode === 'session') {
			const label = name.trim() || 'Shared links';
			await editIn(library, (current) =>
				addSession(
					current,
					{name: label, urls: links, device: phoneStamp()},
					newId(),
					ids(),
					Date.now(),
				),
			);
			onDone(`${count} saved as the session ${label}`);
		} else if (sessionId) {
			await editIn(library, (current) =>
				addTabsToSession(current, sessionId, links, ids(), Date.now()),
			);
			onDone(
				`${count} added to ${sessions.find((s) => s.id === sessionId)?.name ?? 'the session'}`,
			);
		}
	};

	const save = async () => {
		setSaving(true);
		setProblem('');
		try {
			await saveLinks();
		} catch {
			// A full disk or a storage fault: say so, and let the person try again instead of a button that spins.
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{entry ? 'Add links' : `${urls.length} links shared`}
				</Text>
				<IconButton
					icon="close"
					label="Close"
					onPress={() => {
						onDone();
					}}
				/>
			</View>
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
				<Segmented
					label="Save as"
					items={[
						{id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark-outline'},
						{id: 'session', name: 'New session', icon: 'add-circle-outline'},
						{id: 'existing', name: 'Add to', icon: 'albums-outline'},
					]}
					selected={mode}
					onSelect={setMode}
				/>
				{mode === 'bookmarks' && <ColumnChoice choice={choice} />}
				{mode === 'session' && (
					<Field
						label="Session name"
						icon="albums-outline"
						placeholder="Shared links"
						value={name}
						onChangeText={setName}
					/>
				)}
				{mode === 'existing' &&
					(sessions.length === 0 ? (
						<Text style={{color: colors.muted}}>
							There are no sessions yet. Save these as a new one.
						</Text>
					) : (
						<View style={styles.group}>
							<Text style={{color: colors.muted}}>Session</Text>
							<Chips
								items={sessions.map((session) => ({
									id: session.id,
									name: session.name,
									count: session.tabs.length,
									glyph: 'albums-outline',
								}))}
								selected={sessionId ?? ''}
								onSelect={setTarget}
							/>
						</View>
					))}
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
});
