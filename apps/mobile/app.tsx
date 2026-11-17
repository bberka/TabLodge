import {ShareIntentProvider, useShareIntentContext} from 'expo-share-intent';
import {File, Paths} from 'expo-file-system';
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
import {
	cacheCopies,
	FILE_REFUSED,
	type IncomingShare,
	readShare,
	type ShareOutcome,
} from './src/library/shared-content';
import {
	FileTooLargeError,
	readSharedBytes,
	readSharedText,
} from './src/transfer/files';
import {notify, DialogHost} from './src/ui/dialog';
import {
	RestoreSheet,
	type RestoreSource,
} from './src/screens/transfer/restore-sheet';
import {splitShared} from './src/library/store-shape';
import {runBackAction} from './src/ui/back-actions';
import {pauseSync, startLibrary, wakeSync} from './src/library/library-store';
import {purgeTrash} from './src/library/trash-store';
import {startPreferencesSync} from './src/settings/preferences-sync';
import {markActive, startPrivateAutoLock} from './src/private/private-autolock';
import {
	ImportSheet,
	type ImportSource,
	ShareHost,
} from './src/screens/transfer/transfer-sheets';
import {
	pausePrivate,
	startPrivate,
	wakePrivate,
} from './src/private/private-library';
import {loadPreferences} from './src/settings/preferences';
import {requestJump, usePendingJump} from './src/library/jump';
import {BookmarksScreen} from './src/screens/bookmarks/bookmarks';
import {ConnectSheet} from './src/screens/settings/connect-sheet';
import {SaveLinkForm} from './src/screens/save/save-link';
import {SaveLinksForm} from './src/screens/save/save-links';
import {SessionsScreen} from './src/screens/sessions/sessions';
import {SettingsScreen} from './src/screens/settings/settings';
import {PrivateSheetHost} from './src/private/private-sheets';
import {SnackbarHost, showSnack} from './src/ui/snackbar';
import {useSyncProblemNotice} from './src/library/sync-notice';
import {type BarTab, TabBar} from './src/ui/tab-bar';
import {useColors} from './src/ui/theme';
import {setView} from './src/library/view';
import {requestSearch} from './src/ui/search-action';
import {
	parseColumnRoute,
	parseTileRoute,
	type TileRoute,
} from './src/platform/app-route';
import {startWidgetSnapshot} from './src/library/widget-sync';
import {startPageCopies} from './src/library/page-copies';
import {ReaderHost} from './src/screens/copy/reader';
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
	useSyncProblemNotice(() => {
		setTab('settings');
	});
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
	// An export file or a backup shared from another app opens the same sheets as Settings › Import and export. Each
	// share replaces the last one's sheet, and a new `fileKey` starts it fresh.
	const [sharedFile, setSharedFile] = useState<
		| {kind: 'import'; source: ImportSource}
		| {kind: 'backup'; source: RestoreSource}
	>();
	const [fileKey, setFileKey] = useState(0);
	const closeSharedFile = useCallback(() => {
		setSharedFile(undefined);
	}, []);
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
			.then(startWidgetSnapshot)
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

	useEffect(() => {
		void startPageCopies().catch(() => undefined);
	}, []);

	useEffect(() => startPrivateAutoLock(), []);

	// A shared link opens the drawer with it filled in, an export file the import preview, and a backup Restore. A
	// shared file is read once, and the copy the share library made of it is deleted.
	const openShare = useCallback(
		async (outcome: ShareOutcome, quick: boolean) => {
			setSharedFile(undefined);
			if (outcome.kind === 'refused') {
				if (quick) {
					// The toast stays on screen over the app the file came from.
					ToastAndroid.show(FILE_REFUSED, ToastAndroid.LONG);
					BackHandler.exitApp();
				} else {
					showSnack(FILE_REFUSED);
				}

				return;
			}

			if (outcome.kind === 'link') {
				setDraft((current) => ({
					key: current.key + 1,
					text: outcome.text,
					title: outcome.title,
					urls: outcome.urls,
					many: false,
					quick,
				}));
				setTab('bookmarks');
				setOpen(true);
				return;
			}

			setOpen(false);
			const cannotOpen = (error?: unknown) => {
				notify(
					'Could not open the file',
					error instanceof FileTooLargeError
						? error.message
						: 'It could not be read.',
				);
			};

			if (outcome.kind === 'unreadable') {
				cannotOpen();
				return;
			}

			try {
				if (outcome.kind === 'import') {
					const text = await readSharedText(outcome.path, outcome.size);
					setFileKey((key) => key + 1);
					setSharedFile({
						kind: 'import',
						source: {mode: 'file', name: outcome.name, text},
					});
				} else {
					const bytes = await readSharedBytes(outcome.path, outcome.size);
					setFileKey((key) => key + 1);
					setSharedFile({
						kind: 'backup',
						source: {name: outcome.name, bytes},
					});
				}
			} catch (error) {
				cannotOpen(error);
			}
		},
		[],
	);

	useEffect(() => {
		if (!hasShareIntent) {
			return;
		}

		const share: IncomingShare = shareIntent;
		const quick = Date.now() - BOOT < COLD_MS;
		resetShareIntent();
		void openShare(readShare(share), quick).finally(() => {
			for (const path of cacheCopies(share, Paths.cache.uri)) {
				try {
					new File(path).delete();
				} catch {
					// Already gone; the system clears the cache in any case.
				}
			}
		});
	}, [hasShareIntent, shareIntent, resetShareIntent, openShare]);

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
				return;
			}

			// The Bookmarks widget's header opens its column, which the widget only ever takes from the regular library.
			const columnId = parseColumnRoute(url);
			if (columnId === undefined) {
				return;
			}

			setView('regular');
			setOpen(false);
			requestJump({screen: 'bookmarks', columnId});
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
			<ReaderHost />
			<ImportSheet
				key={`import-${fileKey}`}
				source={sharedFile?.kind === 'import' ? sharedFile.source : undefined}
				onClose={closeSharedFile}
			/>
			<RestoreSheet
				key={`backup-${fileKey}`}
				source={sharedFile?.kind === 'backup' ? sharedFile.source : undefined}
				onClose={closeSharedFile}
			/>
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
