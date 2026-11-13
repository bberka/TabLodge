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
import {runBackAction} from './src/back-actions';
import {pauseSync, startLibrary, wakeSync} from './src/library-store';
import {startPreferencesSync} from './src/preferences-sync';
import {pausePrivate, startPrivate, wakePrivate} from './src/private-library';
import {loadPreferences} from './src/preferences';
import {BookmarksScreen} from './src/screens/bookmarks';
import {ConnectSheet} from './src/screens/connect-sheet';
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
	// The connect drawer is here so an empty screen and Settings can both open it.
	const [connecting, setConnecting] = useState(false);
	const connect = useCallback(() => {
		setConnecting(true);
	}, []);

	// Back ends a selection first, then returns to Bookmarks from another tab, and only then leaves the app.
	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			'hardwareBackPress',
			() => {
				if (runBackAction()) {
					return true;
				}

				if (tab === 'bookmarks') {
					return false;
				}

				setTab('bookmarks');
				return true;
			},
		);
		return () => {
			subscription.remove();
		};
	}, [tab]);

	useEffect(() => {
		void loadPreferences()
			.then(startLibrary)
			.then(startPrivate)
			.then(startPreferencesSync);
		const subscription = AppState.addEventListener('change', (state) => {
			// Behind other apps, the live connection and its timers stop; in front they resume and catch up.
			if (state === 'active') {
				void wakeSync();
				void wakePrivate();
			} else if (state === 'background') {
				void pauseSync();
				void pausePrivate();
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
					<BookmarksScreen
						onAdd={openBlank}
						onConnect={connect}
						onSelecting={setSelecting}
					/>
				)}
				{tab === 'sessions' && <SessionsScreen onConnect={connect} />}
				{tab === 'settings' && <SettingsScreen onConnect={connect} />}
			</SafeAreaView>
			<TabBar tabs={TABS} selected={tab} hidden={selecting} onSelect={setTab} />
			<SnackbarHost />
			<ConnectSheet
				visible={connecting}
				onClose={() => {
					setConnecting(false);
				}}
			/>
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
