import {ShareIntentProvider, useShareIntentContext} from 'expo-share-intent';
import {StatusBar} from 'expo-status-bar';
import {useCallback, useEffect, useState} from 'react';
import {
	AppState,
	BackHandler,
	Linking,
	Platform,
	StyleSheet,
	ToastAndroid,
	View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {BottomSheet} from './src/ui/bottom-sheet';
import {extractUrls, splitShared} from './src/library/store-shape';
import {runBackAction} from './src/ui/back-actions';
import {pauseSync, startLibrary, wakeSync} from './src/library/library-store';
import {purgeTrash} from './src/library/trash-store';
import {startPreferencesSync} from './src/settings/preferences-sync';
import {markActive, startPrivateAutoLock} from './src/private/private-autolock';
import {ShareHost} from './src/screens/transfer/transfer-sheets';
import {
	pausePrivate,
	startPrivate,
	wakePrivate,
} from './src/private/private-library';
import {loadPreferences} from './src/settings/preferences';
import {usePendingJump} from './src/library/jump';
import {BookmarksScreen} from './src/screens/bookmarks/bookmarks';
import {ConnectSheet} from './src/screens/settings/connect-sheet';
import {SaveLinkForm} from './src/screens/save/save-link';
import {SaveLinksForm} from './src/screens/save/save-links';
import {SessionsScreen} from './src/screens/sessions/sessions';
import {SettingsScreen} from './src/screens/settings/settings';
import {DialogHost} from './src/ui/dialog';
import {PrivateSheetHost} from './src/private/private-sheets';
import {SnackbarHost, showSnack} from './src/ui/snackbar';
import {type BarTab, TabBar} from './src/ui/tab-bar';
import {useColors} from './src/ui/theme';
import {setView} from './src/library/view';
import {requestSearch} from './src/ui/search-action';
import {parseTileRoute, type TileRoute} from './src/platform/tile-route';
import {readClipboard} from './modules/quick-tiles';

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
	/**
	The drawer for pasting or typing several links, opened from Add link.
	*/
	many: boolean;
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
		many: false,
		quick: false,
	});
	const [open, setOpen] = useState(false);
	// A search result that leads to a session or column opens that screen.
	const jump = usePendingJump();
	useEffect(() => {
		if (jump) {
			setTab(jump.screen);
		}
	}, [jump]);
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
			.then(purgeTrash)
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

	useEffect(() => startPrivateAutoLock(), []);

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
			many: false,
			quick: Date.now() - BOOT < COLD_MS,
		}));
		setTab('bookmarks');
		setOpen(true);
		resetShareIntent();
	}, [hasShareIntent, shareIntent, resetShareIntent]);

	// A Quick Settings tile opens the app at tablodge://save or tablodge://search, always on the regular library.
	const openTile = useCallback(async (route: TileRoute) => {
		setView('regular');
		setTab('bookmarks');
		if (route === 'search') {
			setOpen(false);
			requestSearch();
			return;
		}

		// A copied link fills the field, with any words around it as the title; anything else leaves it empty.
		const quick = Date.now() - BOOT < COLD_MS;
		const parts = splitShared(await readClipboard());
		setDraft((current) => ({
			key: current.key + 1,
			text: parts.url ?? '',
			title: parts.title,
			urls: [],
			many: false,
			quick,
		}));
		setOpen(true);
	}, []);

	useEffect(() => {
		const follow = (url?: string | null) => {
			const route = parseTileRoute(url);
			if (route) {
				void openTile(route);
			}
		};

		void Linking.getInitialURL().then(follow);
		const subscription = Linking.addEventListener('url', ({url}) => {
			follow(url);
		});
		return () => {
			subscription.remove();
		};
	}, [openTile]);

	const openBlank = useCallback(() => {
		setDraft((current) => ({
			key: current.key + 1,
			text: '',
			title: '',
			urls: [],
			many: false,
			quick: false,
		}));
		setOpen(true);
	}, []);

	const finish = (saved?: string) => {
		setOpen(false);
		if (saved) {
			// A single link reports its column; a list of links says what happened in full.
			const message =
				draft.urls.length > 1 || draft.many ? saved : `Saved to ${saved}`;
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
		<View
			style={[styles.screen, {backgroundColor: colors.background}]}
			onTouchStart={markActive}
		>
			<SafeAreaView edges={['top']} style={styles.body}>
				<StatusBar style="auto" />
				{tab === 'bookmarks' && (
					<BookmarksScreen
						onAdd={openBlank}
						onConnect={connect}
						onSelecting={setSelecting}
					/>
				)}
				{tab === 'sessions' && (
					<SessionsScreen
						onConnect={connect}
						onAdd={openBlank}
						onSelecting={setSelecting}
					/>
				)}
				{tab === 'settings' && <SettingsScreen onConnect={connect} />}
			</SafeAreaView>
			<TabBar tabs={TABS} selected={tab} hidden={selecting} onSelect={setTab} />
			<SnackbarHost />
			<DialogHost />
			<PrivateSheetHost />
			<ShareHost />
			<ConnectSheet
				visible={connecting}
				onClose={() => {
					setConnecting(false);
				}}
			/>
			<BottomSheet
				scroll={false}
				visible={open}
				label={draft.urls.length > 1 || draft.many ? 'Save links' : 'Save link'}
				onClose={() => {
					finish();
				}}
			>
				{draft.urls.length > 1 || draft.many ? (
					<SaveLinksForm
						key={draft.key}
						urls={draft.urls}
						entry={draft.many}
						initialText={draft.text}
						onDone={finish}
					/>
				) : (
					<SaveLinkForm
						key={draft.key}
						initialText={draft.text}
						initialTitle={draft.title}
						onMany={(text) => {
							setDraft((current) => ({
								...current,
								key: current.key + 1,
								text,
								urls: [],
								many: true,
							}));
						}}
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
