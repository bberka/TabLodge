import {ShareIntentProvider, useShareIntentContext} from 'expo-share-intent';
import {StatusBar} from 'expo-status-bar';
import {useCallback, useEffect, useState} from 'react';
import {
	AppState,
	BackHandler,
	Platform,
	StyleSheet,
	ToastAndroid,
	View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {BottomSheet} from './src/bottom-sheet';
import {extractUrls, splitShared} from './src/library';
import {startLibrary, syncClient} from './src/library-store';
import {startPrivate} from './src/private-library';
import {loadPreferences} from './src/preferences';
import {BookmarksScreen} from './src/screens/bookmarks';
import {SaveLinkForm} from './src/screens/save-link';
import {SaveLinksForm} from './src/screens/save-links';
import {SessionsScreen} from './src/screens/sessions';
import {SettingsScreen} from './src/screens/settings';
import {SnackbarHost, showSnack} from './src/snackbar';
import {type BarTab, TabBar} from './src/tab-bar';
import {useColors} from './src/theme';

type Tab = 'bookmarks' | 'sessions' | 'settings';
const TABS: Array<BarTab<Tab>> = [
	{
		id: 'bookmarks',
		label: 'Bookmarks',
		icon: 'bookmark-outline',
		active: 'bookmark',
	},
	{id: 'sessions', label: 'Sessions', icon: 'albums-outline', active: 'albums'},
	{
		id: 'settings',
		label: 'Settings',
		icon: 'settings-outline',
		active: 'settings',
	},
];

// A share that arrives this soon after the JavaScript starts launched the app, so the app can send the user back
// to where they came from once the link is saved.
const BOOT = Date.now();
const COLD_MS = 6000;

type Draft = {
	key: number;
	text: string;
	title: string;
	/**
	Every link in a share. More than one asks where to save them.
	*/
	urls: string[];
	quick: boolean;
};

function Main() {
	const colors = useColors();
	const {hasShareIntent, shareIntent, resetShareIntent} =
		useShareIntentContext();
	const [tab, setTab] = useState<Tab>('bookmarks');
	const [selecting, setSelecting] = useState(false);
	const [draft, setDraft] = useState<Draft>({
		key: 0,
		text: '',
		title: '',
		urls: [],
		quick: false,
	});
	const [open, setOpen] = useState(false);

	useEffect(() => {
		void loadPreferences().then(startLibrary).then(startPrivate);
		const subscription = AppState.addEventListener('change', (state) => {
			if (state === 'active') {
				void syncClient.wake().catch(() => undefined);
			}
		});
		return () => {
			subscription.remove();
		};
	}, []);

	// A link shared from another app opens the drawer with it filled in.
	useEffect(() => {
		if (!hasShareIntent) {
			return;
		}

		// Browsers share "Page title https://example.com"; the words around the link become the title.
		const full = shareIntent.text ?? shareIntent.webUrl ?? '';
		const parts = splitShared(full);
		setDraft((current) => ({
			key: current.key + 1,
			text: shareIntent.webUrl ?? parts.url ?? full,
			title: shareIntent.meta?.title || parts.title,
			urls: extractUrls(full),
			quick: Date.now() - BOOT < COLD_MS,
		}));
		setTab('bookmarks');
		setOpen(true);
		resetShareIntent();
	}, [hasShareIntent, shareIntent, resetShareIntent]);

	const openBlank = useCallback(() => {
		setDraft((current) => ({
			key: current.key + 1,
			text: '',
			title: '',
			urls: [],
			quick: false,
		}));
		setOpen(true);
	}, []);

	const finish = (saved?: string) => {
		setOpen(false);
		if (saved) {
			// A single link reports its column; a list of links says what happened in full.
			const message = draft.urls.length > 1 ? saved : `Saved to ${saved}`;
			if (Platform.OS === 'android' && draft.quick) {
				ToastAndroid.show(message, ToastAndroid.SHORT);
			} else {
				showSnack(message);
			}
		}

		// Opened by a share: go back to the app the link came from.
		if (draft.quick) {
			setTimeout(() => {
				BackHandler.exitApp();
			}, 250);
		}
	};

	return (
		<View style={[styles.screen, {backgroundColor: colors.background}]}>
			<SafeAreaView edges={['top']} style={styles.body}>
				<StatusBar style="auto" />
				{tab === 'bookmarks' && (
					<BookmarksScreen onAdd={openBlank} onSelecting={setSelecting} />
				)}
				{tab === 'sessions' && <SessionsScreen />}
				{tab === 'settings' && <SettingsScreen />}
			</SafeAreaView>
			<TabBar tabs={TABS} selected={tab} hidden={selecting} onSelect={setTab} />
			<SnackbarHost />
			<BottomSheet
				visible={open}
				label={draft.urls.length > 1 ? 'Save links' : 'Save link'}
				onClose={() => {
					finish();
				}}
			>
				{draft.urls.length > 1 ? (
					<SaveLinksForm key={draft.key} urls={draft.urls} onDone={finish} />
				) : (
					<SaveLinkForm
						key={draft.key}
						initialText={draft.text}
						initialTitle={draft.title}
						onDone={finish}
					/>
				)}
			</BottomSheet>
		</View>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<ShareIntentProvider>
				<Main />
			</ShareIntentProvider>
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	body: {flex: 1},
});
