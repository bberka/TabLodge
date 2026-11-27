import {ShareIntentProvider, useShareIntentContext} from 'expo-share-intent';
import {File, Paths} from 'expo-file-system';
import {StatusBar} from 'expo-status-bar';
import {useCallback, useEffect, useRef, useState} from 'react';
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
import {
	editIn,
	pauseSync,
	startLibrary,
	wakeSync,
} from './src/library/library-store';
import {undoQuote} from './src/library/quote-edits';
import {purgeTrash} from './src/library/trash-store';
import {startPreferencesSync} from './src/settings/preferences-sync';
import {markActive, startPrivateAutoLock} from './src/private/private-autolock';
import {
	ImportHost,
	ImportSheet,
	type ImportSource,
	openImport,
} from './src/screens/transfer/import-sheet';
import {ShareHost} from './src/screens/transfer/transfer-sheets';
import {OpenInHost} from './src/screens/open-in';
import {SharedPagesHost} from './src/screens/settings/shared-pages-settings';
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
import {type SavedQuote, SaveQuoteForm} from './src/screens/save/save-quote';
import {SessionsScreen} from './src/screens/sessions/sessions';
import {SettingsScreen} from './src/screens/settings/settings';
import {PrivateSheetHost} from './src/private/private-sheets';
import {SnackbarHost, showSnack} from './src/ui/snackbar';
import {type BarTab, TabBar} from './src/ui/tab-bar';
import {useColors} from './src/ui/theme';
import {setView} from './src/library/view';
import {requestSearch} from './src/ui/search-action';
import {
	parseColumnRoute,
	parseImportRoute,
	parseTileRoute,
	type TileRoute,
} from './src/platform/app-route';
import {startWidgetSnapshot} from './src/library/widget-sync';
import {startBackgroundSync} from './src/library/background-sync';
import {startPageCopies} from './src/library/page-copies';
import {ReaderHost} from './src/screens/copy/reader';
import {ImageViewerHost} from './src/screens/image/viewer';
import {startSavedImages} from './src/library/saved-images';
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

const BOOT = Date.now();
const COLD_MS = 6000;

type Draft = {
	key: number;
	text: string;
	title: string;
	urls: string[];
	many: boolean;
	quick: boolean;
	quote?: string;
	asQuote?: boolean;
};

function Main() {
	const colors = useColors();
	const {hasShareIntent, shareIntent, resetShareIntent} =
		useShareIntentContext();
	const [tab, setTab] = useState<Tab>('bookmarks');
	const openSettings = useCallback(() => {
		setTab('settings');
	}, []);
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
	const [sharedFile, setSharedFile] = useState<
		| {kind: 'import'; source: ImportSource}
		| {kind: 'backup'; source: RestoreSource}
	>();
	const [fileKey, setFileKey] = useState(0);
	const closeSharedFile = useCallback(() => {
		setSharedFile(undefined);
	}, []);
	const jump = usePendingJump();
	useEffect(() => {
		if (jump) {
			setTab(jump.screen);
		}
	}, [jump]);
	const [connecting, setConnecting] = useState(false);
	const connect = useCallback(() => {
		setConnecting(true);
	}, []);

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
			.then(startBackgroundSync)
			.then(startPrivate)
			.then(purgeTrash)
			.then(startPreferencesSync);
		const subscription = AppState.addEventListener('change', (state) => {
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
		void startSavedImages().catch(() => undefined);
	}, []);

	useEffect(() => startPrivateAutoLock(), []);

	const openingRef = useRef(0);
	const openShare = useCallback(
		async (outcome: ShareOutcome, quick: boolean) => {
			const opening = ++openingRef.current;
			setSharedFile(undefined);
			openImport(undefined);
			if (outcome.kind === 'refused') {
				if (quick) {
					ToastAndroid.show(FILE_REFUSED, ToastAndroid.LONG);
					BackHandler.exitApp();
				} else {
					showSnack(FILE_REFUSED);
				}

				return;
			}

			if (outcome.kind === 'link' || outcome.kind === 'quote') {
				setDraft((current) =>
					outcome.kind === 'link'
						? {
								key: current.key + 1,
								text: outcome.text,
								title: outcome.title,
								urls: outcome.urls,
								many: false,
								quick,
								...(outcome.quote && {quote: outcome.quote}),
							}
						: {
								key: current.key + 1,
								text: outcome.url ?? '',
								title: '',
								urls: [],
								many: false,
								quick,
								quote: outcome.quote,
								asQuote: true,
							},
				);
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
					if (opening !== openingRef.current) {
						return;
					}

					setFileKey((key) => key + 1);
					setSharedFile({
						kind: 'import',
						source: {mode: 'file', name: outcome.name, text},
					});
				} else {
					const bytes = await readSharedBytes(outcome.path, outcome.size);
					if (opening !== openingRef.current) {
						return;
					}

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
				} catch {}
			}
		});
	}, [hasShareIntent, shareIntent, resetShareIntent, openShare]);

	const openTile = useCallback(async (route: TileRoute) => {
		setView('regular');
		setTab('bookmarks');
		if (route === 'search') {
			setOpen(false);
			requestSearch();
			return;
		}

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

			const page = parseImportRoute(url);
			if (page) {
				openingRef.current += 1;
				setOpen(false);
				setSharedFile(undefined);
				openImport({mode: 'link', url: page});
				return;
			}

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

	const finishQuote = (saved?: SavedQuote) => {
		setOpen(false);
		if (saved) {
			const message = `Quote saved to ${saved.placed}`;
			if (Platform.OS === 'android' && draft.quick) {
				ToastAndroid.show(message, ToastAndroid.SHORT);
			} else {
				showSnack(message, {
					label: 'Undo',
					run() {
						let removed = false;
						void editIn(saved.library, (current) => {
							const next = undoQuote(current, saved.undo, Date.now());
							removed = next !== current;
							return next;
						}).then(() => {
							showSnack(
								removed
									? 'Quote removed'
									: 'The note changed since, so the quote stays',
							);
						});
					},
				});
			}
		}

		if (draft.quick) {
			setTimeout(() => {
				BackHandler.exitApp();
			}, 250);
		}
	};

	const finish = (saved?: string) => {
		setOpen(false);
		if (saved) {
			if (Platform.OS === 'android' && draft.quick) {
				ToastAndroid.show(saved, ToastAndroid.SHORT);
			} else {
				showSnack(saved);
			}
		}

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
						onOpenSettings={openSettings}
					/>
				)}
				{tab === 'sessions' && (
					<SessionsScreen
						onConnect={connect}
						onAdd={openBlank}
						onSelecting={setSelecting}
						onOpenSettings={openSettings}
					/>
				)}
				{tab === 'settings' && <SettingsScreen onConnect={connect} />}
			</SafeAreaView>
			<TabBar tabs={TABS} selected={tab} hidden={selecting} onSelect={setTab} />
			<SnackbarHost />
			<DialogHost />
			<PrivateSheetHost />
			<ShareHost />
			<ImportHost />
			<SharedPagesHost />
			<OpenInHost />
			<ReaderHost />
			<ImageViewerHost />
			<ImportSheet
				key={`import-${fileKey}`}
				source={sharedFile?.kind === 'import' ? sharedFile.source : undefined}
				onClose={(finished) => {
					setSharedFile((current) =>
						finished === undefined ||
						(current?.kind === 'import' && current.source === finished)
							? undefined
							: current,
					);
				}}
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
				label={
					draft.asQuote
						? 'Save quote'
						: draft.urls.length > 1 || draft.many
							? 'Save links'
							: 'Save link'
				}
				onClose={() => {
					finish();
				}}
			>
				{draft.asQuote ? (
					<SaveQuoteForm
						key={draft.key}
						initialQuote={draft.quote ?? ''}
						initialUrl={draft.text}
						onLink={() => {
							setDraft((current) => ({
								...current,
								key: current.key + 1,
								text: current.text || current.quote || '',
								asQuote: false,
							}));
						}}
						onDone={finishQuote}
					/>
				) : draft.urls.length > 1 || draft.many ? (
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
						onQuote={
							draft.quote
								? () => {
										setDraft((current) => ({
											...current,
											key: current.key + 1,
											text: current.urls[0] ?? '',
											asQuote: true,
										}));
									}
								: undefined
						}
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
