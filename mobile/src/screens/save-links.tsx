import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {stripTrackingParameters} from '../../../src/app/tracking-parameters';
import {ColumnChoice, useColumnChoice} from '../column-choice';
import {
	addBookmarks,
	addSession,
	addTabsToSession,
	sessionsIn,
} from '../library';
import {edit, newId, useRegularLibrary} from '../library-store';
import {getPreferences, setPreferences} from '../preferences';
import {useColors} from '../theme';
import {useLinkSettings} from '../use-link-settings';
import {Button, Chips, Field, IconButton, Segmented} from '../ui';

type Mode = 'bookmarks' | 'session' | 'existing';

/**
The drawer for a share that carries several links, such as a browser's "share tabs": save them as bookmarks, as a
new session, or into a session that exists.
*/
export function SaveLinksForm({
	urls,
	onDone,
}: {
	urls: string[];
	/**
	Called when the drawer should close; `saved` says where the links went.
	*/
	onDone: (saved?: string) => void;
}) {
	const colors = useColors();
	const store = useRegularLibrary();
	const settings = useLinkSettings(true);
	const choice = useColumnChoice();
	const sessions = sessionsIn(store, 'all', settings.sessionSort);
	const [mode, setMode] = useState<Mode>('bookmarks');
	const [name, setName] = useState('');
	const [target, setTarget] = useState('');
	const [saving, setSaving] = useState(false);

	const sessionId = sessions.some((session) => session.id === target)
		? target
		: sessions[0]?.id;
	const links = getPreferences().cleanOnSave
		? urls.map((url) => stripTrackingParameters(url))
		: urls;
	const ids = () => links.map(() => newId());
	const blocked =
		(mode === 'bookmarks' && choice.incomplete) ||
		(mode === 'existing' && !sessionId);

	const save = async () => {
		setSaving(true);
		const count = `${links.length} links`;
		if (mode === 'bookmarks') {
			const column = await choice.resolve();
			await edit((current) =>
				addBookmarks(current, links, column.id, ids(), Date.now()),
			);
			setPreferences({lastColumnId: column.id});
			onDone(`${count} saved to ${column.name}`);
		} else if (mode === 'session') {
			const label = name.trim() || 'Shared links';
			await edit((current) =>
				addSession(
					current,
					{name: label, urls: links},
					newId(),
					ids(),
					Date.now(),
				),
			);
			onDone(`${count} saved as the session ${label}`);
		} else if (sessionId) {
			await edit((current) =>
				addTabsToSession(current, sessionId, links, ids(), Date.now()),
			);
			onDone(
				`${count} added to ${sessions.find((s) => s.id === sessionId)?.name ?? 'the session'}`,
			);
		}
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{`${urls.length} links shared`}
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
				<Segmented
					label="Save as"
					items={[
						{id: 'bookmarks', name: 'Bookmarks'},
						{id: 'session', name: 'New session'},
						{id: 'existing', name: 'Add to session'},
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
				<Button
					label={`Save ${urls.length} links`}
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
