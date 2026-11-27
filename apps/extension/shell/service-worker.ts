import {stripTrackingParameters} from '../src/shared/tracking-parameters';
import {
	parseSiteSourcesState,
	SITE_SOURCE_SCRIPT,
	SITE_SOURCES,
	SITE_SOURCES_KEY,
	siteSourceById,
	siteSourceForUrl,
	siteSourcesValue,
	siteSourceStatuses,
	siteSourceUndoLabel,
	sourceChoice,
	sourceSavingInto,
	applySyncedChoices,
	withChoice,
	withoutChoice,
	withoutNotice,
	type SiteSource,
	type SiteSourcesState,
} from '../src/app/site-sources';
import {
	catchUpAsks,
	catchUpValue,
	dismissMissing,
	missingSourceLinks,
	parseCatchUpState,
	SOURCE_CATCH_UP_KEY,
} from '../src/app/source-catch-up';
import {literalQuery} from '../src/shared/search-query';
import {
	isTrashEntry,
	TRASH_KINDS,
	trashedUrls,
	type TrashEntry,
} from '../src/shared/trash';
import {createChangeLog} from '../src/shared/state-changes';
import {diffList} from '../src/shared/library-patch';
import {
	UNDO_OFFER_MS,
	UNDO_WINDOW_MS,
	undoableEdit,
	type UndoableEdit,
} from '../src/shared/undo-policy';
import {columnForUrl, domainsField} from '../src/shared/column-sites';
import {hostIsExcluded} from '../src/shared/excluded-sites';
import {
	folderNameExists,
	folderNameProblem,
	normalizeFolderName,
} from '../src/shared/session-folders';
import {
	BACKUP_FORMAT_ID,
	BACKUP_VERSION,
	FULL_BACKUP_FORMAT_ID,
	FULL_BACKUP_VERSION,
} from '../src/shared/backup-format';
import {isAccent} from '../src/shared/accent-colors';
import {
	MISSING_ICONS_KEY,
	SITE_ICONS_KEY,
	createServerIcons,
	imageDataAddress,
	normalizeMissingIcons,
	normalizeSiteIcons,
	rememberServerAnswer,
	rememberSiteIcon,
} from '../src/shared/site-icons';
import {
	IMAGE_COLUMN_PREFIX,
	IMAGE_SAVE_PREFIX,
	LINK_COLUMN_PREFIX,
	MEDIA_COLUMN_PREFIX,
	MENU,
	PAGE_COLUMN_PREFIX,
	PAGE_SEND_PREFIX,
	PAGE_BOOKMARK_TITLE,
	PAGE_SAVE_ITEMS,
	contextMenuPlan,
	contextMenuSignature,
	menuSessions,
	hasTabMenu,
} from '../src/shared/context-menu-plan';
import {
	builtNameStyle,
	formatSessionName,
	staleSessions,
} from '../src/shared/session-rules';
import {
	ARCHIVED_FOLDER_NAME,
	DEFAULT_FOLDER,
	DEFAULT_FOLDER_ID,
	DEFAULT_SETTINGS,
	MAX_EXCLUDED_ORIGINS,
	MAX_FOLDERS,
	MAX_SESSIONS,
	MAX_TABS_PER_SESSION,
	SCHEMA_VERSION,
	SESSION_NAME_FALLBACKS,
	SESSION_NAME_STYLES,
	SESSION_TEXT_MAX,
	archivedFolderIds,
	arrayOf,
	bookmarkNotes,
	bookmarkTitleIsUrl,
	cleanText,
	colorField,
	fallbackBookmarkTitle,
	findOrAddArchivedFolder,
	folderEntriesWithArchive,
	iconField,
	isArchivedFolderName,
	isGroupColor,
	isInteger,
	isOneOf,
	makeId,
	normalizeBookmark,
	normalizeBookmarkColumn,
	normalizeBookmarkColumns,
	normalizeExcludedHost,
	normalizeExcludedOrigins,
	normalizeFolder,
	normalizeFolders,
	normalizeGroup,
	normalizeNativeGroup,
	normalizeNotes,
	normalizeSessionText,
	normalizeSettings,
	normalizeSplit,
	normalizeStore,
	normalizeTab,
	normalizeUrl,
	pairSplits,
	urlHost,
} from '../src/shared/library-normalize';
import {tagFields, withTagEdits} from '../src/shared/bookmark-tags';
import {canonicalJson, isRecord, hashText} from '../src/shared/library-values';
import {
	CAPTURE_GLOBAL,
	COPY_BUDGET,
	COPY_ERRORS,
	COPY_INDEX_KEY,
	copyLinkUrls,
	createCopyStore,
	parsePageCopy,
} from '../src/shared/page-copy';
import {
	BOOKMARK_UNFILED_ID,
	cleanColumnName,
	columnNameTaken,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
	insertNewBookmarks,
	landingColumnId,
} from '../src/shared/bookmark-rules';
import {
	findOmniboxItem,
	omniboxIndex,
	omniboxSuggestions,
} from '../src/app/omnibox';
import {togglePaletteOverlay} from '../src/app/palette-overlay';
import {showQuoteToast} from '../src/app/quote-toast';
import {toastEdges, toastMs, toastPlace} from '../src/shared/toast-prefs';
import {appendQuote, pageAddress, quoteTarget} from '../src/shared/quotes';
import {
	captureImage,
	type CapturedImage,
} from '../src/app/image-capture-inject';
import {showPageNote, takeCapturedCopy} from '../src/app/page-copy-inject';
import {defaultBookmarkColumnId} from '../src/app/default-column';
import {isSourceColumnId} from '../src/shared/source-columns';
import {
	IMAGE_BUDGET,
	IMAGE_INDEX_KEY,
	IMAGE_MAX_BYTES,
	THUMB_MAX_BYTES,
	THUMB_MAX_SIDE,
	createImageStore,
} from '../src/shared/image-store';
import {imageSaveNote, mediaSave} from '../src/shared/save-media';
import {
	bookmarkDuplicates,
	defaultTargetSession,
	duplicateError,
	sessionDuplicates,
} from '../src/shared/save-rules';
import {
	type SaveKind,
	SAVE_BADGES,
	saveOutcomeOf,
} from '../src/shared/save-feedback';
import {
	createPrivateLock,
	type Gate,
	isSealed,
	LOCK_RECORD_KEY,
	LOCK_SESSION_KEY,
	LOCKED_MESSAGE,
	parseLockRecord,
	PrivateLockError,
	readStored,
	sealValue,
	unwrapDataKey,
} from '../src/shared/private-lock';
import {
	createPrivateCodec,
	createSyncKey,
	joinSyncKey,
	parsePrivateSyncKey,
	privateSyncTarget,
	parseServerKey,
	type PrivateSyncKey,
	rewrapSyncKey,
	serverKeyText,
	PRIVATE_SYNC_ASK,
} from '../src/shared/private-sync';
import {
	createLibraryState,
	isUndoDelta,
	type LibraryScope,
	MIGRATION_KEY,
	STATE_KEY,
	type UndoDelta,
} from '../src/shared/library-state';
import {
	BOOKMARK_CHUNK_KEY_PREFIX,
	BOOKMARKS_KEY_PREFIX,
	SESSION_KEY_PREFIX,
	SESSION_PAGE_KEY_PREFIX,
} from '../src/shared/library-index';
import {
	cleanDeviceName,
	defaultBrowserDeviceName,
	DEVICE_KEY,
	deviceStamp,
} from '../src/shared/device';
import {
	createSyncClient,
	SYNC_ALARM,
	callServer,
	parseConfig,
	SYNC_ALARM_MINUTES,
	SYNC_CONFIG_KEY,
	SYNC_NUDGE_KEY,
	SYNC_OFF,
	type SyncConfig,
	SyncError,
} from '../src/shared/sync/client';
import type {SyncedSource} from '../src/shared/sync/library-records';
import {
	deleteSharedPage,
	listSharedPages,
	sharedPagesSupport,
	sharedPageUrl,
	uploadSharedPage,
} from '../src/shared/sync/shared-pages-client';
import {
	isSharedPageMode,
	SHARED_PAGE_LIVE_PASSWORD_FEATURE,
} from '../src/shared/sync/shared-pages';
import {refreshLiveSharedPages} from '../src/shared/live-shared-pages';
import {
	createInboxKeyPair,
	INBOX_ENTRY_PREFIX,
	INBOX_PRIVATE_KEY_NAME,
	INBOX_PUBLIC_KEY,
	inboxEntryKey,
	isInboxEntryKey,
	openInboxEntry,
	parseInboxKeyPair,
	parseInboxPublicKey,
	sealForInbox,
	type InboxKeyPair,
} from '../src/shared/private-inbox';
import {
	addSent,
	emptyPayload,
	MAX_SENT_LINKS,
	parseSendTargets,
	sentLinkCount,
	takeOutForPrivate,
} from '../src/shared/send-to-private';

type ActionFailure = import('../src/shared/types').ActionFailure;
type LinkPreviewData = import('../src/shared/types').LinkPreviewData;
type TabLodgeMessageType = import('../src/shared/types').TabLodgeMessageType;
type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	import('../src/shared/types').ActionResult<K>;
type Raw = import('../src/shared/library-normalize').Raw;
type RevisionedStore = import('../src/shared/types').RevisionedStore;
type RawSettings = import('../src/shared/library-normalize').RawSettings;
type Bookmark = import('../src/shared/types').Bookmark;
type BookmarkColumn = import('../src/shared/types').BookmarkColumn;
type SendToPrivateState = import('../src/shared/types').SendToPrivateState;
type BookmarkFields = import('../src/shared/types').BookmarkFields;
type DuplicateMode = import('../src/shared/types').DuplicateMode;
type EraseScope = import('../src/shared/types').EraseScope;
type PrivateSyncInfo = import('../src/shared/types').PrivateSyncInfo;
type PrivateServerInfo = import('../src/shared/types').PrivateServerInfo;
type Credential = import('../src/shared/passcode').Credential;
type SyncStatus = import('../src/shared/sync/client').SyncStatus;
type ImportOptions = import('../src/shared/types').ImportOptions;
type InsertPosition = import('../src/shared/types').InsertPosition;
type LinkEntry = import('../src/shared/types').LinkEntry;
type NativeGroup = import('../src/shared/types').NativeGroup;
type RestoreFailure = import('../src/shared/types').RestoreFailure;
type RestoreOptions = import('../src/shared/types').RestoreOptions;
type RestoreTarget = import('../src/shared/types').RestoreTarget;
type SavedTab = import('../src/shared/types').SavedTab;
type SaveScope = import('../src/shared/types').SaveScope;
type Session = import('../src/shared/types').Session;
type SessionFields = import('../src/shared/types').SessionFields;
type SessionWindowMode = import('../src/shared/types').SessionWindowMode;
type SplitInfo = import('../src/shared/types').SplitInfo;
type Settings = import('../src/shared/types').Settings;
type Store = import('../src/shared/types').Store;
type TabFields = import('../src/shared/types').TabFields;
type TabLodgeMessage = import('../src/shared/types').TabLodgeMessage;
type TitlePolicy = import('../src/shared/types').TitlePolicy;
type PrivateConfig = import('../src/shared/types').PrivateConfig;
type PrivateLockInfo = import('../src/shared/types').PrivateLockInfo;

type Result<T extends object = {}> = ({ok: true} & T) | ActionFailure;
type PopulatedWindow = chrome.windows.Window & {
	id: number;
	tabs: chrome.tabs.Tab[];
	title?: string;
};
type CaptureResult =
	| (Session & {skipped?: number; rejectedTabIds?: number[]; more?: Session[]})
	| {
			id: null;
			tabs: SavedTab[];
			skipped: number;
			rejectedTabIds?: number[];
			error?: string;
	  };
type RestoreRecordsResult = {
	opened: Array<{saved: SavedTab; tabId: number | undefined}>;
	skipped: number;
	failures: RestoreFailure[];
	windowId?: number | null;
	splits: number;
	splitsSeparated: number;
};
type BookmarkMergeResult = {
	columnsAdded: number;
	columnsReordered: boolean;
	bookmarksAdded: number;
	bookmarksSkipped: number;
	bookmarksUpdated: number;
};
type ImportInput = Raw | null | undefined;
type CallbackMenuApi = {
	removeAll(callback: () => void): unknown;
	update(
		id: string,
		properties: {checked?: boolean; enabled?: boolean},
		callback: () => void,
	): unknown;
};
type ContextMenusWithOnShown = typeof chrome.contextMenus & {
	onShown?: chrome.events.Event<
		(
			info: {contextType?: string; contexts?: string[]},
			tab?: chrome.tabs.Tab,
		) => void
	>;
	refresh?: () => void;
};

const recordId = (value: unknown) =>
	isRecord(value) && typeof value.id === 'string' ? value.id : '';
const errorMessage = (error: unknown) =>
	isRecord(error) && typeof error.message === 'string'
		? error.message
		: undefined;

const APP_NAME =
	chrome.runtime.getManifest().short_name ?? chrome.runtime.getManifest().name;
const STORAGE_KEY = STATE_KEY;
const PRIVATE_CONFIG_KEY = 'tablodge.private.config';
const PRIVATE_PREFIX = 'tablodge.private.';
const privateContext = Boolean(chrome.extension?.inIncognitoContext);
const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');
const START_WINDOW_URL = IS_FIREFOX ? 'about:blank' : 'chrome://newtab/';
const NEW_TAB_PAGE_URL = IS_FIREFOX ? undefined : 'chrome://newtab/';
const {sidebarAction} = chrome as typeof chrome & {
	sidebarAction?: {open?: () => Promise<void>};
};
const HAS_SIDE_PANEL =
	Boolean(chrome.sidePanel) || Boolean(sidebarAction?.open);
const HAS_TAB_MENU = hasTabMenu({
	listsTabContext: Boolean(chrome.contextMenus?.ContextType?.TAB),
	isFirefox: IS_FIREFOX,
	userAgent: globalThis.navigator?.userAgent ?? '',
});
let privateConfig: PrivateConfig = {
	mode: 'shared',
	configured: false,
	redirectNewTabs: true,
	accent: 'teal',
};

function isPrivateAccent(value: unknown): value is string {
	return value === 'same' || (typeof value === 'string' && isAccent(value));
}

function normalizePrivateConfig(value: unknown): PrivateConfig {
	const raw = isRecord(value) ? value : {};
	const mode =
		raw.mode === 'saved' || raw.mode === 'temporary' ? raw.mode : 'shared';
	return {
		mode,
		configured: raw.configured === true && raw.mode === mode,
		redirectNewTabs: raw.redirectNewTabs !== false,
		accent: isPrivateAccent(raw.accent) ? raw.accent : 'teal',
	};
}

const privateConfigReady = chrome.storage.local
	.get([PRIVATE_CONFIG_KEY])
	.then((saved) => {
		privateConfig = normalizePrivateConfig(saved[PRIVATE_CONFIG_KEY]);
	});

async function privateWindowIds() {
	const all = await chrome.windows.getAll();
	return all.flatMap((win) =>
		win.incognito && win.id !== undefined ? [win.id] : [],
	);
}

const privateLock = createPrivateLock({
	local: chrome.storage.local,
	session: chrome.storage.session,
	prefix: PRIVATE_PREFIX,
	reserved: [PRIVATE_CONFIG_KEY, LOCK_RECORD_KEY],
	now: () => Date.now(),
	...(privateContext && {openWindows: privateWindowIds}),
});
const ALARM_PRIVATE_LOCK = 'tablodge-private-lock';

async function lockGate(): Promise<Gate | null> {
	await privateConfigReady;
	return privateContext && privateConfig.mode === 'saved'
		? privateLock.gate()
		: null;
}

function keyFor(gate: Gate | null, prefix: string) {
	if (!gate || prefix === '') {
		return undefined;
	}

	if (!gate.key) {
		throw new PrivateLockError('locked', LOCKED_MESSAGE);
	}

	return gate.key;
}

const ownLockKey = `tablodge.lock.${privateContext ? 'private' : 'normal'}`;
const otherLockKey = `tablodge.lock.${privateContext ? 'normal' : 'private'}`;
const lockResetReady = chrome.storage.session.remove(ownLockKey);
let sharedLockUsers = 0;
let sharedLockReady: Promise<void> = Promise.resolve();
let sharedLockTail: Promise<void> = Promise.resolve();

async function otherLibraryLock() {
	const saved = await chrome.storage.session.get([otherLockKey]);
	const value: unknown = saved[otherLockKey];
	if (value === undefined) {
		return {choosing: false, ticket: 0};
	}

	if (
		!isRecord(value) ||
		typeof value.choosing !== 'boolean' ||
		typeof value.ticket !== 'number' ||
		!Number.isSafeInteger(value.ticket) ||
		value.ticket < 0
	) {
		throw new Error(
			'Storage coordination data is invalid. Reload the extension.',
		);
	}

	return {choosing: value.choosing, ticket: value.ticket};
}

async function acquireSharedLibraryLock() {
	await lockResetReady;
	await chrome.storage.session.set({[ownLockKey]: {choosing: true, ticket: 0}});
	const other = await otherLibraryLock();
	const ticket = other.ticket + 1;
	await chrome.storage.session.set({[ownLockKey]: {choosing: false, ticket}});
	const deadline = Date.now() + 15_000;
	for (;;) {
		let notify = () => {};
		// eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Promise.withResolvers needs Chrome 124; we support Chrome 116.
		const changed = new Promise<void>((resolve) => {
			notify = resolve;
		});
		const listener = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'session' && Object.hasOwn(changes, otherLockKey)) {
				notify();
			}
		};

		chrome.storage.onChanged.addListener(listener);
		const timer = setTimeout(notify, Math.max(0, deadline - Date.now()));
		try {
			const current = await otherLibraryLock();
			const waiting =
				current.choosing ||
				(current.ticket > 0 &&
					(current.ticket < ticket ||
						(current.ticket === ticket && privateContext)));
			if (!waiting) {
				return;
			}

			if (Date.now() >= deadline) {
				throw new Error(
					'Storage is busy. Try again when the save finishes. If a private window closed during a save, reopen one first.',
				);
			}

			await changed;
		} finally {
			clearTimeout(timer);
			chrome.storage.onChanged.removeListener(listener);
		}
	}
}

async function withSharedLibraryLock<T>(
	operation: () => Promise<T>,
): Promise<T> {
	await privateConfigReady;
	if (privateContext && privateConfig.mode !== 'shared') {
		return operation();
	}

	if (sharedLockUsers++ === 0) {
		sharedLockReady = sharedLockTail.then(acquireSharedLibraryLock);
	}

	const ready = sharedLockReady;

	try {
		await ready;
		return await operation();
	} finally {
		if (--sharedLockUsers === 0) {
			const release = async () => chrome.storage.session.remove(ownLockKey);
			const released = ready.then(release, release);
			sharedLockTail = released.catch(() => undefined);
			await released;
		}
	}
}

function libraryStorage() {
	const separate = privateContext && privateConfig.mode !== 'shared';
	return {
		area:
			separate && privateConfig.mode === 'temporary'
				? chrome.storage.session
				: chrome.storage.local,
		prefix: separate ? PRIVATE_PREFIX : '',
	};
}

function storageParts(keys: string[]) {
	const scope = libraryStorage();
	if (!scope.prefix) {
		return [{...scope, keys}];
	}

	const appearance: string[] = keys.filter(
		(key) => key === 'uiTheme' || key === 'uiAccent',
	);
	const data = keys.filter((key) => !appearance.includes(key));
	return [
		{...scope, keys: data},
		{area: chrome.storage.local, prefix: '', keys: appearance},
	].filter((part) => part.keys.length > 0);
}

const rawLibrary = {
	async get<T = Record<string, unknown>>(keys: string[]): Promise<T> {
		await privateConfigReady;
		const gate = await lockGate();
		const entries = await Promise.all(
			storageParts(keys).map(async ({area, prefix, keys: part}) => {
				const key = keyFor(gate, prefix);
				const saved = await area.get(part.map((name) => prefix + name));
				return Promise.all(
					Object.entries(saved).map(async ([stored, value]) => {
						const name = stored.slice(prefix.length);
						return [name, key ? await readStored(key, name, value) : value];
					}),
				);
			}),
		);
		return Object.fromEntries(entries.flat()) as T;
	},
	async set(values: Record<string, unknown>) {
		await privateConfigReady;
		const gate = await lockGate();
		for (const {area, prefix, keys} of storageParts(Object.keys(values))) {
			const key = keyFor(gate, prefix);
			const seal = key && gate?.state !== 'decrypting' ? key : undefined;
			const entries = await Promise.all(
				keys.map(async (name): Promise<[string, unknown]> => [
					prefix + name,
					seal ? await sealValue(seal, name, values[name]) : values[name],
				]),
			);
			await area.set(Object.fromEntries(entries));
		}
	},
	async remove(keys: string | string[]) {
		await privateConfigReady;
		const gate = await lockGate();
		for (const {area, prefix, keys: part} of storageParts([keys].flat())) {
			keyFor(gate, prefix);
			await area.remove(part.map((key) => prefix + key));
		}
	},
	async getBytesInUse(keys: string[]) {
		await privateConfigReady;
		const gate = await lockGate();
		const sizes = await Promise.all(
			storageParts(keys).map(async ({area, prefix, keys: part}) => {
				keyFor(gate, prefix);
				return area.getBytesInUse(part.map((key) => prefix + key));
			}),
		);
		return sizes.reduce((total, size) => total + size, 0);
	},
};

const libraryState = createLibraryState({
	async get(keys) {
		return rawLibrary.get(keys);
	},
	async set(values) {
		await rawLibrary.set(values);
	},
	async remove(keys) {
		await rawLibrary.remove(keys);
	},
	async getBytesInUse(keys) {
		return rawLibrary.getBytesInUse(keys);
	},
});

const library = {
	async get<T = Record<string, unknown>>(keys: string[]): Promise<T> {
		if (!keys.includes(STORAGE_KEY)) {
			return rawLibrary.get<T>(keys);
		}

		const others = keys.filter((key) => key !== STORAGE_KEY);
		const saved: Raw = others.length > 0 ? await rawLibrary.get(others) : {};
		const state = await libraryState.read();
		if (state !== null) {
			saved[STORAGE_KEY] = state;
		}

		return saved as T;
	},
	async set(values: Record<string, unknown>) {
		const {[STORAGE_KEY]: state, ...rest} = values;
		if (Object.keys(rest).length > 0) {
			await rawLibrary.set(rest);
		}

		if (!Object.hasOwn(values, STORAGE_KEY)) {
			return;
		}

		if (!isRecord(state)) {
			throw new TypeError('The library state must be an object.');
		}

		await libraryState.write(state);
	},
	async remove(keys: string | string[]) {
		const list = [keys].flat();
		const rest = list.filter((key) => key !== STORAGE_KEY);
		if (rest.length > 0) {
			await rawLibrary.remove(rest);
		}

		if (list.includes(STORAGE_KEY)) {
			await libraryState.remove();
		}
	},
	async getBytesInUse(keys: string[]) {
		const rest = keys.filter((key) => key !== STORAGE_KEY);
		const [others, state] = await Promise.all([
			rest.length > 0 ? rawLibrary.getBytesInUse(rest) : 0,
			keys.includes(STORAGE_KEY) ? libraryState.bytesInUse() : 0,
		]);
		return others + state;
	},
};

function withoutSealedValues(change: chrome.storage.StorageChange) {
	return isSealed(change.newValue) || isSealed(change.oldValue)
		? {
				newValue: isSealed(change.newValue) ? undefined : change.newValue,
				oldValue: isSealed(change.oldValue) ? undefined : change.oldValue,
			}
		: change;
}

function onLibraryChanged(
	listener: (
		changes: Record<string, chrome.storage.StorageChange>,
		area: chrome.storage.AreaName,
	) => void,
) {
	chrome.storage?.onChanged?.addListener?.((changes, area) => {
		const scope = libraryStorage();
		const expectedArea =
			privateContext && privateConfig.mode === 'temporary'
				? 'session'
				: 'local';
		if (area !== expectedArea) {
			return;
		}

		const translated = Object.fromEntries(
			Object.entries(changes)
				.filter(([key]) =>
					scope.prefix
						? key.startsWith(scope.prefix) && key !== PRIVATE_CONFIG_KEY
						: !key.startsWith(PRIVATE_PREFIX),
				)
				.map(([key, value]) => [
					key.slice(scope.prefix.length),
					withoutSealedValues(value),
				]),
		);
		listener(translated, 'local');
	});
}

function replacePrivateConfig(next: PrivateConfig) {
	return snapshotMutate(() =>
		backupMutate(() =>
			trashMutate(() =>
				undoMutate(async () => {
					privateConfig = next;
					migrationChecked = false;
					invalidateSettings();
					stateChanges.clear();
				}),
			),
		),
	);
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local' || !Object.hasOwn(changes, PRIVATE_CONFIG_KEY)) {
		return;
	}

	const next = normalizePrivateConfig(changes[PRIVATE_CONFIG_KEY].newValue);
	const update = mutationQueue.then(async () => {
		await privateConfigReady;
		await replacePrivateConfig(next);
	});
	mutationQueue = update.catch(() => undefined);
	void update.then(wakeSync).catch(() => undefined);
});
async function privateLockInfo(): Promise<PrivateLockInfo> {
	await privateConfigReady;
	const status = await privateLock.status();
	syncPrivateLockAlarm(status);
	return {
		...status,
		available: privateConfig.mode === 'saved' && privateConfig.configured,
		manageHere: privateContext,
		needsLock:
			privateConfig.mode === 'saved' &&
			privateConfig.configured &&
			!status.enabled,
	};
}

let privateLockAlarmArmed = false;
function syncPrivateLockAlarm(status: {
	enabled: boolean;
	locked: boolean;
	idleMinutes: number;
}) {
	const wanted = status.enabled && !status.locked && status.idleMinutes > 0;
	if (wanted === privateLockAlarmArmed) {
		return;
	}

	privateLockAlarmArmed = wanted;
	if (wanted) {
		void chrome.alarms?.create?.(ALARM_PRIVATE_LOCK, {
			delayInMinutes: 1,
			periodInMinutes: 1,
		});
	} else {
		void chrome.alarms?.clear?.(ALARM_PRIVATE_LOCK);
	}
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (!(area === 'session' && Object.hasOwn(changes, LOCK_SESSION_KEY))) {
		return;
	}

	invalidateSettings();
	stateChanges.clear();
	void wakeSync().catch(() => undefined);
	if (changes[LOCK_SESSION_KEY].newValue !== undefined) {
		return;
	}

	privateLockAlarmArmed = false;
	void chrome.alarms?.clear?.(ALARM_PRIVATE_LOCK);
});

function privateLockFailure(error: unknown): ActionFailure | undefined {
	if (error instanceof PrivateLockError) {
		return {
			ok: false,
			error: error.message,
			...(error.code === 'locked' && {locked: true as const}),
		};
	}

	return undefined;
}

function resumePrivateLock() {
	return mutate(async () => {
		if (
			privateContext &&
			privateConfig.mode === 'saved' &&
			(await privateLock.resume())
		) {
			invalidateSettings();
		}
	});
}

const sessionLimitError = () =>
	`TabLodge keeps up to ${MAX_SESSIONS} sessions. Delete or merge some sessions first.`;
const sessionFullError = () =>
	`A session holds up to ${MAX_TABS_PER_SESSION} links. Use another session.`;
const chunkCount = (length: number) =>
	Math.max(1, Math.ceil(length / MAX_TABS_PER_SESSION));
const DASHBOARD_URL = chrome.runtime.getURL('newtab.html');

let mutationQueue: Promise<unknown> = Promise.resolve();

const TITLE_JUNK = /^(?:\s*(?:\(\d{1,5}\+?\)|\[\d{1,5}\+?\]|[*•●✱]))+\s+/u;

function pageTitle(
	value: unknown,
	fallback: unknown,
	clean: boolean,
	max = 500,
): string {
	const text = cleanText(value, fallback, max);
	return clean ? text.replace(TITLE_JUNK, '').trim() || text : text;
}

const browserLocale = () =>
	typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';

async function openBookmarkTitleMap(clean = true) {
	const titles = new Map<string, string>();
	try {
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			const url = normalizeUrl(tab.url);
			if (url && !titles.has(url) && !bookmarkTitleIsUrl(tab.title, url)) {
				titles.set(
					url,
					pageTitle(tab.title, fallbackBookmarkTitle(url), clean),
				);
			}
		}
	} catch {}

	return titles;
}

function importedBookmarkTitle(
	value: unknown,
	url: string,
	openTitles: Map<string, string>,
) {
	return bookmarkTitleIsUrl(value, url)
		? openTitles.get(url) || fallbackBookmarkTitle(url)
		: cleanText(value, fallbackBookmarkTitle(url), 500);
}

async function bestBookmarkTitle(value: unknown, url: string, clean = true) {
	if (!bookmarkTitleIsUrl(value, url)) {
		return pageTitle(value, fallbackBookmarkTitle(url), clean);
	}

	const openTitles = await openBookmarkTitleMap(clean);
	return importedBookmarkTitle(value, url, openTitles);
}

async function getStore(): Promise<Store> {
	const {revision: _revision, ...store} = await getRevisionedStore();
	return store;
}

async function getRevisionedStore(): Promise<RevisionedStore> {
	const {raw, stamp} = await libraryState.readStamped();
	if (raw && Number(raw.schemaVersion) > SCHEMA_VERSION) {
		throw new Error(
			`This ${APP_NAME} data was saved by a newer version. Update ${APP_NAME} before opening it here.`,
		);
	}

	return {...normalizeStore(raw), ...(stamp && {revision: stamp})};
}

const stateChanges = createChangeLog();

async function getStateChanges(
	since: string,
): Promise<ActionResult<'GET_STATE_CHANGES'>> {
	const revision = await libraryState.stamp();
	const changes = revision ? stateChanges.since(since, revision) : undefined;
	return changes ? {ok: true, changes} : {ok: true};
}

function hasOutdatedFolders(raw: Raw) {
	return (
		canonicalJson(normalizeFolders(raw.folders)) !== canonicalJson(raw.folders)
	);
}

async function openStore(
	scope: LibraryScope,
): Promise<{store: Store; save(): Promise<void>}> {
	const opened = await libraryState.openScope(scope);
	if (!opened || hasOutdatedFolders(opened.raw)) {
		const store = await getStore();
		return {
			store,
			async save() {
				await writeStore(store);
			},
		};
	}

	const store = normalizeStore(opened.raw);
	return {
		store,
		async save() {
			const next = storedForm(store);
			const written = normalizeStore(next);
			const kept = new Set(written.groups.map((group) => group.id));
			await opened.commit(next, ({from, to}) => {
				stateChanges.add({
					from,
					to,
					folders: written.folders,
					bookmarkColumns: written.bookmarkColumns,
					settings: written.settings,
					updatedAt: written.updatedAt,
					sessions: {
						changed: written.groups,
						removed: (scope.sessions ?? []).filter((id) => !kept.has(id)),
					},
					bookmarks:
						scope.bookmarks === 'all'
							? {
									patch: diffList(
										written.bookmarks,
										arrayOf(opened.raw.bookmarks),
									),
								}
							: {changed: written.bookmarks},
				});
			});
			await afterLibraryWrite();
		},
	};
}

let migrationChecked = false;
let migrationRetryAt = 0;
const MIGRATION_RETRY_MS = 300_000;
async function migrateStoreOnce() {
	if (migrationChecked || Date.now() < migrationRetryAt) {
		return;
	}

	try {
		const meta = await libraryState.readMeta();
		if (meta.schemaVersion > SCHEMA_VERSION) {
			return;
		}

		if (meta.layout === 'legacy') {
			const started = (await rawLibrary.get([MIGRATION_KEY]))[MIGRATION_KEY];
			if (started === undefined) {
				await safetyBackup(
					await getStore(),
					'Before upgrading how the library is stored',
				);
			}

			await libraryState.migrate((raw) => normalizeStore(raw));
			invalidateSettings();
		}

		if (meta.upgradable) {
			const started = (await rawLibrary.get([MIGRATION_KEY]))[MIGRATION_KEY];
			if (started === undefined) {
				const saved = await safetyBackup(
					await getStore(),
					'Before upgrading how the library is stored',
				);
				if (!saved) {
					throw new Error(
						'The safety backup before the upgrade could not be saved.',
					);
				}
			}

			await libraryState.upgrade();
			invalidateSettings();
		}

		migrationChecked = true;
	} catch (error) {
		migrationRetryAt = Date.now() + MIGRATION_RETRY_MS;
		console.warn(
			'TabLodge could not upgrade how the library is stored yet.',
			error,
		);
	}
}

function storedForm(store: Store) {
	for (const group of store.groups) {
		pairSplits(group.tabs);
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		groups: store.groups,
		folders: normalizeFolders(store.folders),
		bookmarkColumns: normalizeBookmarkColumns(store.bookmarkColumns),
		bookmarks: store.bookmarks,
		settings: normalizeSettings(store.settings),
		updatedAt: Date.now(),
	};
}

async function writeStore(store: Store): Promise<Store> {
	const next = storedForm(store);
	await library.set({[STORAGE_KEY]: next});
	await afterLibraryWrite();
	return next;
}

async function afterLibraryWrite() {
	invalidateSettings();
	await nudgeSync();
}

async function nudgeSync(): Promise<void> {
	(syncClient ?? privateSync)?.localChanged();
	if (privateContext && privateConfig.mode === 'shared') {
		await chrome.storage.local.set({[SYNC_NUDGE_KEY]: Date.now()});
	}
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
	const run = async () => {
		await privateConfigReady;
		if (privateContext && !privateConfig.configured) {
			throw new Error(
				'Open the private dashboard to configure private storage first.',
			);
		}

		await migrateStoreOnce();
		return operation();
	};

	const locked = () => withSharedLibraryLock(run);
	const result = mutationQueue.then(locked, locked);
	mutationQueue = result.catch(() => undefined);
	return result;
}

const OUTSIDE_SETTING_DEFAULTS = {
	uiTheme: 'system',
	uiAccent: 'default',
	privateAccent: 'teal',
} as const;

const syncClient = privateContext
	? undefined
	: createSyncClient({
			get: async (key) => (await chrome.storage.local.get([key]))[key],
			set: (key, value) => chrome.storage.local.set({[key]: value}),
			remove: (keys) => chrome.storage.local.remove(keys),
			fetch: (url, init) => fetch(url, init),
			openSocket:
				typeof WebSocket === 'function'
					? (url) => new WebSocket(url)
					: undefined,
			mutate,
			readLibrary: getStore,
			trash: {read: readSyncTrash, apply: applySyncTrash},
			sources: {read: readSyncSources, apply: applySyncSources},
			thumbs: {
				read: async () => savedImages.synced(),
				apply: async (put, remove) => savedImages.applySynced(put, remove),
			},
			outsideSettings: {
				defaults: OUTSIDE_SETTING_DEFAULTS,
				read: readOutsideSettings,
				apply: applyOutsideSettings,
			},
			async writeLibrary(store) {
				const before = (await getStore()).settings;
				const next = normalizeStore(store);
				await writeStore(next);
				await applySettingsChange(before, next);
			},
			async backup(store, reason) {
				await safetyBackup(store, reason);
			},
			async onSynced(target, server) {
				if (server?.features.includes(SHARED_PAGE_LIVE_PASSWORD_FEATURE)) {
					await refreshLiveSharedPages(
						fetch,
						target,
						await getStore(),
						APP_NAME,
						livePageFingerprints,
					);
				}
			},
			randomId: makeId,
			now: Date.now,
		});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== 'local') {
		return;
	}

	if (
		[
			SYNC_NUDGE_KEY,
			UI_THEME_KEY,
			UI_ACCENT_KEY,
			PRIVATE_CONFIG_KEY,
			IMAGE_INDEX_KEY,
		].some((key) => Object.hasOwn(changes, key))
	) {
		syncClient?.localChanged();
	}

	if (!(privateContext && Object.hasOwn(changes, SYNC_CONFIG_KEY))) {
		return;
	}

	privateSync?.stop();
	privateSync = undefined;
	const before = parseConfig(changes[SYNC_CONFIG_KEY].oldValue);
	const after = parseConfig(changes[SYNC_CONFIG_KEY].newValue);
	const ended =
		before !== undefined &&
		(before.url !== after?.url || before.token !== after?.token);
	void (
		ended
			? chrome.storage.local.remove([
					PRIVATE_PREFIX + PRIVATE_SYNC_KEY_KEY,
					PRIVATE_PREFIX + PRIVATE_SYNC_ON_KEY,
				])
			: Promise.resolve()
	)
		.then(wakeSync)
		.catch(() => undefined);
});

const PRIVATE_SYNC_ON_KEY = 'sync.private.on';
const PRIVATE_SYNC_KEY_KEY = 'sync.private.key';
let privateSync: ReturnType<typeof createSyncClient> | undefined;

const regularSyncConfig = async () =>
	parseConfig(
		(await chrome.storage.local.get([SYNC_CONFIG_KEY]))[SYNC_CONFIG_KEY],
	);

function assertPrivateSyncStorage() {
	if (!(privateConfig.mode === 'saved' && privateConfig.configured)) {
		throw new SyncError(
			'config',
			'Private windows sync only with separate saved private storage.',
		);
	}
}

async function privateRead(name: string): Promise<unknown> {
	assertPrivateSyncStorage();
	return (await rawLibrary.get<Raw>([name]))[name];
}

async function privateWrite(values: Record<string, unknown>) {
	assertPrivateSyncStorage();
	await rawLibrary.set(values);
}

function createPrivateSyncClient() {
	return createSyncClient({
		async get(key) {
			if (key === SYNC_CONFIG_KEY) {
				const regular = await regularSyncConfig();
				return regular && (await privateRead(PRIVATE_SYNC_ON_KEY)) === true
					? privateSyncTarget(regular)
					: undefined;
			}

			return privateRead(key);
		},
		async set(key, value) {
			await privateWrite(
				key === SYNC_CONFIG_KEY
					? {[PRIVATE_SYNC_ON_KEY]: true}
					: {[key]: value},
			);
		},
		async remove(keys) {
			assertPrivateSyncStorage();
			await rawLibrary.remove(
				keys.map((key) =>
					key === SYNC_CONFIG_KEY ? PRIVATE_SYNC_ON_KEY : key,
				),
			);
		},
		fetch: (url, init) => fetch(url, init),
		openSocket:
			typeof WebSocket === 'function' ? (url) => new WebSocket(url) : undefined,
		async mutate(work) {
			return mutate(async () => {
				assertPrivateSyncStorage();
				return work();
			});
		},
		readLibrary: getStore,
		trash: {read: readSyncTrash, apply: applySyncTrash},
		async writeLibrary(store) {
			await writeStore(normalizeStore(store));
		},
		async backup(store, reason) {
			await safetyBackup(store, reason);
		},
		codec: createPrivateCodec({
			load: async () =>
				parsePrivateSyncKey(await privateRead(PRIVATE_SYNC_KEY_KEY)),
			async save(key) {
				await privateWrite({[PRIVATE_SYNC_KEY_KEY]: key});
			},
		}),
		randomId: makeId,
		now: Date.now,
	});
}

async function privateSyncAvailability(): Promise<
	PrivateSyncInfo['availability']
> {
	await privateConfigReady;
	if (!(await regularSyncConfig())) {
		return 'no-server';
	}

	if (privateConfig.mode !== 'saved') {
		return privateConfig.mode;
	}

	if (!privateConfig.configured) {
		return 'setup';
	}

	return (await privateLock.status()).locked ? 'locked' : 'ready';
}

async function refreshPrivateSync() {
	if (!privateContext) {
		return;
	}

	if ((await privateSyncAvailability()) !== 'ready') {
		privateSync?.stop();
		privateSync = undefined;
		return;
	}

	privateSync ??= createPrivateSyncClient();
}

async function privateSyncInfo(): Promise<PrivateSyncInfo> {
	const availability = await privateSyncAvailability();
	const regular = await regularSyncConfig();
	const ready = availability === 'ready';
	return {
		availability,
		server: regular?.url ?? null,
		lock: Boolean(
			parseLockRecord(
				(await chrome.storage.local.get([LOCK_RECORD_KEY]))[LOCK_RECORD_KEY],
			),
		),
		encrypted:
			ready &&
			parsePrivateSyncKey(await privateRead(PRIVATE_SYNC_KEY_KEY)) !==
				undefined,
		status: ready && privateSync ? await privateSync.status() : SYNC_OFF,
	};
}

let thisDevice = '';
async function readDeviceName() {
	const stored = (await chrome.storage.local.get([DEVICE_KEY]))[DEVICE_KEY] as
		{name?: unknown} | undefined;
	const custom = cleanDeviceName(stored?.name);
	if (custom) {
		thisDevice = custom;
		return;
	}

	try {
		const {os} = await chrome.runtime.getPlatformInfo();
		thisDevice = defaultBrowserDeviceName(globalThis.navigator?.userAgent, os);
	} catch {
		thisDevice = defaultBrowserDeviceName(globalThis.navigator?.userAgent, '');
	}
}

const deviceReady = readDeviceName();
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && changes[DEVICE_KEY] !== undefined) {
		void readDeviceName();
	}
});

async function savedHere() {
	await deviceReady.catch(() => undefined);
	return deviceStamp(thisDevice, 'desktop');
}

const PREVIEW_CACHE_SIZE = 200;
const previewCache = new Map<string, LinkPreviewData | null>();

async function linkPreview(url: string): Promise<LinkPreviewData | null> {
	if (!/^https?:\/\//i.test(url) || url.length > 2048) {
		return null;
	}

	const target = await regularSyncConfig();
	if (!target || !(await getStore()).settings.linkPreviews) {
		return null;
	}

	const hit = previewCache.get(url);
	if (hit !== undefined) {
		return hit;
	}

	let found: LinkPreviewData | null = null;
	try {
		const {status, body} = await callServer(
			fetch,
			target,
			`/v1/preview?url=${encodeURIComponent(url)}`,
		);
		if (status === 200 && isRecord(body)) {
			const text = (value: unknown) =>
				typeof value === 'string' && value ? value : undefined;
			found = {
				title: text(body.title),
				description: text(body.description),
				image: String(body.image).startsWith('data:image/')
					? text(body.image)
					: undefined,
			};
		}
	} catch {
		return null;
	}

	if (previewCache.size >= PREVIEW_CACHE_SIZE) {
		previewCache.delete(previewCache.keys().next().value!);
	}

	previewCache.set(url, found);
	return found;
}

const livePageFingerprints = new Map<string, string>();

async function handleSharedPagesMessage(
	message: Extract<
		TabLodgeMessage,
		{type: 'GET_SHARED_PAGES' | 'UPLOAD_SHARED_PAGE' | 'DELETE_SHARED_PAGE'}
	>,
): Promise<ActionResult> {
	const target = privateContext ? undefined : await regularSyncConfig();
	if (message.type === 'GET_SHARED_PAGES') {
		const support = target
			? await sharedPagesSupport(fetch, target)
			: {
					server: 'none' as const,
					keepsIds: false,
					supportsLivePassword: false,
				};
		const {defaultShareMode} = (await getStore()).settings;
		return {
			ok: true,
			server: support.server,
			linkBase:
				target && support.keepsIds ? sharedPageUrl(target.url, '') : null,
			supportsLivePassword: support.supportsLivePassword,
			defaultShareMode,
			pages:
				target && support.server === 'ready' && message.list
					? await listSharedPages(fetch, target)
					: [],
		};
	}

	if (!target) {
		return {
			ok: false,
			error: privateContext
				? 'Pages cannot be shared from a private window.'
				: 'Connect a sync server to share pages by link.',
		};
	}

	if (message.type === 'DELETE_SHARED_PAGE') {
		const id = String(message.id ?? '');
		await deleteSharedPage(fetch, target, id);
		livePageFingerprints.delete(id);
		return {ok: true};
	}

	if (typeof message.html !== 'string' || typeof message.title !== 'string') {
		return {ok: false, error: 'Nothing to upload.'};
	}

	if (message.id && message.linkBase !== sharedPageUrl(target.url, '')) {
		return {
			ok: false,
			error: 'The sync server changed while you were sharing. Share again.',
		};
	}

	const page = await uploadSharedPage(
		fetch,
		target,
		message.title,
		message.html,
		{
			id: typeof message.id === 'string' ? message.id : undefined,
			source: typeof message.source === 'string' ? message.source : undefined,
			mode: isSharedPageMode(message.mode) ? message.mode : undefined,
			password:
				typeof message.password === 'string' ? message.password : undefined,
		},
	);

	return {
		ok: true,
		page,
	};
}

async function serverField(target: SyncConfig, path: string, field: string) {
	const {body} = await callServer(fetch, target, path);
	return isRecord(body) ? body[field] : undefined;
}

const storeServerKey = async (
	target: SyncConfig,
	key: PrivateSyncKey,
	previous: string | null,
) =>
	(
		await callServer(fetch, target, '/v1/key', {
			method: 'POST',
			body: JSON.stringify({key: serverKeyText(key), previous}),
		})
	).status === 200;

const NEEDS_LOCK_MESSAGE =
	'Set a password under Private windows first. Private sync encrypts with it before anything leaves this browser.';
const DIFFERENT_SERVER_PIN_MESSAGE =
	'This library’s password is not the one protecting your sync server’s private library. Enter the server’s: it becomes this library’s too, and the server’s data merges in.';
const WRONG_SERVER_PIN_MESSAGE =
	'That is not the password protecting private data on the sync server.';
const REWRAP_UNCONFIRMED_MESSAGE =
	'The new password is set here, but the sync server did not confirm it. Change the password again once the server is reachable, so the two match.';
class RewrapUnconfirmedError extends Error {}
const REWRAP_FAILED_MESSAGE =
	'The sync server could not take the new password, so it was not changed. Check the connection and try again.';

async function enablePrivateSync(
	credential: string | undefined,
	serverCredential?: string,
): Promise<ActionResult<'PRIVATE_SYNC_ENABLE'>> {
	return rotatePassword(async () =>
		enablePrivateSyncNow(credential, serverCredential),
	);
}

async function enablePrivateSyncNow(
	credential: string | undefined,
	serverCredential?: string,
): Promise<ActionResult<'PRIVATE_SYNC_ENABLE'>> {
	const availability = await privateSyncAvailability();
	const regular = await regularSyncConfig();
	if (availability !== 'ready' || !regular) {
		return {
			ok: false,
			error:
				availability === 'locked'
					? LOCKED_MESSAGE
					: 'Private windows sync only with separate saved private storage and a sync server connected in a regular window.',
		};
	}

	const features = await serverField(regular, '/v1/status', 'features');
	if (!Array.isArray(features) || !features.includes('private')) {
		return {
			ok: false,
			error:
				'This sync server cannot hold private windows yet. Update it, then try again.',
		};
	}

	const target = privateSyncTarget(regular);
	const serverKey = parseServerKey(await serverField(target, '/v1/key', 'key'));
	const lock = parseLockRecord(
		(await chrome.storage.local.get([LOCK_RECORD_KEY]))[LOCK_RECORD_KEY],
	);
	if (!lock) {
		return {
			ok: false,
			error: NEEDS_LOCK_MESSAGE,
		};
	}

	if (!credential) {
		return {
			ok: false,
			field: 'credential',
			error: serverKey
				? 'Enter the password that protects private data on the sync server. It must be this private library’s password too.'
				: 'Enter this private library’s password, so what it syncs is encrypted.',
		};
	}

	let key: PrivateSyncKey;
	try {
		await unwrapDataKey(lock.wrapped, credential);
		if (serverKey) {
			try {
				key = await joinSyncKey(serverKey, credential);
			} catch (error) {
				if (
					!(error instanceof PrivateLockError) ||
					error.code !== 'wrong-credential'
				) {
					throw error;
				}

				if (!serverCredential) {
					return {
						ok: false,
						field: 'serverCredential',
						error: DIFFERENT_SERVER_PIN_MESSAGE,
					};
				}

				try {
					key = await joinSyncKey(serverKey, serverCredential);
				} catch (serverError) {
					if (
						serverError instanceof PrivateLockError &&
						serverError.code === 'wrong-credential'
					) {
						return {
							ok: false,
							field: 'serverCredential',
							error: WRONG_SERVER_PIN_MESSAGE,
						};
					}

					throw serverError;
				}

				await mutate(async () => {
					await privateLock.changeCredential(credential, {
						value: serverCredential,
						verified: true,
					});
				});
			}
		} else {
			key = await createSyncKey({value: credential, verified: true});
			if (!(await storeServerKey(target, key, null))) {
				return {
					ok: false,
					error:
						'Another browser protected private sync at the same moment. Try again.',
				};
			}
		}
	} catch (error) {
		if (
			error instanceof PrivateLockError &&
			error.code === 'wrong-credential'
		) {
			return {
				ok: false,
				field: 'credential',
				error: 'That is not this private library’s password.',
			};
		}

		throw error;
	}

	await mutate(async () => privateWrite({[PRIVATE_SYNC_KEY_KEY]: key}));
	privateSync ??= createPrivateSyncClient();
	await privateSync.connect(target.url, target.token);
	await wakeSync();
	return {ok: true, privateSync: await privateSyncInfo()};
}

async function privateServerInfo(): Promise<PrivateServerInfo> {
	const regular = await regularSyncConfig();
	if (!regular) {
		return {connected: false, hasKey: false};
	}

	try {
		const features = await serverField(regular, '/v1/status', 'features');
		if (!Array.isArray(features) || !features.includes('private')) {
			return {connected: true, hasKey: false};
		}

		const key = parseServerKey(
			await serverField(privateSyncTarget(regular), '/v1/key', 'key'),
		);
		return {connected: true, hasKey: key !== undefined};
	} catch {
		return {connected: true, hasKey: false};
	}
}

async function joinPrivateServer(
	credential: string,
): Promise<ActionResult<'JOIN_PRIVATE_SERVER'>> {
	await privateConfigReady;
	if (!privateContext) {
		return {
			ok: false,
			error: 'Open Settings in a private window to set the lock.',
		};
	}

	if (privateConfig.mode !== 'saved' || !privateConfig.configured) {
		return {ok: false, error: 'This private library already has a lock.'};
	}

	const existing = parseLockRecord(
		(await chrome.storage.local.get([LOCK_RECORD_KEY]))[LOCK_RECORD_KEY],
	);
	if (existing) {
		const resumes = await unwrapDataKey(existing.wrapped, credential).then(
			() => true,
			() => false,
		);
		if (!resumes) {
			return {ok: false, error: 'This private library already has a lock.'};
		}
	}

	const regular = await regularSyncConfig();
	const serverKey = regular
		? parseServerKey(
				await serverField(privateSyncTarget(regular), '/v1/key', 'key'),
			)
		: undefined;
	if (!serverKey) {
		return {
			ok: false,
			error: 'The sync server has no private library to join.',
		};
	}

	try {
		await joinSyncKey(serverKey, credential);
	} catch (error) {
		if (
			error instanceof PrivateLockError &&
			error.code === 'wrong-credential'
		) {
			return {
				ok: false,
				field: 'credential',
				error:
					'That is not the password protecting private data on the sync server.',
			};
		}

		throw error;
	}

	if (!existing) {
		await mutate(async () => {
			await privateLock.enable({value: credential, verified: true});
		});
		invalidateSettings();
	}

	const enabled = await enablePrivateSync(credential);
	if (!enabled.ok) {
		return enabled;
	}

	await receiveSentLinks().catch(() => undefined);
	return {ok: true, ...(await privateLockInfo())};
}

async function protectPrivateSync(credential: Credential) {
	const regular = await regularSyncConfig();
	if (!privateSync?.enabled || !regular) {
		return;
	}

	const target = privateSyncTarget(regular);
	if (
		parsePrivateSyncKey(await privateRead(PRIVATE_SYNC_KEY_KEY)) ||
		parseServerKey(await serverField(target, '/v1/key', 'key'))
	) {
		return;
	}

	const key = await createSyncKey(credential);
	if (!(await storeServerKey(target, key, null))) {
		return;
	}

	await mutate(async () => privateWrite({[PRIVATE_SYNC_KEY_KEY]: key}));
	await privateSync.resendAll();
}

async function rewrapPrivateSyncKey(credential: Credential) {
	const regular = await regularSyncConfig();
	const key = parsePrivateSyncKey(await privateRead(PRIVATE_SYNC_KEY_KEY));
	if (!regular || !key || (await privateRead(PRIVATE_SYNC_ON_KEY)) !== true) {
		return;
	}

	const target = privateSyncTarget(regular);
	const server = parseServerKey(await serverField(target, '/v1/key', 'key'));
	if (server?.id !== key.id) {
		throw new Error(REWRAP_FAILED_MESSAGE);
	}

	const next = await rewrapSyncKey(key, credential);
	const committed = await storeServerKey(
		target,
		next,
		serverKeyText({...key, wrapped: server.wrapped}),
	).catch(async () => false);
	if (!committed) {
		let now: ReturnType<typeof parseServerKey>;
		try {
			now = parseServerKey(await serverField(target, '/v1/key', 'key'));
		} catch {
			throw new RewrapUnconfirmedError(REWRAP_UNCONFIRMED_MESSAGE);
		}

		if (now?.id !== next.id || now.wrapped !== next.wrapped) {
			throw new Error(REWRAP_FAILED_MESSAGE);
		}
	}

	await mutate(async () => privateWrite({[PRIVATE_SYNC_KEY_KEY]: next})).catch(
		() => undefined,
	);
}

let rotating: Promise<unknown> = Promise.resolve();
async function rotatePassword<T>(work: () => Promise<T>): Promise<T> {
	const run = rotating.then(work, work);
	rotating = run.catch(() => undefined);
	return run;
}

async function openPrivateSync(): Promise<ActionResult<'OPEN_PRIVATE_SYNC'>> {
	if (privateContext) {
		return {ok: false, error: 'This is already a private window.'};
	}

	try {
		await chrome.windows.create({
			url: chrome.runtime.getURL(
				`options.html?${PRIVATE_SYNC_ASK}#settings-sync`,
			),
			incognito: true,
		});
		return {ok: true};
	} catch {
		return {
			ok: false,
			error: `Allow ${APP_NAME} in private windows on the extensions page (Allow in Incognito), then try again.`,
		};
	}
}

async function wakeSync() {
	if (privateContext) {
		await refreshPrivateSync();
	}

	const client = syncClient ?? privateSync;
	await (client?.enabled
		? chrome.alarms?.create?.(SYNC_ALARM, {periodInMinutes: SYNC_ALARM_MINUTES})
		: chrome.alarms?.clear?.(SYNC_ALARM));
	await client?.wake();
}

async function currentWindowId(
	senderTab?: chrome.tabs.Tab,
): Promise<number | null | undefined> {
	if (senderTab && isInteger(senderTab.windowId)) {
		try {
			const win = await chrome.windows.get(senderTab.windowId, {
				populate: false,
			});
			if (win.type === 'normal') {
				return win.id;
			}
		} catch {}
	}

	try {
		const focused = await chrome.windows.getLastFocused({populate: false});
		if (
			focused.type === 'normal' &&
			isInteger(focused.id) &&
			Boolean(focused.incognito) === privateContext
		) {
			return focused.id;
		}
	} catch {}

	const windows = await chrome.windows.getAll({
		populate: false,
		windowTypes: ['normal'],
	});
	return (
		windows.find((win) => Boolean(win.incognito) === privateContext)?.id ?? null
	);
}

function splitViewOf(tab: chrome.tabs.Tab | undefined): number | null {
	const id = tab?.splitViewId;
	return isInteger(id) && id >= 0 ? id : null;
}

function selectionSlots(tabs: chrome.tabs.Tab[]) {
	return new Set(
		tabs.map((tab) => {
			const split = splitViewOf(tab);
			return split === null ? `tab:${tab.id}` : `split:${split}`;
		}),
	).size;
}

function isCapturable(
	tab: chrome.tabs.Tab | undefined,
	settings: Settings | null = null,
) {
	const url = normalizeUrl(tab?.url);
	if (!url) {
		return false;
	}

	if (!settings) {
		return true;
	}

	const host = urlHost(url);
	return host !== null && !hostIsExcluded(host, settings.excludedOrigins);
}

async function getWindowGroups(
	windowId: number | undefined,
): Promise<Map<number, NativeGroup>> {
	try {
		const groups = await chrome.tabGroups.query({windowId});
		return new Map(
			groups.map((group) => [
				group.id,
				{
					key: String(group.id),
					title: cleanText(group.title, '', 100),
					color: isGroupColor(group.color) ? group.color : 'grey',
					collapsed: Boolean(group.collapsed),
				},
			]),
		);
	} catch {
		return new Map();
	}
}

type CaptureEntry = {
	sourceTabId: number | undefined;
	splitViewId: number | null;
	saved: SavedTab;
};

async function captureEntriesOf(
	tabs: chrome.tabs.Tab[],
	window: PopulatedWindow,
	settings: Settings,
	timestamp: number,
): Promise<CaptureEntry[]> {
	const nativeGroups = await getWindowGroups(window.id);
	return tabs
		.filter(
			(tab) =>
				(!tab.pinned || settings.includePinnedTabs) &&
				isCapturable(tab, settings),
		)
		.map((tab, index) => ({
			sourceTabId: tab.id,
			splitViewId: splitViewOf(tab),
			saved: {
				id: makeId(),
				title: pageTitle(
					tab.title,
					normalizeUrl(tab.url),
					settings.cleanTitles,
				),
				url: normalizeUrl(tab.url),
				notes: '',
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0 && !settings.ignoreTabGroups
						? normalizeNativeGroup(
								nativeGroups.get(tab.groupId),
								String(tab.groupId),
							)
						: null,
				savedAt: timestamp,
				originalIndex: isInteger(tab.index) ? tab.index : index,
			} as SavedTab,
		}));
}

function assignSplitPairs(entries: CaptureEntry[]) {
	const splitMembers = new Map<number, CaptureEntry[]>();
	for (const entry of entries) {
		if (entry.splitViewId === null) {
			continue;
		}

		splitMembers.set(entry.splitViewId, [
			...(splitMembers.get(entry.splitViewId) || []),
			entry,
		]);
	}

	for (const members of splitMembers.values()) {
		if (members.length !== 2) {
			continue;
		}

		const pairKey = makeId();
		for (const [position, entry] of members
			.toSorted((a, b) => a.saved.originalIndex - b.saved.originalIndex)
			.entries()) {
			entry.saved.split = {
				id: pairKey,
				position: position as SplitInfo['position'],
			};
		}
	}
}

async function captureTabs(
	tabs: chrome.tabs.Tab[],
	window: PopulatedWindow,
	settings: Settings,
	store: Store,
	folderId = DEFAULT_FOLDER_ID,
	useNativeGroupTitle = false,
	requestedName = '',
	windowNumber = 0,
	saveWindowBounds = false,
): Promise<CaptureResult | null> {
	await deviceReady;
	const timestamp = Date.now();
	const captureEntries = await captureEntriesOf(
		tabs,
		window,
		settings,
		timestamp,
	);
	if (captureEntries.length === 0) {
		return null;
	}

	let skipped = 0;
	const rejectedTabIds: number[] = [];
	let titlesUpdated = false;
	let newEntries = captureEntries;
	const known = new Map<string, SavedTab>();
	const duplicates = sessionDuplicates(
		store.groups,
		undefined,
		settings.saveDuplicateHandling,
	);
	for (const existingGroup of store.groups) {
		for (const existingTab of existingGroup.tabs) {
			if (!known.has(existingTab.url)) {
				known.set(existingTab.url, existingTab);
			}
		}
	}

	const applyLatestTitle = (url: string, title: string) => {
		for (const existingGroup of store.groups) {
			for (const existingTab of existingGroup.tabs) {
				if (existingTab.url !== url || existingTab.title === title) {
					continue;
				}

				existingTab.title = title;
				titlesUpdated = true;
			}
		}
	};

	newEntries = [];
	for (const entry of captureEntries) {
		const existing = known.get(entry.saved.url);
		if (!existing) {
			known.set(entry.saved.url, entry.saved);
			newEntries.push(entry);
			continue;
		}

		if (duplicates.isDuplicate(entry.saved.url)) {
			skipped += 1;
			if (isInteger(entry.sourceTabId)) {
				rejectedTabIds.push(entry.sourceTabId);
			}

			if (settings.saveDuplicateTitle === 'latest') {
				applyLatestTitle(entry.saved.url, entry.saved.title);
			}

			continue;
		}

		entry.saved.notes = existing.notes || '';
		if (settings.saveDuplicateTitle === 'latest') {
			applyLatestTitle(entry.saved.url, entry.saved.title);
		} else {
			entry.saved.title = existing.title;
		}

		newEntries.push(entry);
	}

	assignSplitPairs(newEntries);

	const captured = pairSplits(newEntries.map(({saved}) => saved));

	const parts = chunkCount(captured.length);
	if (captured.length > 0 && store.groups.length + parts > MAX_SESSIONS) {
		return {
			id: null,
			tabs: [],
			skipped,
			rejectedTabIds,
			error: sessionLimitError(),
		};
	}

	const group: CaptureResult =
		captured.length > 0
			? {
					id: makeId(),
					name: cleanText(
						requestedName ||
							(useNativeGroupTitle
								? captured.find((tab) => tab.nativeGroup?.title)?.nativeGroup
										?.title
								: '') ||
							formatSessionName({
								style: builtNameStyle(settings),
								template: settings.sessionNameTemplate,
								title: captured[0].title,
								url: captured[0].url,
								count: captured.length,
								windowNumber,
								now: new Date(timestamp),
								locale: browserLocale(),
							}),
						'Saved session',
						120,
					),
					folderId: store.folders.some((folder) => folder.id === folderId)
						? folderId
						: DEFAULT_FOLDER_ID,
					description: '',
					createdAt: timestamp,
					updatedAt: timestamp,
					sourceWindowName: cleanText(window.title, '', 180),
					sourceWindowId: window.id,
					...deviceStamp(thisDevice, 'desktop'),
					...(saveWindowBounds &&
						Number.isFinite(window.left) &&
						Number.isFinite(window.top) &&
						Number.isFinite(window.width) &&
						Number.isFinite(window.height) && {
							windowBounds: {
								left: window.left!,
								top: window.top!,
								width: window.width!,
								height: window.height!,
							},
						}),
					tabs: captured,
				}
			: {id: null, tabs: [], skipped, rejectedTabIds};
	if (captured.length > 0) {
		const first = group as Session;
		if (parts > 1) {
			const baseName = first.name.slice(0, 100);
			const sessions = Array.from({length: parts}, (_, part) => ({
				...structuredClone({...first, tabs: []}),
				id: part === 0 ? first.id : makeId(),
				name: `${baseName} (${part + 1}/${parts})`,
				tabs: pairSplits(
					captured.slice(
						part * MAX_TABS_PER_SESSION,
						(part + 1) * MAX_TABS_PER_SESSION,
					),
				),
			}));
			first.name = sessions[0].name;
			first.tabs = sessions[0].tabs;
			(group as CaptureResult & {more?: Session[]}).more = sessions.slice(1);
			store.groups.unshift(...sessions);
		} else {
			store.groups.unshift(first);
		}
	}

	group.skipped = skipped;
	group.rejectedTabIds = rejectedTabIds;
	if (captured.length > 0 || titlesUpdated) {
		await writeStore(store);
	}

	const closeCandidates = new Map(
		newEntries
			.filter(
				({sourceTabId, saved}) =>
					isInteger(sourceTabId) &&
					(!saved.pinned || settings.includePinnedTabs),
			)
			.map(
				({sourceTabId, saved}) =>
					[sourceTabId, {url: saved.url, pinned: saved.pinned}] as const,
			),
	);

	if (
		captured.length > 0 &&
		settings.openDashboardAfterSave &&
		window.id === (await currentWindowId())
	) {
		await openDashboard(
			window.id,
			`?group=${encodeURIComponent(group.id!)}`,
			settings.dashboardBehavior,
		);
	}

	if (settings.closeOnSave && closeCandidates.size > 0) {
		const remaining = await chrome.tabs.query({windowId: window.id});
		const closeIds = remaining
			.filter((tab) => {
				const saved = closeCandidates.get(tab.id);
				return Boolean(
					saved &&
					normalizeUrl(tab.url) === saved.url &&
					Boolean(tab.pinned) === saved.pinned &&
					(!tab.pinned || settings.includePinnedTabs),
				);
			})
			.map((tab) => tab.id);
		const remainingIds = remaining.filter((tab) => !closeIds.includes(tab.id));
		if (
			closeIds.length > 0 &&
			remainingIds.length === 0 &&
			!(await closeEmptiedWindow(window.id, settings))
		) {
			const isFocusedWindow = window.id === (await currentWindowId());
			const useDashboard =
				captured.length > 0 &&
				settings.openDashboardAfterSave &&
				isFocusedWindow;
			await chrome.tabs.create({
				windowId: window.id,
				url: useDashboard
					? `${DASHBOARD_URL}?group=${encodeURIComponent(group.id!)}`
					: NEW_TAB_PAGE_URL,
				active: useDashboard,
			});
		}

		if (closeIds.length > 0) {
			try {
				await chrome.tabs.remove(closeIds as number[]);
			} catch {}
		}
	}

	return group;
}

async function closeEmptiedWindow(
	windowId: number | null | undefined,
	settings: Settings,
): Promise<boolean> {
	if (settings.emptyWindowAfterSave !== 'close-extra' || !isInteger(windowId)) {
		return false;
	}

	try {
		const current = await chrome.windows.get(windowId, {populate: false});
		const others = (
			await chrome.windows.getAll({populate: false, windowTypes: ['normal']})
		).filter(
			(other) =>
				other.id !== windowId &&
				Boolean(other.incognito) === Boolean(current.incognito),
		);
		if (others.length === 0) {
			return false;
		}

		const lastFocused = await chrome.windows
			.getLastFocused({populate: false})
			.catch(() => undefined);
		const target =
			others.find((other) => other.id === lastFocused?.id) ?? others[0];
		await chrome.windows.update(target.id!, {focused: true});
		await chrome.windows.remove(windowId);
		return true;
	} catch {
		return false;
	}
}

async function saveTabs(
	scope: SaveScope,
	senderTab?: chrome.tabs.Tab,
	requestedFolderId: string = DEFAULT_FOLDER_ID,
	options: {
		tabIds?: number[];
		groupName?: string;
		includePinned?: boolean;
		allowDuplicates?: boolean;
		promptName?: boolean;
		keepTabsOpen?: boolean;
	} = {},
): Promise<ActionResult<'SAVE_TABS'>> {
	return mutate(async () => {
		const store = await getStore();
		const windowId = await currentWindowId(senderTab);
		if (!isInteger(windowId)) {
			return {ok: false, error: 'Open a browser window before saving tabs.'};
		}

		const selectedWindow = await chrome.windows.get(windowId, {
			populate: false,
		});
		const captureSettings = {
			...store.settings,
			...(options.includePinned === true && {includePinnedTabs: true}),
			...(options.allowDuplicates === true && {
				saveDuplicateHandling: 'allow' as const,
			}),
			...(options.keepTabsOpen === true && {
				closeOnSave: false,
				openDashboardAfterSave: false,
			}),
		};
		let windows: PopulatedWindow[];
		if (scope === 'all-windows') {
			windows = (
				await chrome.windows.getAll({
					populate: true,
					windowTypes: ['normal'],
				})
			).filter(
				(win) => Boolean(win.incognito) === privateContext,
			) as PopulatedWindow[];
		} else {
			windows = [
				(await chrome.windows.get(windowId, {
					populate: true,
				})) as PopulatedWindow,
			];
		}

		const savedGroups: Session[] = [];
		let skippedDuplicates = 0;
		const rejectedTabIds: number[] = [];
		let limitError = '';
		for (const [windowIndex, win] of windows.entries()) {
			const activeTab = win.tabs.find((tab) => tab.active);
			let inScope = win.tabs;
			const senderInWindow = win.tabs.find((tab) => tab.id === senderTab?.id);
			const referenceTab = senderInWindow || activeTab;
			if (scope === 'selected') {
				inScope = win.tabs.filter((tab) => tab.highlighted);
			}

			if (scope === 'selected-or-window') {
				const highlighted = win.tabs.filter((tab) => tab.highlighted);
				inScope = selectionSlots(highlighted) > 1 ? highlighted : win.tabs;
			}

			if (scope === 'current-tab') {
				inScope = activeTab ? [activeTab] : [];
			}

			if (scope === 'this-tab') {
				inScope = referenceTab ? [referenceTab] : [];
			}

			if (scope === 'except-this-tab') {
				inScope = win.tabs.filter(
					(tab) => !referenceTab || tab.id !== referenceTab.id,
				);
			}

			if (scope === 'left-of-tab') {
				inScope = win.tabs.filter(
					(tab) => referenceTab && tab.index < referenceTab.index,
				);
			}

			if (scope === 'right-of-tab') {
				inScope = win.tabs.filter(
					(tab) => referenceTab && tab.index > referenceTab.index,
				);
			}

			if (Array.isArray(options.tabIds)) {
				const requestedTabIds = new Set<number | undefined>(
					options.tabIds.filter(isInteger),
				);
				inScope = win.tabs.filter((tab) => requestedTabIds.has(tab.id));
			}

			const selectionSave =
				!Array.isArray(options.tabIds) &&
				(scope === 'selected' ||
					(scope === 'selected-or-window' && inScope !== win.tabs));
			const activeSplit = splitViewOf(activeTab);
			if (
				selectionSave &&
				store.settings.saveSplitTabs === 'focused' &&
				activeTab &&
				activeSplit !== null
			) {
				inScope = inScope.filter(
					(tab) => tab.id === activeTab.id || splitViewOf(tab) !== activeSplit,
				);
			}

			if (scope === 'tab-group') {
				const groupTab = senderInWindow || activeTab;
				inScope =
					groupTab && groupTab.groupId >= 0
						? win.tabs.filter((tab) => tab.groupId === groupTab.groupId)
						: [];
			}

			if (scope === 'current-group' && activeTab && activeTab.groupId >= 0) {
				inScope = win.tabs.filter((tab) => tab.groupId === activeTab.groupId);
			}

			const folderId = store.folders.some(
				(folder) => folder.id === requestedFolderId,
			)
				? requestedFolderId
				: DEFAULT_FOLDER_ID;
			const group = await captureTabs(
				inScope,
				win,
				captureSettings,
				store,
				folderId,
				scope === 'current-group' &&
					Boolean(activeTab && activeTab.groupId >= 0),
				options.groupName && scope === 'all-windows' && windows.length > 1
					? `${cleanText(options.groupName, '', 100)} (${windowIndex + 1}/${windows.length})`
					: options.groupName,
				scope === 'all-windows' ? windowIndex + 1 : 0,
				!Array.isArray(options.tabIds) &&
					(scope === 'window' ||
						scope === 'all-windows' ||
						(scope === 'selected-or-window' && inScope === win.tabs)),
			);
			if (group && 'error' in group && group.error) {
				limitError = group.error;
				break;
			}

			if (group?.tabs.length) {
				savedGroups.push(
					group as Session,
					...((group as Session & {more?: Session[]}).more ?? []),
				);
			}

			if (!group) {
				continue;
			}

			skippedDuplicates += group.skipped || 0;
			rejectedTabIds.push(...(group.rejectedTabIds ?? []));
		}

		if (savedGroups.length === 0 && limitError) {
			return {ok: false, error: limitError};
		}

		if (savedGroups.length === 0 && skippedDuplicates) {
			return {
				ok: true,
				count: 0,
				groups: 0,
				skipped: skippedDuplicates,
				rejectedTabIds,
				groupId: null,
			};
		}

		if (savedGroups.length === 0) {
			const message =
				scope === 'selected'
					? 'Select one or more web tabs in the tab strip first.'
					: scope === 'tab-group'
						? 'The active tab is not in a tab group.'
						: scope === 'left-of-tab'
							? 'There are no unpinned web tabs to the left of this tab.'
							: scope === 'right-of-tab'
								? 'There are no unpinned web tabs to the right of this tab.'
								: 'There are no unpinned web tabs to save.';
			return {ok: false, error: message};
		}

		if (store.settings.openDashboardAfterSave && scope === 'all-windows') {
			await openDashboard(
				selectedWindow.id,
				`?group=${encodeURIComponent(savedGroups[0].id)}`,
				store.settings.dashboardBehavior,
			);
		}

		if (
			options.promptName &&
			!options.groupName &&
			store.settings.sessionNameStyle === 'ask' &&
			!(
				scope === 'current-group' &&
				savedGroups[0].tabs.some((tab) => tab.nativeGroup?.title)
			)
		) {
			await openNamePrompt(
				savedGroups.map((group) => group.id),
				selectedWindow.id,
			);
		}

		return {
			ok: true,
			count: savedGroups.reduce((sum, group) => sum + group.tabs.length, 0),
			groups: savedGroups.length,
			skipped: skippedDuplicates,
			rejectedTabIds,
			groupId: savedGroups[0].id,
		};
	});
}

const NAME_PROMPT_WIDTH = 440;
const NAME_PROMPT_HEIGHT = 280;

async function openNamePrompt(
	groupIds: string[],
	anchorWindowId: number | undefined,
) {
	try {
		const url = `${chrome.runtime.getURL('name-session.html')}?${groupIds
			.map((id) => `groupId=${encodeURIComponent(id)}`)
			.join('&')}`;
		const options: chrome.windows.CreateData = {
			type: 'popup',
			url,
			width: NAME_PROMPT_WIDTH,
			height: NAME_PROMPT_HEIGHT,
			focused: true,
		};
		let anchor: chrome.windows.Window | null = null;
		try {
			anchor = isInteger(anchorWindowId)
				? await chrome.windows.get(anchorWindowId)
				: null;
		} catch {}

		if (
			anchor &&
			isInteger(anchor.left) &&
			isInteger(anchor.top) &&
			isInteger(anchor.width)
		) {
			options.left = Math.max(
				0,
				anchor.left + Math.round((anchor.width - NAME_PROMPT_WIDTH) / 2),
			);
			options.top = Math.max(0, anchor.top + 80);
		}

		await chrome.windows.create({...options, incognito: privateContext});
	} catch {}
}

const BOOKMARK_PROMPT_WIDTH = 440;
const BOOKMARK_PROMPT_HEIGHT = 470;

async function openBookmarkPrompt(
	commandTab?: chrome.tabs.Tab,
	prefill?: {
		title?: string;
		fromBrowser?: boolean;
		url?: string;
	},
): Promise<MenuOutcome> {
	let tab = commandTab?.url ? commandTab : undefined;
	let anchor: chrome.windows.Window | undefined;
	try {
		anchor = await chrome.windows.getLastFocused({windowTypes: ['normal']});
		if (!tab && isInteger(anchor.id)) {
			tab = (await chrome.tabs.query({active: true, windowId: anchor.id})).find(
				(candidate) => candidate.active,
			);
		}
	} catch {}

	const url = normalizeUrl(prefill?.url ?? tab?.url);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const title = cleanText(
		prefill?.title || tab?.title,
		cleanText(tab?.title, linkHost(url), 500),
		500,
	);
	const store = await getStore();
	const claimed = columnForUrl(store.bookmarkColumns, url);
	if (claimed) {
		const result = await addBookmark({title, url, columnId: claimed.id});
		return result.ok ? {ok: true} : result;
	}

	const options: chrome.windows.CreateData = {
		type: 'popup',
		url: `${chrome.runtime.getURL('add-bookmark.html')}?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${prefill?.fromBrowser ? '&source=browser' : ''}`,
		width: BOOKMARK_PROMPT_WIDTH,
		height: BOOKMARK_PROMPT_HEIGHT,
		focused: true,
	};
	if (
		anchor &&
		isInteger(anchor.left) &&
		isInteger(anchor.top) &&
		isInteger(anchor.width)
	) {
		options.left = Math.max(
			0,
			anchor.left + Math.round((anchor.width - BOOKMARK_PROMPT_WIDTH) / 2),
		);
		options.top = Math.max(0, anchor.top + 80);
	}

	await chrome.windows.create({...options, incognito: privateContext});
	return {ok: true};
}

async function openPaletteInPage(commandTab?: chrome.tabs.Tab) {
	if (
		isInteger(commandTab?.id) &&
		commandTab.url?.startsWith(chrome.runtime.getURL('newtab.html'))
	) {
		try {
			await chrome.tabs.sendMessage(commandTab.id, {type: 'toggle-finder'});
			return true;
		} catch {
			return false;
		}
	}

	if (
		!isInteger(commandTab?.id) ||
		!isInteger(commandTab?.windowId) ||
		!commandTab.url ||
		!/^https?:/i.test(commandTab.url)
	) {
		return false;
	}

	const frameUrl = chrome.runtime.getURL(
		`palette.html?overlay=1&window=${commandTab.windowId}&tab=${commandTab.id}`,
	);
	try {
		const [result] = await chrome.scripting.executeScript({
			target: {tabId: commandTab.id},
			func: togglePaletteOverlay,
			args: [frameUrl],
		});
		return result?.result === true;
	} catch {
		return false;
	}
}

const PALETTE_WIDTH = 640;
const PALETTE_HEIGHT = 520;

async function openPalette(commandTab?: chrome.tabs.Tab) {
	if (
		(await readSettings()).paletteLocation !== 'window' &&
		(await openPaletteInPage(commandTab))
	) {
		return;
	}

	const palettePrefix = chrome.runtime.getURL('palette.html');
	const open = (await chrome.tabs.query({windowType: 'popup'})).filter(
		(tab) => tab.url?.startsWith(palettePrefix) && isInteger(tab.windowId),
	);
	if (open.length > 0) {
		await Promise.all(
			open.map(async (tab) => chrome.windows.remove(tab.windowId)),
		);
		return;
	}

	let anchor: chrome.windows.Window | undefined;
	try {
		const own =
			commandTab && isInteger(commandTab.windowId)
				? await chrome.windows.get(commandTab.windowId)
				: undefined;
		anchor =
			own?.type === 'normal'
				? own
				: await chrome.windows.getLastFocused({windowTypes: ['normal']});
	} catch {}

	const params = new URLSearchParams();
	if (isInteger(anchor?.id)) {
		params.set('window', String(anchor.id));
	}

	if (isInteger(commandTab?.id)) {
		params.set('tab', String(commandTab.id));
	}

	const query = params.toString();
	const options: chrome.windows.CreateData = {
		type: 'popup',
		url: `${palettePrefix}${query ? `?${query}` : ''}`,
		width: PALETTE_WIDTH,
		height: PALETTE_HEIGHT,
		focused: true,
	};
	if (
		anchor &&
		isInteger(anchor.left) &&
		isInteger(anchor.top) &&
		isInteger(anchor.width)
	) {
		options.left = Math.max(
			0,
			anchor.left + Math.round((anchor.width - PALETTE_WIDTH) / 2),
		);
		options.top = Math.max(0, anchor.top + 80);
	}

	await chrome.windows.create({...options, incognito: privateContext});
}

async function paletteSender(
	sender: chrome.runtime.MessageSender,
): Promise<chrome.runtime.MessageSender> {
	const id = paletteAnchorWindow(sender);
	if (id === undefined) {
		return sender;
	}

	try {
		const tab = (await chrome.tabs.query({active: true, windowId: id})).find(
			(candidate) => candidate.active,
		);
		return tab ? {...sender, tab} : sender;
	} catch {
		return sender;
	}
}

function paletteAnchorWindow(
	sender: chrome.runtime.MessageSender,
): number | undefined {
	const palettePrefix = chrome.runtime.getURL('palette.html');
	if (!sender.url?.startsWith(palettePrefix)) {
		return undefined;
	}

	const id = Number(new URL(sender.url).searchParams.get('window'));
	return isInteger(id) ? id : undefined;
}

async function previewSessionName(
	request: {
		style?: unknown;
		fallback?: unknown;
		template?: unknown;
		scope?: unknown;
		tabIds?: unknown;
		links?: unknown;
	},
	senderTab?: chrome.tabs.Tab,
): Promise<ActionResult<'PREVIEW_SESSION_NAME'>> {
	const settings = await readSettings();
	if (Array.isArray(request.links)) {
		return {
			ok: true,
			asks: false,
			name: linksSessionName(settings, request.links as LinkEntry[]),
		};
	}

	const style = isOneOf(SESSION_NAME_STYLES, request.style)
		? request.style
		: settings.sessionNameStyle;
	const fallback = isOneOf(SESSION_NAME_FALLBACKS, request.fallback)
		? request.fallback
		: settings.sessionNameFallback;
	const template =
		typeof request.template === 'string'
			? request.template
			: settings.sessionNameTemplate;
	const windowId = await currentWindowId(senderTab);
	let tabs = isInteger(windowId) ? await chrome.tabs.query({windowId}) : [];
	if (Array.isArray(request.tabIds)) {
		const picked = new Set<unknown>(request.tabIds);
		tabs = tabs.filter((tab) => picked.has(tab.id));
	} else {
		switch (request.scope) {
			case 'selected': {
				tabs = tabs.filter((tab) => tab.highlighted);
				break;
			}

			case 'selected-or-window': {
				const highlighted = tabs.filter((tab) => tab.highlighted);
				tabs = selectionSlots(highlighted) > 1 ? highlighted : tabs;
				break;
			}

			case 'current-tab': {
				tabs = tabs.filter((tab) => tab.active);
				break;
			}

			default:
		}
	}

	const saveable = tabs.filter(
		(tab) =>
			(!tab.pinned || settings.includePinnedTabs) &&
			isCapturable(tab, settings),
	);
	const first = saveable[0];
	return {
		ok: true,
		asks: style === 'ask',
		name: formatSessionName({
			style: builtNameStyle({
				sessionNameStyle: style,
				sessionNameFallback: fallback,
			}),
			template,
			title: first
				? pageTitle(first.title, normalizeUrl(first.url), settings.cleanTitles)
				: 'Example page',
			url: first ? (normalizeUrl(first.url) ?? '') : 'https://example.com/',
			count: Math.max(saveable.length, 1),
			now: new Date(),
			locale: browserLocale(),
		}),
	};
}

async function openDashboard(
	windowId: number | null | undefined,
	query = '',
	behavior: Settings['dashboardBehavior'] = 'switch',
) {
	const path = `${DASHBOARD_URL}${query}`;
	const existingTabs = await chrome.tabs.query({});
	const targetWindow = isInteger(windowId)
		? await chrome.windows.get(windowId)
		: await chrome.windows.getLastFocused();
	const dashboards = existingTabs.filter(
		(tab) =>
			isLodgeTab(tab) &&
			Boolean(tab.incognito) === Boolean(targetWindow.incognito),
	);
	const pinnedHere = dashboards.find(
		(tab) => tab.pinned && tab.windowId === windowId,
	);
	let existing = pinnedHere ?? dashboards[0];
	if (existing?.id) {
		if (
			behavior === 'move' &&
			!existing.pinned &&
			isInteger(windowId) &&
			existing.windowId !== windowId
		) {
			try {
				existing = await chrome.tabs.move(existing.id, {windowId, index: -1});
			} catch {}
		}

		await chrome.tabs.update(existing.id, {url: path, active: true});
		await chrome.windows.update(existing.windowId, {focused: true});
		return existing.id;
	}

	const options: chrome.tabs.CreateProperties = {url: path, active: true};
	if (isInteger(windowId)) {
		options.windowId = windowId;
	}

	const created = await chrome.tabs.create(options);
	return created.id;
}

const LODGE_CHECK_DELAY_MS = 300;
const LODGE_FIGHT_WINDOW_MS = 5000;
const lodgeUndoneAt = new Map<number, number>();
const lodgeUserTriggered = new Set<number>();
const lodgePaused = new Set<number>();
const lodgePending = new Set<number>();
let lodgeCheckAll = false;
let lodgeTimer: ReturnType<typeof setTimeout> | undefined;

function isLodgeTab(tab: chrome.tabs.Tab | undefined) {
	return Boolean((tab?.url || tab?.pendingUrl)?.startsWith(DASHBOARD_URL));
}

async function ensureLodgePinned(windowId: number, userTriggered = false) {
	return mutate(async () => {
		if (lodgePaused.has(windowId)) {
			return;
		}

		const store = await getStore();
		if (!store.settings.keepLodgePinned) {
			return;
		}

		const win = await chrome.windows.get(windowId, {populate: false});
		if (win.type !== 'normal' || win.incognito) {
			return;
		}

		const lodges = (await chrome.tabs.query({windowId})).filter((tab) =>
			isLodgeTab(tab),
		);
		const pinned = lodges.filter((tab) => tab.pinned);
		const extras = pinned
			.slice(1)
			.map((tab) => tab.id)
			.filter(isInteger);
		if (extras.length > 0) {
			await chrome.tabs.remove(extras);
		}

		if (pinned.length > 0) {
			return;
		}

		if (userTriggered) {
			const undoneAt = lodgeUndoneAt.get(windowId);
			lodgeUndoneAt.set(windowId, Date.now());
			if (
				undoneAt !== undefined &&
				Date.now() - undoneAt < LODGE_FIGHT_WINDOW_MS
			) {
				lodgePaused.add(windowId);
				return;
			}
		}

		if (isInteger(lodges[0]?.id)) {
			await chrome.tabs.update(lodges[0].id, {pinned: true});
		} else {
			await chrome.tabs.create({
				windowId,
				url: DASHBOARD_URL,
				pinned: true,
				active: false,
			});
		}
	});
}

async function runLodgeChecks() {
	const all = lodgeCheckAll;
	const ids = new Set(lodgePending);
	const triggered = new Set(lodgeUserTriggered);
	lodgeCheckAll = false;
	lodgePending.clear();
	lodgeUserTriggered.clear();
	try {
		if (all) {
			for (const win of await chrome.windows.getAll({
				populate: false,
				windowTypes: ['normal'],
			})) {
				if (isInteger(win.id)) {
					ids.add(win.id);
				}
			}
		}

		for (const id of ids) {
			await ensureLodgePinned(id, triggered.has(id)).catch(() => undefined);
		}
	} catch {}
}

function scheduleLodgeCheck(windowId?: number, userTriggered = false) {
	if (isInteger(windowId)) {
		lodgePending.add(windowId);
		if (userTriggered) {
			lodgeUserTriggered.add(windowId);
		}
	} else {
		lodgeCheckAll = true;
	}

	clearTimeout(lodgeTimer);
	lodgeTimer = setTimeout(() => void runLodgeChecks(), LODGE_CHECK_DELAY_MS);
}

chrome.windows.onCreated?.addListener((win) => {
	if (win.type === 'normal') {
		scheduleLodgeCheck(win.id);
	}
});
chrome.windows.onFocusChanged?.addListener((windowId) => {
	if (windowId < 0) {
		return;
	}

	lodgePaused.delete(windowId);
	lodgeUndoneAt.delete(windowId);
	scheduleLodgeCheck(windowId);
});
chrome.tabs.onRemoved?.addListener((_tabId, info) => {
	if (!info.isWindowClosing) {
		scheduleLodgeCheck(info.windowId, true);
	}
});
chrome.tabs.onUpdated?.addListener((_tabId, change, tab) => {
	if (change.pinned === false && isLodgeTab(tab)) {
		scheduleLodgeCheck(tab.windowId, true);
	}
});
chrome.tabs.onAttached?.addListener((_tabId, info) => {
	scheduleLodgeCheck(info.newWindowId);
});
chrome.tabs.onDetached?.addListener((_tabId, info) => {
	scheduleLodgeCheck(info.oldWindowId);
});

function findGroup(store: Store, groupId: string) {
	return store.groups.find((group) => group.id === groupId) || null;
}

async function createRestoreWindow(bounds?: Session['windowBounds']): Promise<{
	id: number | undefined;
	bootstrapTabId: number | null;
}> {
	const properties: chrome.windows.CreateData = {
		url: START_WINDOW_URL,
		focused: true,
		type: 'normal',
		incognito: privateContext,
		...(bounds && {
			left: bounds.left,
			top: bounds.top,
			width: bounds.width,
			height: bounds.height,
		}),
	};
	let created: chrome.windows.Window | undefined;
	try {
		created = await chrome.windows.create(properties);
	} catch (error) {
		if (!bounds) {
			throw error;
		}

		created = await chrome.windows.create({
			url: START_WINDOW_URL,
			focused: true,
			type: 'normal',
			incognito: privateContext,
		});
	}

	if (!created?.id) {
		throw new Error('The browser did not return the restored window.');
	}

	const tabs = await chrome.tabs.query({windowId: created.id});
	return {id: created.id, bootstrapTabId: tabs[0]?.id ?? null};
}

async function chooseRestoreWindow(
	settings: Settings,
	senderTab: chrome.tabs.Tab | undefined,
	restoreTarget: RestoreTarget = settings.restoreTarget,
	bounds?: Session['windowBounds'],
): Promise<{id: number | undefined; bootstrapTabId: number | null}> {
	const id = await currentWindowId(senderTab);
	let needsNewWindow = restoreTarget === 'always-new-window';
	if (restoreTarget === 'new-window-unless-only-tab' && isInteger(id)) {
		const currentTabs = await chrome.tabs.query({windowId: id});
		needsNewWindow = currentTabs.length > 1;
	}

	if (!isInteger(id)) {
		needsNewWindow = true;
	}

	return needsNewWindow
		? createRestoreWindow(bounds)
		: {id: id!, bootstrapTabId: null};
}

async function splitRestoredPair(
	left: number,
	right: number,
): Promise<boolean> {
	try {
		await chrome.tabs.createSplit([left, right]);
		return true;
	} catch {}

	try {
		const [a, b] = await Promise.all([
			chrome.tabs.get(left),
			chrome.tabs.get(right),
		]);
		if (
			a.windowId !== b.windowId ||
			a.pinned !== b.pinned ||
			a.groupId !== b.groupId ||
			b.index === a.index + 1
		) {
			return false;
		}

		await chrome.tabs.move(right, {
			index: b.index > a.index ? a.index + 1 : a.index,
		});
		await chrome.tabs.createSplit([left, right]);
		return true;
	} catch {
		return false;
	}
}

const UNLOAD_WAIT_MS = 60_000;

async function unloadWhenCommitted(
	tabIds: number[],
	knownTabs: chrome.tabs.Tab[] = [],
): Promise<void> {
	const pending = new Set(tabIds);
	const committed = (tab: chrome.tabs.Tab | undefined) =>
		Boolean(tab?.url && /^https?:/i.test(tab.url));
	const discard = async (tabId: number) => {
		pending.delete(tabId);
		try {
			await chrome.tabs.discard(tabId);
		} catch {}
	};

	const byId = new Map(knownTabs.map((tab) => [tab.id, tab]));
	for (const tabId of tabIds) {
		const tab = byId.get(tabId);
		if (tab?.active || tab?.discarded) {
			pending.delete(tabId);
		} else if (committed(tab)) {
			await discard(tabId);
		}
	}

	if (pending.size === 0 || !chrome.tabs.onUpdated?.addListener) {
		return;
	}

	const onUpdated = (
		tabId: number,
		changeInfo: chrome.tabs.OnUpdatedInfo,
		tab: chrome.tabs.Tab,
	) => {
		if (!pending.has(tabId) || !(changeInfo.url || changeInfo.status)) {
			return;
		}

		if (tab.active) {
			pending.delete(tabId);
		} else if (committed(tab)) {
			void discard(tabId);
		}

		if (pending.size === 0) {
			stop();
		}
	};

	const onRemoved = (tabId: number) => {
		pending.delete(tabId);
		if (pending.size === 0) {
			stop();
		}
	};

	const timer = setTimeout(() => stop(), UNLOAD_WAIT_MS);
	function stop() {
		clearTimeout(timer);
		chrome.tabs.onUpdated.removeListener(onUpdated);
		chrome.tabs.onRemoved?.removeListener?.(onRemoved);
	}

	chrome.tabs.onUpdated.addListener(onUpdated);
	chrome.tabs.onRemoved?.addListener?.(onRemoved);
}

const RESTORE_BATCH_THRESHOLD = 100;
const RESTORE_BATCH_SIZE = 25;
const RESTORE_BATCH_WAIT_MS = 3000;
const RESTORE_BATCH_POLL_MS = 250;
const RESTORE_BATCH_SLACK = 5;

async function waitUntilLoaded(
	windowId: number | undefined,
	tabIds: number[],
): Promise<chrome.tabs.Tab[]> {
	const wanted = new Set(tabIds);
	const deadline = Date.now() + RESTORE_BATCH_WAIT_MS;
	for (;;) {
		let tabs: chrome.tabs.Tab[];
		try {
			tabs = await chrome.tabs.query({windowId});
		} catch {
			return [];
		}

		const loading = tabs.filter(
			(tab) =>
				tab.id !== undefined && wanted.has(tab.id) && tab.status === 'loading',
		).length;
		if (loading <= RESTORE_BATCH_SLACK || Date.now() >= deadline) {
			return tabs;
		}

		await new Promise<void>((resolve) => {
			setTimeout(resolve, RESTORE_BATCH_POLL_MS);
		});
	}
}

async function restoreRecords(
	records: SavedTab[],
	settings: Settings,
	senderTab: chrome.tabs.Tab | undefined,
	options: {
		restoreTarget?: RestoreTarget;
		activate?: boolean;
		target?: {id: number | undefined; bootstrapTabId: number | null};
		activeSavedId?: string;
		windowBounds?: Session['windowBounds'];
	} = {},
): Promise<RestoreRecordsResult> {
	const valid = pairSplits(
		records
			.map((tab, index) => normalizeTab(tab, Date.now(), index))
			.filter((tab): tab is SavedTab => Boolean(tab)),
	);
	if (valid.length === 0) {
		return {
			opened: [],
			skipped: 0,
			failures: [],
			splits: 0,
			splitsSeparated: 0,
		};
	}

	const target =
		options.target ??
		(await chooseRestoreWindow(
			settings,
			senderTab,
			options.restoreTarget || settings.restoreTarget,
			settings.restoreWindowBounds ? options.windowBounds : undefined,
		));
	const targetTabs = await chrome.tabs.query({windowId: target.id});
	const existing = new Set(
		targetTabs
			.filter(
				(tab) =>
					(!tab.pinned || settings.includePinnedTabs) &&
					isCapturable(tab, settings),
			)
			.map((tab) => {
				const url = normalizeUrl(tab.url);
				return settings.removeTrackingParameters && url
					? stripTrackingParameters(url)
					: url;
			}),
	);
	const shouldSkip = settings.restoreDuplicateHandling === 'skip';
	const opened: RestoreRecordsResult['opened'] = [];
	const openedIds = new Map<SavedTab, number>();
	const failures: RestoreFailure[] = [];
	const groupTabs = new Map<
		string,
		{tabIds: number[]; metadata: NativeGroup; groupId?: number}
	>();
	let skipped = 0;
	const batched = valid.length > RESTORE_BATCH_THRESHOLD;
	const unloadAsYouGo =
		batched &&
		settings.unloadRestoredTabs &&
		valid.length > settings.unloadRestoredTabsThreshold &&
		typeof chrome.tabs.discard === 'function';
	let batch: typeof opened = [];
	const finishBatch = async () => {
		const seen = await waitUntilLoaded(
			target.id,
			batch.flatMap((entry) =>
				entry.tabId === undefined ? [] : [entry.tabId],
			),
		);
		if (unloadAsYouGo) {
			const keepId = (
				opened.find((entry) => entry.saved.id === options.activeSavedId) ??
				opened[0]
			)?.tabId;
			await unloadWhenCommitted(
				batch.flatMap((entry) =>
					entry.tabId === undefined ||
					entry.tabId === keepId ||
					entry.saved.pinned ||
					entry.saved.split
						? []
						: [entry.tabId],
				),
				seen,
			);
		}

		batch = [];
	};

	for (const saved of valid) {
		const url = settings.removeTrackingParameters
			? stripTrackingParameters(saved.url)
			: saved.url;
		if (shouldSkip && existing.has(url)) {
			skipped += 1;
			continue;
		}

		try {
			const created = await chrome.tabs.create({
				windowId: target.id,
				url,
				active: false,
				pinned: saved.pinned,
			});
			opened.push({saved, tabId: created.id});
			batch.push({saved, tabId: created.id});
			if (batched && batch.length >= RESTORE_BATCH_SIZE) {
				await finishBatch();
			}

			openedIds.set(saved, created.id!);
			existing.add(url);
			if (saved.nativeGroup && !saved.pinned) {
				const key =
					saved.nativeGroup.key || saved.nativeGroup.title || 'default';
				const entry = groupTabs.get(key) || {
					tabIds: [],
					metadata: saved.nativeGroup,
				};
				entry.tabIds.push(created.id!);
				groupTabs.set(key, entry);
			}
		} catch (error) {
			failures.push({
				title: saved.title,
				url: saved.url,
				error: cleanText(
					errorMessage(error),
					'The browser refused to open this tab.',
					240,
				),
			});
		}
	}

	for (const entry of groupTabs.values()) {
		try {
			entry.groupId = await chrome.tabs.group({
				tabIds: entry.tabIds as [number, ...number[]],
				createProperties: {windowId: target.id},
			});
		} catch {}
	}

	const splitTabIds = new Set<number>();
	let splits = 0;
	let splitsSeparated = 0;
	if (
		settings.restoreSplitTabs === 'split' &&
		typeof chrome.tabs.createSplit === 'function'
	) {
		for (let index = 0; index < valid.length - 1; index += 1) {
			const left = valid[index];
			const right = valid[index + 1];
			if (!left.split || right.split?.id !== left.split.id) {
				continue;
			}

			index += 1;
			const leftId = openedIds.get(left);
			const rightId = openedIds.get(right);
			if (leftId === undefined || rightId === undefined) {
				continue;
			}

			if (await splitRestoredPair(leftId, rightId)) {
				splits += 1;
				splitTabIds.add(leftId).add(rightId);
			} else {
				splitsSeparated += 1;
			}
		}
	}

	for (const entry of groupTabs.values()) {
		if (entry.groupId === undefined) {
			continue;
		}

		try {
			await chrome.tabGroups.update(entry.groupId, {
				title: entry.metadata.title,
				color: entry.metadata.color,
				collapsed: entry.metadata.collapsed,
			});
		} catch {}
	}

	const activeEntry =
		opened.find((entry) => entry.saved.id === options.activeSavedId) ??
		opened[0];
	if (options.activate !== false && activeEntry?.tabId) {
		try {
			await chrome.tabs.update(activeEntry.tabId, {active: true});
		} catch {}
	}

	if (
		target.bootstrapTabId &&
		opened.length > 0 &&
		options.activate !== false
	) {
		try {
			await chrome.tabs.remove(target.bootstrapTabId);
		} catch {}
	}

	if (
		settings.unloadRestoredTabs &&
		opened.length > settings.unloadRestoredTabsThreshold &&
		typeof chrome.tabs.discard === 'function'
	) {
		const currentTabs = await chrome.tabs.query({windowId: target.id});
		const activeId = currentTabs.find((tab) => tab.active)?.id;
		const unload = opened
			.filter(
				(entry) =>
					entry.tabId !== undefined &&
					!entry.saved.pinned &&
					entry.tabId !== activeId &&
					!splitTabIds.has(entry.tabId),
			)
			.map((entry) => entry.tabId!);
		await unloadWhenCommitted(unload, currentTabs);
	}

	return {
		opened,
		skipped,
		failures,
		windowId: target.id,
		splits,
		splitsSeparated,
	};
}

function restoreFailureMessage(
	result: {failures?: RestoreFailure[]},
	fallback: string,
) {
	const firstFailure = result.failures?.[0];
	return firstFailure
		? `${firstFailure.title || firstFailure.url}: ${firstFailure.error}`
		: fallback;
}

async function restoreGroup(
	groupId: string,
	senderTab: chrome.tabs.Tab | undefined,
	forceRemove = false,
	options: RestoreOptions & {
		intoWindowId?: number;
	} = {},
): Promise<ActionResult<'RESTORE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const restoreTarget = options.restoreTarget || store.settings.restoreTarget;
		const intoWindow = isInteger(options.intoWindowId);
		const result = await restoreRecords(
			group.tabs,
			intoWindow
				? {...store.settings, restoreDuplicateHandling: 'open'}
				: store.settings,
			senderTab,
			{
				restoreTarget,
				activate: options.activate !== false,
				...(intoWindow && {
					target: {id: options.intoWindowId, bootstrapTabId: null},
				}),
				...(!intoWindow && {windowBounds: group.windowBounds}),
			},
		);
		if (result.opened.length === 0) {
			return {
				ok: false,
				error: result.skipped
					? 'All tabs in this session are already open.'
					: restoreFailureMessage(
							result,
							'No tabs in this session could be opened.',
						),
			};
		}

		const mode = forceRemove
			? 'remove'
			: isOneOf(['keep', 'remove'], options.restoreMode)
				? options.restoreMode
				: store.settings.restoreMode;
		const remove = mode === 'remove';
		let removed = false;
		let trashId: string | undefined;
		group.lastOpenedAt = Date.now();
		if (remove) {
			const restoredIds = new Set(result.opened.map(({saved}) => saved.id));
			const groupIndex = store.groups.indexOf(group);
			const gone = group.tabs
				.map((tab, index) => ({tab, index}))
				.filter(({tab}) => restoredIds.has(tab.id));
			group.tabs = group.tabs.filter((tab) => !restoredIds.has(tab.id));
			if (group.tabs.length === 0) {
				store.groups = store.groups.filter((entry) => entry.id !== groupId);
				removed = true;
			}

			if (gone.length > 0) {
				trashId = await trashAdd(
					store.settings,
					trashTabsEntry(group, gone, removed, groupIndex),
				);
			}
		}

		await writeStore(store);

		return {
			ok: true,
			count: result.opened.length,
			skipped: result.skipped,
			failed: result.failures.length,
			failures: result.failures,
			removed,
			splits: result.splits,
			splitsSeparated: result.splitsSeparated,
			...(trashId && {trashId}),
		};
	});
}

async function switchWorkspace(
	groupId: string,
	senderTab: chrome.tabs.Tab | undefined,
): Promise<ActionResult<'SWITCH_WORKSPACE'>> {
	const store = await getStore();
	if (!findGroup(store, groupId)) {
		return {ok: false, error: 'That saved session no longer exists.'};
	}

	const windowId = await currentWindowId(senderTab);
	if (!isInteger(windowId)) {
		return {ok: false, error: 'Open a browser window before switching.'};
	}

	const outgoing = new Map(
		(await chrome.tabs.query({windowId}))
			.filter(
				(tab) =>
					isInteger(tab.id) &&
					isCapturable(tab, store.settings) &&
					(!tab.pinned || store.settings.includePinnedTabs),
			)
			.map((tab) => [tab.id!, normalizeUrl(tab.url)] as const),
	);
	let saved = 0;
	let savedGroupId: string | null = null;
	const sortedUrls = (urls: Iterable<string | null>) =>
		[...urls].map(String).toSorted((a, b) => a.localeCompare(b));
	const outgoingUrls = sortedUrls(outgoing.values());
	const alreadySaved = store.groups.find((group) => {
		const urls = sortedUrls(group.tabs.map((tab) => normalizeUrl(tab.url)));
		return (
			urls.length === outgoingUrls.length &&
			urls.every((url, index) => url === outgoingUrls[index])
		);
	});
	if (alreadySaved) {
		savedGroupId = alreadySaved.id;
	} else if (outgoing.size > 0) {
		const save = await saveTabs('window', senderTab, DEFAULT_FOLDER_ID, {
			tabIds: [...outgoing.keys()],
			keepTabsOpen: true,
		});
		if (!save.ok) {
			return save;
		}

		saved = save.count;
		savedGroupId = save.groupId;
	}

	const restore = await restoreGroup(groupId, senderTab, false, {
		restoreTarget: 'current-window',
		intoWindowId: windowId,
	});
	if (!restore.ok) {
		return {
			ok: false,
			error: saved
				? `Saved the current tabs, but ${restore.error.charAt(0).toLowerCase()}${restore.error.slice(1)} They stay open.`
				: restore.error,
		};
	}

	let closed = 0;
	if (outgoing.size > 0) {
		const closeIds = (await chrome.tabs.query({windowId}))
			.filter(
				(tab) =>
					isInteger(tab.id) &&
					outgoing.get(tab.id) === normalizeUrl(tab.url) &&
					(!tab.pinned || store.settings.includePinnedTabs),
			)
			.map((tab) => tab.id!);
		try {
			await chrome.tabs.remove(closeIds);
			closed = closeIds.length;
		} catch {}
	}

	return {...restore, saved, savedGroupId, closed};
}

async function deleteGroup(
	groupId: string,
): Promise<ActionResult<'DELETE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const index = store.groups.findIndex((group) => group.id === groupId);
		if (index === -1) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const [removed] = store.groups.splice(index, 1);
		const trashId = await trashAdd(store.settings, {
			kind: 'session',
			label: removed.name,
			origin: store.folders.find((f) => f.id === removed.folderId)?.name ?? '',
			count: removed.tabs.length,
			data: trashSessionData(removed, index),
		});
		await writeStore(store);
		return {ok: true, trashId};
	});
}

async function updateGroup(
	groupId: string,
	fields: SessionFields,
): Promise<ActionResult<'UPDATE_GROUP'>> {
	return mutateWithUndo('UPDATE_GROUP', async () => {
		const {store, save} = await openStore({sessions: [groupId]});
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (typeof fields.name === 'string') {
			const name = cleanText(fields.name, 'Saved session', 120);
			group.name = name;
		}

		if (typeof fields.description === 'string') {
			group.description = normalizeSessionText(fields.description);
		}

		if (fields.color !== undefined) {
			const {color} = colorField(fields.color);
			if (color) {
				group.color = color;
			} else {
				delete group.color;
			}
		}

		if (typeof fields.folderId === 'string') {
			if (store.folders.every((folder) => folder.id !== fields.folderId)) {
				return {ok: false, error: 'Choose an existing folder.'};
			}

			const target = store.folders.find(
				(folder) => folder.id === fields.folderId,
			);
			if (
				fields.color === undefined &&
				group.folderId !== fields.folderId &&
				target?.colorSessions &&
				target.color
			) {
				group.color = target.color;
			}

			group.folderId = fields.folderId;
		}

		group.updatedAt = Date.now();
		await save();
		return {ok: true, group};
	});
}

async function archiveGroup(
	groupId: string,
): Promise<ActionResult<'ARCHIVE_GROUP'>> {
	return mutateWithUndo('ARCHIVE_GROUP', async () => {
		const {store, save} = await openStore({sessions: [groupId]});
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const existingFolder = store.folders.find(
			(folder) => folder.name === ARCHIVED_FOLDER_NAME,
		);
		if (existingFolder?.id === group.folderId) {
			return {ok: true, group};
		}

		const archived = existingFolder ?? findOrAddArchivedFolder(store.folders);
		group.folderId = archived.id;
		group.updatedAt = Date.now();
		await save();
		return {ok: true, group};
	});
}

function archiveStaleSessions(): Promise<void> {
	return mutate(async () => {
		const store = await getStore();
		const {autoArchiveDays} = store.settings;
		const stale = staleSessions(
			store.groups,
			store.folders,
			autoArchiveDays,
			Date.now(),
		);
		if (stale.length === 0) {
			return;
		}

		const archived = findOrAddArchivedFolder(store.folders);
		for (const group of stale) {
			group.folderId = archived.id;
		}

		await writeStore(store);
	});
}

async function setGroupOrder(
	order: string[],
): Promise<ActionResult<'SET_GROUP_ORDER'>> {
	return mutateWithUndo('SET_GROUP_ORDER', async () => {
		const store = await getStore();
		const byId = new Map(store.groups.map((group) => [group.id, group]));
		const ids = [
			...new Set(
				(Array.isArray(order) ? order : []).filter(
					(id): id is string => typeof id === 'string' && byId.has(id),
				),
			),
		];
		const slots = store.groups
			.map((group, index) => (ids.includes(group.id) ? index : -1))
			.filter((index) => index !== -1);
		for (const [position, slot] of slots.entries()) {
			store.groups[slot] = byId.get(ids[position])!;
		}

		store.settings = normalizeSettings({
			...store.settings,
			sessionSort: 'custom',
		});
		await writeStore(store);
		return {ok: true};
	});
}

async function createFolder(
	name: string,
	icon?: unknown,
	color?: unknown,
	colorSessions?: unknown,
): Promise<ActionResult<'CREATE_FOLDER'>> {
	return mutateWithUndo('CREATE_FOLDER', async () => {
		const {store, save} = await openStore({});
		const problem = folderNameProblem(store.folders, name);
		if (problem) {
			return {ok: false, error: problem};
		}

		const folderName = normalizeFolderName(name);
		const folder = {
			id: makeId(),
			name: folderName,
			...iconField(icon),
			...colorField(color),
			createdAt: Date.now(),
			isDefault: false,
		};
		if (colorSessions === true) {
			Object.assign(folder, {colorSessions: true});
		}

		store.folders.push(folder);
		await save();
		return {ok: true, folder};
	});
}

async function updateFolder(
	folderId: string,
	name: string,
	icon?: unknown,
	color?: unknown,
	colorSessions?: unknown,
): Promise<ActionResult<'UPDATE_FOLDER'>> {
	return mutateWithUndo('UPDATE_FOLDER', async () => {
		const {store, save} = await openStore({});
		const folder = store.folders.find((entry) => entry.id === folderId);
		if (!folder) {
			return {ok: false, error: 'That folder no longer exists.'};
		}

		if (folder.isDefault) {
			return {ok: false, error: 'The Unfiled folder cannot be renamed.'};
		}

		if (isArchivedFolderName(folder.name)) {
			return {ok: false, error: 'The Archived folder cannot be renamed.'};
		}

		const problem = folderNameProblem(store.folders, name, folderId);
		if (problem) {
			return {ok: false, error: problem};
		}

		const folderName = normalizeFolderName(name);
		folder.name = folderName;
		if (icon !== undefined) {
			const {icon: nextIcon} = iconField(icon);
			if (nextIcon) {
				folder.icon = nextIcon;
			} else {
				delete folder.icon;
			}
		}

		if (color !== undefined) {
			const {color: nextColor} = colorField(color);
			if (nextColor) {
				folder.color = nextColor;
			} else {
				delete folder.color;
			}
		}

		if (colorSessions !== undefined) {
			if (colorSessions === true) {
				folder.colorSessions = true;
			} else {
				delete folder.colorSessions;
			}
		}

		await save();
		return {ok: true, folder};
	});
}

async function deleteFolder(
	folderId: string,
): Promise<ActionResult<'DELETE_FOLDER'>> {
	return mutate(() =>
		withUndo('Delete folder', [STORAGE_KEY], async () => {
			const store = await getStore();
			const folder = store.folders.find((entry) => entry.id === folderId);
			if (!folder) {
				return {ok: false, error: 'That folder no longer exists.'};
			}

			if (folder.isDefault) {
				return {ok: false, error: 'The Unfiled folder cannot be deleted.'};
			}

			if (isArchivedFolderName(folder.name)) {
				return {ok: false, error: 'The Archived folder cannot be deleted.'};
			}

			const groupIds: string[] = [];
			for (const group of store.groups) {
				if (group.folderId !== folderId) {
					continue;
				}

				group.folderId = DEFAULT_FOLDER_ID;
				groupIds.push(group.id);
			}

			store.folders = store.folders.filter((entry) => entry.id !== folderId);
			await writeStore(store);
			return {ok: true, moved: groupIds.length};
		}),
	);
}

async function deleteTab(
	groupId: string,
	tabId: string,
): Promise<ActionResult<'DELETE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const tabIndex = group.tabs.findIndex((tab) => tab.id === tabId);
		if (tabIndex === -1) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		const groupIndex = store.groups.indexOf(group);
		const [removedTab] = group.tabs.splice(tabIndex, 1);
		const groupRemoved = group.tabs.length === 0;
		const trashId = await trashAdd(
			store.settings,
			trashTabsEntry(
				group,
				[{tab: removedTab, index: tabIndex}],
				groupRemoved,
				groupIndex,
			),
		);
		if (!groupRemoved) {
			group.updatedAt = Date.now();
		}

		store.groups = store.groups.filter(
			(entry) => entry.id !== groupId || entry.tabs.length > 0,
		);
		await writeStore(store);
		return {ok: true, trashId};
	});
}

async function mergeGroups(
	sourceGroupId: string,
	targetGroupId: string,
): Promise<ActionResult<'MERGE_GROUPS'>> {
	return mutate(() =>
		withUndo('Merge sessions', [STORAGE_KEY], async () => {
			const store = await getStore();
			const source = findGroup(store, sourceGroupId);
			const target = findGroup(store, targetGroupId);
			if (!source || !target || source === target) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			const kept = new Map(target.tabs.map((tab) => [tab.url, tab]));
			const added: SavedTab[] = [];
			let skipped = 0;
			for (const tab of source.tabs) {
				const existing = kept.get(tab.url);
				if (existing) {
					skipped += 1;
					if (!existing.notes && tab.notes) {
						existing.notes = tab.notes;
					}

					continue;
				}

				kept.set(tab.url, tab);
				added.push(tab);
			}

			if (target.tabs.length + added.length > MAX_TABS_PER_SESSION) {
				return {ok: false, error: sessionFullError()};
			}

			target.tabs.push(...added);
			const description = source.description.trim();
			if (description && !target.description.includes(description)) {
				target.description = [target.description.trim(), description]
					.filter(Boolean)
					.join('\n\n')
					.slice(0, SESSION_TEXT_MAX);
			}

			target.updatedAt = Date.now();
			store.groups = store.groups.filter((group) => group !== source);
			await writeStore(store);
			return {ok: true, added: added.length, skipped};
		}),
	);
}

async function addLinksToSession(
	groupId: string,
	entries: LinkEntry[] = [],
	targetTabId: string | null = null,
	position: InsertPosition = 'after',
): Promise<ActionResult<'ADD_LINKS_TO_SESSION'>> {
	return mutate(() =>
		withUndo('Add links to session', [STORAGE_KEY], async () => {
			const store = await getStore();
			const group = findGroup(store, groupId);
			if (!group) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			const duplicates = sessionDuplicates(
				store.groups,
				group.id,
				store.settings.saveDuplicateHandling,
			);
			const now = Date.now();
			const added: SavedTab[] = [];
			let skipped = 0;
			for (const entry of (Array.isArray(entries) ? entries : []).slice(
				0,
				500,
			)) {
				const url = normalizeUrl(entry?.url);
				if (!url) {
					continue;
				}

				if (duplicates.isDuplicate(url)) {
					skipped += 1;
					continue;
				}

				duplicates.saved(url);
				added.push({
					id: makeId(),
					title: await bestBookmarkTitle(
						entry?.title,
						url,
						store.settings.cleanTitles,
					),
					url,
					notes: '',
					pinned: false,
					nativeGroup: null,
					savedAt: now,
					originalIndex: group.tabs.length + added.length,
				});
			}

			if (added.length === 0) {
				return skipped > 0
					? {
							ok: false,
							error: duplicateError('session'),
							duplicate: true,
						}
					: {
							ok: false,
							error: 'Only regular http and https pages can be saved.',
						};
			}

			if (group.tabs.length + added.length > MAX_TABS_PER_SESSION) {
				return {ok: false, error: sessionFullError()};
			}

			const index = targetTabId
				? group.tabs.findIndex((tab) => tab.id === targetTabId)
				: -1;
			group.tabs.splice(
				index === -1
					? group.tabs.length
					: index + (position === 'before' ? 0 : 1),
				0,
				...added,
			);
			group.updatedAt = now;
			await writeStore(store);
			return {ok: true, added: added.length, skipped};
		}),
	);
}

async function updateGroupFromWindow(
	groupId: string,
	mode: SessionWindowMode,
	senderTab: chrome.tabs.Tab | undefined,
): Promise<ActionResult<'UPDATE_GROUP_FROM_WINDOW'>> {
	if (mode !== 'replace' && mode !== 'append') {
		return {ok: false, error: 'Choose replace or append.'};
	}

	return mutate(() =>
		withUndo(
			mode === 'replace' ? 'Replace session contents' : 'Add window to session',
			[STORAGE_KEY],
			async () => {
				const store = await getStore();
				const group = findGroup(store, groupId);
				if (!group) {
					return {ok: false, error: 'That saved session no longer exists.'};
				}

				const windowId = await currentWindowId(senderTab);
				if (!isInteger(windowId)) {
					return {ok: false, error: 'Open a browser window first.'};
				}

				const win = (await chrome.windows.get(windowId, {
					populate: true,
				})) as PopulatedWindow;
				const {settings} = store;
				const now = Date.now();
				const entries = await captureEntriesOf(win.tabs, win, settings, now);
				const own = new Map(group.tabs.map((tab) => [tab.url, tab]));
				const known = new Map(own);
				for (const other of store.groups) {
					if (other === group) {
						continue;
					}

					for (const tab of other.tabs) {
						if (!known.has(tab.url)) {
							known.set(tab.url, tab);
						}
					}
				}

				const duplicates = sessionDuplicates(
					mode === 'append'
						? store.groups
						: store.groups.filter((other) => other !== group),
					mode === 'append' ? group.id : undefined,
					settings.saveDuplicateHandling,
				);
				const kept: CaptureEntry[] = [];
				let skipped = 0;
				for (const entry of entries) {
					const {url} = entry.saved;
					const existing = known.get(url);
					if (duplicates.isDuplicate(url)) {
						skipped += 1;
						continue;
					}

					duplicates.saved(url);
					if (existing) {
						entry.saved.notes = existing.notes || '';
						if (settings.saveDuplicateTitle !== 'latest') {
							entry.saved.title = existing.title;
						}
					}

					kept.push(entry);
				}

				assignSplitPairs(kept);
				const incoming = pairSplits(kept.map(({saved}) => saved));
				if (incoming.length === 0) {
					return {
						ok: false,
						error:
							skipped > 0
								? 'Every tab in this window is already saved.'
								: 'There are no unpinned web tabs to save.',
					};
				}

				const tabs =
					mode === 'replace' ? incoming : [...group.tabs, ...incoming];
				if (tabs.length > MAX_TABS_PER_SESSION) {
					return {ok: false, error: sessionFullError()};
				}

				const before = new Set(group.tabs.map((tab) => tab.url));
				const after = new Set(tabs.map((tab) => tab.url));
				const result = {
					count: tabs.length,
					added: incoming.filter((tab) => !before.has(tab.url)).length,
					removed: group.tabs.filter((tab) => !after.has(tab.url)).length,
					skipped,
				};
				group.tabs = tabs;
				group.updatedAt = now;
				await writeStore(store);
				return {ok: true, ...result};
			},
		),
	);
}

function linksSessionName(
	settings: Settings,
	entries: LinkEntry[],
	now = new Date(),
): string {
	const links = entries
		.map((entry) => ({title: entry?.title, url: normalizeUrl(entry?.url)}))
		.filter((entry): entry is {title: string; url: string} =>
			Boolean(entry.url),
		);
	const first = links[0];
	return formatSessionName({
		style: builtNameStyle(settings),
		template: settings.sessionNameTemplate,
		title: first ? pageTitle(first.title, first.url, settings.cleanTitles) : '',
		url: first?.url ?? '',
		count: Math.max(new Set(links.map((link) => link.url)).size, 1),
		now,
		locale: browserLocale(),
	});
}

async function createSessionFromLinks(
	entries: LinkEntry[] = [],
	requestedName = '',
): Promise<ActionResult<'CREATE_SESSION_FROM_LINKS'>> {
	await deviceReady;
	return mutate(() =>
		withUndo('Create session from links', [STORAGE_KEY], async () => {
			const store = await getStore();
			if (store.groups.length >= MAX_SESSIONS) {
				return {ok: false, error: sessionLimitError()};
			}

			const known = new Set<string>();
			const now = Date.now();
			const tabs: SavedTab[] = [];
			let skipped = 0;
			for (const entry of (Array.isArray(entries) ? entries : []).slice(
				0,
				MAX_TABS_PER_SESSION,
			)) {
				const url = normalizeUrl(entry?.url);
				if (!url) {
					continue;
				}

				if (known.has(url)) {
					skipped += 1;
					continue;
				}

				known.add(url);
				tabs.push({
					id: makeId(),
					title: await bestBookmarkTitle(
						entry?.title,
						url,
						store.settings.cleanTitles,
					),
					url,
					notes: '',
					pinned: false,
					nativeGroup: null,
					savedAt: now,
					originalIndex: tabs.length,
				});
			}

			if (tabs.length === 0) {
				return {
					ok: false,
					error: 'Only regular http and https pages can be saved.',
				};
			}

			const created: Session = {
				id: makeId(),
				name: cleanText(
					requestedName,
					linksSessionName(
						store.settings,
						tabs.map((tab) => ({title: tab.title, url: tab.url})),
						new Date(now),
					),
					120,
				),
				folderId: DEFAULT_FOLDER_ID,
				description: '',
				createdAt: now,
				updatedAt: now,
				sourceWindowName: '',
				sourceWindowId: null,
				...deviceStamp(thisDevice, 'desktop'),
				tabs,
			};
			store.groups.unshift(created);
			await writeStore(store);
			return {ok: true, groupId: created.id, count: tabs.length, skipped};
		}),
	);
}

async function splitGroup(
	groupId: string,
	tabIds: string[] = [],
	requestedName = '',
): Promise<ActionResult<'SPLIT_GROUP'>> {
	return mutate(() =>
		withUndo('Split session', [STORAGE_KEY], async () => {
			const store = await getStore();
			const group = findGroup(store, groupId);
			if (!group) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			const chosen = new Set(Array.isArray(tabIds) ? tabIds.map(String) : []);
			const moved = group.tabs.filter((tab) => chosen.has(tab.id));
			if (moved.length === 0) {
				return {ok: false, error: 'Select the links to move first.'};
			}

			if (moved.length === group.tabs.length) {
				return {
					ok: false,
					error:
						'Leave at least one link in the session, or rename it instead.',
				};
			}

			if (store.groups.length >= MAX_SESSIONS) {
				return {ok: false, error: sessionLimitError()};
			}

			const now = Date.now();
			group.tabs = pairSplits(group.tabs.filter((tab) => !chosen.has(tab.id)));
			group.updatedAt = now;
			const created: Session = {
				id: makeId(),
				name: cleanText(
					requestedName || `${group.name.slice(0, 100)} (split)`,
					'Saved session',
					120,
				),
				folderId: group.folderId,
				description: '',
				createdAt: now,
				updatedAt: now,
				sourceWindowName: group.sourceWindowName,
				sourceWindowId: group.sourceWindowId,
				...deviceStamp(group.deviceName ?? '', group.deviceKind ?? 'desktop'),
				...(group.color && {color: group.color}),
				tabs: pairSplits(moved),
			};
			store.groups.splice(store.groups.indexOf(group) + 1, 0, created);
			await writeStore(store);
			return {ok: true, groupId: created.id, count: moved.length};
		}),
	);
}

async function moveTab(
	fromGroupId: string,
	tabId: string,
	toGroupId: string,
	targetTabId: string | null = null,
	position: InsertPosition = 'after',
	copy = false,
	restoreTrashId: string | null = null,
): Promise<ActionResult<'MOVE_TAB'>> {
	return mutateWithUndo('MOVE_TAB', async () => {
		const store = await getStore();
		const source = findGroup(store, fromGroupId);
		const target = findGroup(store, toGroupId);
		const tab = source?.tabs.find((entry) => entry.id === tabId);
		if (!source || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		if (!target && restoreTrashId && !copy) {
			const entry = (await readTrash()).find(
				(item) => item.id === restoreTrashId,
			);
			if (entry?.kind !== 'tabs' || entry.data.groupId !== toGroupId) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			source.tabs = source.tabs.filter((item) => item.id !== tabId);
			const outcome = applyTrashRestore(store, entry);
			if (!outcome.ok) {
				return outcome;
			}

			store.groups = store.groups.filter((item) => item.tabs.length > 0);
			await writeStore(store);
			await trashMutate(async () => {
				await writeTrash(
					(await readTrash()).filter((item) => item.id !== restoreTrashId),
				);
			});
			return {ok: true};
		}

		if (!target) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (targetTabId === tabId && source === target) {
			return {ok: true};
		}

		if (source !== target && target.tabs.length >= MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		if (!copy && tab.split) {
			const splitId = tab.split.id;
			for (const entry of source.tabs) {
				if (entry.split?.id === splitId) {
					delete entry.split;
				}
			}
		}

		const sourceIndex = source.tabs.indexOf(tab);
		const moving: SavedTab = copy
			? {...structuredClone(tab), id: makeId(), savedAt: Date.now()}
			: tab;
		delete moving.split;
		if (!copy) {
			source.tabs = source.tabs.filter((entry) => entry.id !== tabId);
		}

		const index = targetTabId
			? target.tabs.findIndex((entry) => entry.id === targetTabId)
			: -1;
		const insertAt =
			index === -1
				? target.tabs.length
				: index + (position === 'after' ? 1 : 0);
		target.tabs.splice(insertAt, 0, moving);
		const now = Date.now();
		target.updatedAt = now;
		if (!copy) {
			source.updatedAt = now;
		}

		let trashId: string | undefined;
		if (!copy && source !== target && source.tabs.length === 0) {
			trashId = await trashAdd(
				store.settings,
				trashTabsEntry(
					source,
					[{tab, index: sourceIndex}],
					true,
					store.groups.indexOf(source),
				),
			);
		}

		store.groups = store.groups.filter((entry) => entry.tabs.length > 0);
		await writeStore(store);
		return trashId ? {ok: true, trashId} : {ok: true};
	});
}

async function updateTab(
	groupId: string,
	tabId: string,
	fields: TabFields = {},
): Promise<ActionResult<'UPDATE_TAB'>> {
	return mutateWithUndo('UPDATE_TAB', async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		const tab = group?.tabs.find((entry) => entry.id === tabId);
		if (!group || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		if (typeof fields.url === 'string' && fields.url !== tab.url) {
			const url = normalizeUrl(fields.url.trim());
			if (!url) {
				return {
					ok: false,
					error: 'Enter a web address that starts with http:// or https://.',
				};
			}

			if (url !== tab.url) {
				if (typeof fields.title === 'string') {
					tab.title = cleanText(fields.title, url, 500);
				}

				if (typeof fields.notes === 'string') {
					tab.notes = normalizeNotes(fields.notes);
				}

				tab.url = url;
				group.updatedAt = Date.now();
				await writeStore(store);
				return {ok: true, shared: 0};
			}
		}

		const shareTitle = typeof fields.title === 'string';
		const shareNotes = typeof fields.notes === 'string';
		const title = shareTitle
			? cleanText(fields.title, tab.url, 500)
			: tab.title;
		const notes = shareNotes ? normalizeNotes(fields.notes) : tab.notes;
		let shared = 0;
		const now = Date.now();
		for (const entryGroup of store.groups) {
			for (const entry of entryGroup.tabs) {
				if (entry.url !== tab.url) {
					continue;
				}

				if (shareTitle) {
					entry.title = title;
				}

				if (shareNotes) {
					entry.notes = notes;
				}

				if (entry !== tab && (shareTitle || shareNotes)) {
					shared += 1;
				}

				if (shareTitle || shareNotes || entry === tab) {
					entryGroup.updatedAt = now;
				}
			}
		}

		await writeStore(store);
		return {ok: true, shared};
	});
}

function findBookmark(store: Store, bookmarkId: string) {
	return store.bookmarks.find((bookmark) => bookmark.id === bookmarkId) || null;
}

async function addBookmark(
	fields: BookmarkFields = {},
): Promise<ActionResult<'ADD_BOOKMARK'>> {
	return mutateWithUndo('ADD_BOOKMARK', async () => {
		const {store, save} = await openStore({bookmarks: 'all'});
		const url = normalizeUrl(fields.url);
		if (!url) {
			return {
				ok: false,
				error: 'Only regular http and https pages can be bookmarked.',
			};
		}

		const columnId = landingColumnId(store.bookmarkColumns, fields.columnId, {
			claimedId: columnForUrl(store.bookmarkColumns, url)?.id,
		});
		if (
			bookmarkDuplicates(
				store.bookmarks,
				columnId,
				store.settings.saveDuplicateHandling,
			).isDuplicate(url)
		) {
			return {
				ok: false,
				error: duplicateError('bookmark'),
				duplicate: true,
			};
		}

		const now = Date.now();
		const notes = bookmarkNotes(fields.notes);
		const bookmark: Bookmark = {
			id: makeId(),
			title: await bestBookmarkTitle(
				fields.title,
				url,
				store.settings.cleanTitles,
			),
			url,
			columnId,
			...(notes && {notes}),
			...tagFields(fields),
			...(await savedHere()),
			createdAt: now,
			updatedAt: now,
		};
		store.bookmarks = insertNewBookmarks(
			store.bookmarks,
			[bookmark],
			store.settings.newBookmarkPosition,
		);
		await save();
		return {ok: true, bookmark};
	});
}

async function saveQuote(
	rawUrl: unknown,
	quote: unknown,
	title?: unknown,
): Promise<ActionResult<'SAVE_QUOTE'>> {
	const url = normalizeUrl(
		typeof rawUrl === 'string' ? pageAddress(rawUrl) : '',
	);
	if (!url) {
		return {
			ok: false,
			error: 'Quotes can be saved from regular http and https pages only.',
		};
	}

	return mutate(async () =>
		withUndo('Save quote', [STORAGE_KEY], async () => {
			const store = await getStore();
			const text = typeof quote === 'string' ? quote : '';
			const target = quoteTarget(store, url);
			const now = Date.now();
			if (target.kind === 'tab') {
				const tab = target.group.tabs.find(
					(entry) => entry.id === target.tabId,
				)!;
				const note = appendQuote(tab.notes, url, text);
				if (!note.ok) {
					return note;
				}

				for (const group of store.groups) {
					for (const entry of group.tabs) {
						if (entry.url !== tab.url) {
							continue;
						}

						entry.notes = note.notes;
						group.updatedAt = now;
					}
				}

				await writeStore(store);
				return {ok: true, placed: target.group.name};
			}

			const existing = target.kind === 'bookmark' ? target.bookmark : undefined;
			const note = appendQuote(existing?.notes, url, text);
			if (!note.ok) {
				return note;
			}

			let bookmark = existing;
			if (bookmark) {
				bookmark.notes = note.notes;
				bookmark.updatedAt = now;
			} else {
				const claimedId = columnForUrl(store.bookmarkColumns, url)?.id;
				bookmark = {
					id: makeId(),
					title: await bestBookmarkTitle(
						title,
						url,
						store.settings.cleanTitles,
					),
					url,
					columnId: landingColumnId(
						store.bookmarkColumns,
						claimedId ??
							defaultBookmarkColumnId(store.bookmarkColumns, store.bookmarks) ??
							BOOKMARK_UNFILED_ID,
						{claimedId, allowUnfiled: true},
					),
					notes: note.notes,
					...(await savedHere()),
					createdAt: now,
					updatedAt: now,
				};
				store.bookmarks = insertNewBookmarks(
					store.bookmarks,
					[bookmark],
					store.settings.newBookmarkPosition,
				);
			}

			await writeStore(store);
			const {columnId} = bookmark;
			return {
				ok: true,
				placed:
					store.bookmarkColumns.find((column) => column.id === columnId)
						?.name ?? 'Unfiled',
			};
		}),
	);
}

async function addBookmarks(
	entries: LinkEntry[] = [],
	columnId: string | null = null,
	targetBookmarkId: string | null = null,
	position: InsertPosition = 'after',
	undoable = false,
): Promise<ActionResult<'ADD_BOOKMARKS'>> {
	const run = async (): Promise<ActionResult<'ADD_BOOKMARKS'>> => {
		const store = await getStore();
		const targetColumnId = landingColumnId(store.bookmarkColumns, columnId, {
			allowUnfiled: true,
		});
		const now = Date.now();
		const device = await savedHere();
		const added: Bookmark[] = [];
		const duplicates = bookmarkDuplicates(
			store.bookmarks,
			targetColumnId,
			store.settings.saveDuplicateHandling,
		);
		let skipped = 0;
		for (const entry of (Array.isArray(entries) ? entries : []).slice(0, 500)) {
			const url = normalizeUrl(entry?.url);
			if (!url) {
				continue;
			}

			if (duplicates.isDuplicate(url)) {
				skipped += 1;
				continue;
			}

			duplicates.saved(url);

			added.push({
				id: makeId(),
				title: await bestBookmarkTitle(
					entry?.title,
					url,
					store.settings.cleanTitles,
				),
				url,
				columnId: targetColumnId,
				...device,
				createdAt: now,
				updatedAt: now,
			});
		}

		if (added.length === 0) {
			return skipped > 0
				? {ok: false, error: duplicateError('bookmark'), duplicate: true}
				: {
						ok: false,
						error: 'Only regular http and https pages can be bookmarked.',
					};
		}

		const target = targetBookmarkId
			? store.bookmarks.findIndex(
					(entry) =>
						entry.id === targetBookmarkId && entry.columnId === targetColumnId,
				)
			: -1;
		if (target >= 0) {
			store.bookmarks.splice(
				target + (position === 'before' ? 0 : 1),
				0,
				...added,
			);
		} else {
			store.bookmarks = insertNewBookmarks(
				store.bookmarks,
				added,
				store.settings.newBookmarkPosition,
			);
		}

		await writeStore(store);
		return {ok: true, count: added.length, skipped, bookmarks: added};
	};

	return mutate(() =>
		undoable ? withUndo('Add bookmarks', [STORAGE_KEY], run) : run(),
	);
}

async function importBrowserBookmarks(
	duplicateMode: DuplicateMode = 'skip',
	titlePolicy: TitlePolicy = 'existing',
	requestedColumnId: string | null = null,
): Promise<ActionResult<'IMPORT_BROWSER_BOOKMARKS'>> {
	if (!chrome.bookmarks?.getTree) {
		return {ok: false, error: 'This browser does not provide bookmark access.'};
	}

	let tree: chrome.bookmarks.BookmarkTreeNode[];
	try {
		tree = await chrome.bookmarks.getTree();
	} catch (error) {
		return {
			ok: false,
			error: errorMessage(error) || 'Could not read browser bookmarks.',
		};
	}

	const openTitles = await openBookmarkTitleMap();

	return mutate(() =>
		withUndo('Import', [STORAGE_KEY], async () => {
			const store = await getStore();
			const treeLinks = (nodes: chrome.bookmarks.BookmarkTreeNode[]): number =>
				nodes.reduce(
					(sum, node) =>
						sum + (node.url ? 1 : 0) + treeLinks(node.children ?? []),
					0,
				);
			if (treeLinks(Array.isArray(tree) ? tree : []) > LARGE_IMPORT_THRESHOLD) {
				await safetyBackup(store, 'Before importing browser bookmarks');
			}

			const columnsByName = new Map(
				store.bookmarkColumns.map((column) => [
					column.name.toLocaleLowerCase(),
					column,
				]),
			);
			const existingUrls = new Set([
				...store.bookmarks.map((bookmark) => bookmark.url),
				...(await trashedImportUrls(store.settings, 'bookmarks')),
			]);
			const existingBookmarks = new Map(
				store.bookmarks.map((bookmark) => [bookmark.url, bookmark]),
			);
			const allowDuplicates = duplicateMode === 'allow';
			const targetColumnId = importTargetColumn(store, requestedColumnId);
			const now = Date.now();
			let columnsAdded = 0;
			let bookmarksAdded = 0;
			let bookmarksSkipped = 0;
			let bookmarksUpdated = 0;
			const ensureColumn = (path: string[]) => {
				const name = cleanText(path.join(' / '), 'Bookmarks', 60);
				const key = name.toLocaleLowerCase();
				let column = columnsByName.get(key);
				if (!column && store.bookmarkColumns.length < 500) {
					column = {id: makeId(), name, createdAt: now, isDefault: false};
					store.bookmarkColumns.push(column);
					columnsByName.set(key, column);
					columnsAdded += 1;
				}

				return (
					column?.id ||
					store.bookmarkColumns.find(
						(entry) => entry.id === DEFAULT_BOOKMARK_COLUMN_ID,
					)?.id ||
					store.bookmarkColumns[0]?.id ||
					BOOKMARK_UNFILED_ID
				);
			};

			let processed = 0;
			const visit = (
				node: chrome.bookmarks.BookmarkTreeNode,
				folderPath: string[] = [],
			) => {
				if (!node || processed >= 10_000) {
					return;
				}

				processed += 1;
				if (typeof node.url === 'string') {
					const url = normalizeUrl(node.url);
					if (!url) {
						return;
					}

					if (existingUrls.has(url) && !allowDuplicates) {
						bookmarksSkipped += 1;
						const existing = existingBookmarks.get(url);
						const title = importedBookmarkTitle(node.title, url, openTitles);
						if (
							titlePolicy === 'latest' &&
							existing &&
							existing.title !== title
						) {
							existing.title = title;
							existing.updatedAt = now;
							bookmarksUpdated += 1;
						}

						return;
					}

					const bookmark: Bookmark = {
						id: makeId(),
						title: importedBookmarkTitle(node.title, url, openTitles),
						url,
						columnId:
							targetColumnId ||
							(folderPath.length > 0 ? ensureColumn(folderPath) : null) ||
							store.bookmarkColumns.find(
								(entry) => entry.id === DEFAULT_BOOKMARK_COLUMN_ID,
							)?.id ||
							store.bookmarkColumns[0]?.id ||
							BOOKMARK_UNFILED_ID,
						createdAt: now,
						updatedAt: now,
					};
					existingUrls.add(url);
					existingBookmarks.set(url, bookmark);
					store.bookmarks.push(bookmark);
					bookmarksAdded += 1;
					return;
				}

				if (!Array.isArray(node.children)) {
					return;
				}

				const nextPath =
					node.id === '0' || !node.title
						? folderPath
						: [...folderPath, cleanText(node.title, 'Bookmarks', 60)];
				if (nextPath.length > 0 && !targetColumnId) {
					ensureColumn(nextPath);
				}

				for (const child of node.children) {
					visit(child, nextPath);
				}
			};

			for (const root of Array.isArray(tree) ? tree : []) {
				visit(root);
			}

			if (columnsAdded || bookmarksAdded || bookmarksUpdated) {
				await writeStore(store);
			}

			return {
				ok: true,
				columnsAdded,
				bookmarksAdded,
				bookmarksSkipped,
				bookmarksUpdated,
			};
		}),
	);
}

async function addExcludedOrigins(
	origins: string[],
): Promise<ActionResult<'ADD_EXCLUDED_ORIGINS'>> {
	return mutate(async () => {
		const store = await getStore();
		const hosts = normalizeExcludedOrigins(origins);
		if (hosts.length === 0) {
			return {ok: false, error: 'Enter a valid website, such as example.com.'};
		}

		const fresh = hosts.filter(
			(host) => !store.settings.excludedOrigins.includes(host),
		);
		const room = Math.max(
			0,
			MAX_EXCLUDED_ORIGINS - store.settings.excludedOrigins.length,
		);
		if (fresh.length > 0 && room === 0) {
			return {
				ok: false,
				error: `The list is full (${MAX_EXCLUDED_ORIGINS} sites). Remove some sites first.`,
			};
		}

		const added = fresh.slice(0, room);
		if (added.length > 0) {
			store.settings.excludedOrigins = normalizeExcludedOrigins([
				...store.settings.excludedOrigins,
				...added,
			]);
			await writeStore(store);
		}

		return {
			ok: true,
			added: added.length,
			notAdded: fresh.length - added.length,
			settings: store.settings,
		};
	});
}

async function addExcludedOrigin(
	origin: string,
): Promise<ActionResult<'ADD_EXCLUDED_ORIGIN'>> {
	const result = await addExcludedOrigins([origin]);
	if (!result.ok) {
		return result;
	}

	return {
		ok: true,
		origin: normalizeExcludedHost(origin) ?? origin,
		settings: result.settings,
	};
}

async function removeExcludedOrigin(
	origin: string,
): Promise<ActionResult<'REMOVE_EXCLUDED_ORIGIN'>> {
	return mutate(async () => {
		const store = await getStore();
		const normalized = normalizeExcludedOrigins([origin])[0];
		if (!normalized || !store.settings.excludedOrigins.includes(normalized)) {
			return {ok: false, error: 'That website is not excluded.'};
		}

		store.settings.excludedOrigins = store.settings.excludedOrigins.filter(
			(entry) => entry !== normalized,
		);
		await writeStore(store);
		return {ok: true, settings: store.settings};
	});
}

async function updateBookmark(
	bookmarkId: string,
	fields: BookmarkFields = {},
): Promise<ActionResult<'UPDATE_BOOKMARK'>> {
	return mutateWithUndo('UPDATE_BOOKMARK', async () => {
		const {store, save} = await openStore({bookmarks: [bookmarkId]});
		const bookmark = findBookmark(store, bookmarkId);
		if (!bookmark) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		if (typeof fields.url === 'string') {
			const url = normalizeUrl(fields.url);
			if (!url) {
				return {ok: false, error: 'Enter a valid http or https address.'};
			}

			bookmark.url = url;
		}

		if (typeof fields.title === 'string') {
			bookmark.title = await bestBookmarkTitle(fields.title, bookmark.url);
		}

		if (typeof fields.columnId === 'string') {
			if (
				fields.columnId !== BOOKMARK_UNFILED_ID &&
				store.bookmarkColumns.every((column) => column.id !== fields.columnId)
			) {
				return {ok: false, error: 'Choose an existing bookmark column.'};
			}

			bookmark.columnId = fields.columnId;
		}

		if (typeof fields.notes === 'string') {
			const notes = bookmarkNotes(fields.notes);
			if (notes) {
				bookmark.notes = notes;
			} else {
				delete bookmark.notes;
			}
		}

		const saved = {...withTagEdits(bookmark, fields), updatedAt: Date.now()};
		store.bookmarks[store.bookmarks.indexOf(bookmark)] = saved;
		await save();
		return {ok: true, bookmark: saved};
	});
}

async function deleteBookmark(
	bookmarkId: string,
): Promise<ActionResult<'DELETE_BOOKMARK'>> {
	return mutate(async () => {
		const {store, save} = await openStore({bookmarks: 'all'});
		const index = store.bookmarks.findIndex(
			(bookmark) => bookmark.id === bookmarkId,
		);
		if (index === -1) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		const [removed] = store.bookmarks.splice(index, 1);
		const sameColumn = (bookmark: Bookmark | undefined) =>
			bookmark?.columnId === removed.columnId ? bookmark.id : null;
		const trashId = await trashAdd(store.settings, {
			kind: 'bookmark',
			label: removed.title || removed.url,
			origin:
				store.bookmarkColumns.find((column) => column.id === removed.columnId)
					?.name ?? 'Unfiled',
			count: 1,
			data: {
				bookmark: removed,
				columnId: removed.columnId,
				index,
				prevId: sameColumn(store.bookmarks[index - 1]),
				nextId: sameColumn(store.bookmarks[index]),
			},
		});
		await save();
		return {ok: true, trashId};
	});
}

async function removeDuplicateBookmarks(
	bookmarkIds: unknown,
): Promise<ActionResult<'REMOVE_DUPLICATE_BOOKMARKS'>> {
	if (
		!Array.isArray(bookmarkIds) ||
		bookmarkIds.length === 0 ||
		bookmarkIds.some((id) => typeof id !== 'string')
	) {
		return {ok: false, error: 'Choose the copies to remove.'};
	}

	if (bookmarkIds.length > TRASH_MAX_ITEMS) {
		return {
			ok: false,
			error: `Remove at most ${TRASH_MAX_ITEMS} copies at a time.`,
		};
	}

	const doomed = new Set<string>(bookmarkIds);
	if (doomed.size !== bookmarkIds.length) {
		return {ok: false, error: 'Those copies were listed more than once.'};
	}

	return mutate(async () => {
		const store = await getStore();
		const urlOf = (bookmark: Bookmark) =>
			normalizeUrl(bookmark.url) ?? bookmark.url;
		const kept = new Set<string>();
		let found = 0;
		for (const bookmark of store.bookmarks) {
			if (doomed.has(bookmark.id)) {
				found += 1;
			} else {
				kept.add(urlOf(bookmark));
			}
		}

		if (found !== doomed.size) {
			return {
				ok: false,
				error: 'Some of those bookmarks no longer exist. Check again.',
			};
		}

		if (
			store.bookmarks.some(
				(bookmark) => doomed.has(bookmark.id) && !kept.has(urlOf(bookmark)),
			)
		) {
			return {
				ok: false,
				error: 'That would remove every copy of an address. Check again.',
			};
		}

		const columnName = (columnId: string) =>
			store.bookmarkColumns.find((column) => column.id === columnId)?.name ??
			'Unfiled';
		const entries: Array<Omit<TrashEntry, 'id' | 'deletedAt'>> = [];
		for (const id of bookmarkIds) {
			const index = store.bookmarks.findIndex((bookmark) => bookmark.id === id);
			const [removed] = store.bookmarks.splice(index, 1);
			const before = store.bookmarks
				.slice(0, index)
				.findLast((bookmark) => bookmark.columnId === removed.columnId);
			const after = store.bookmarks
				.slice(index)
				.find((bookmark) => bookmark.columnId === removed.columnId);
			entries.push({
				kind: 'bookmark',
				label: removed.title || removed.url,
				origin: columnName(removed.columnId),
				count: 1,
				data: {
					bookmark: removed,
					columnId: removed.columnId,
					index,
					prevId: before?.id ?? null,
					nextId: after?.id ?? null,
				},
			});
		}

		const trashIds = await trashAddMany(store.settings, entries);
		await writeStore(store);
		return {ok: true, removed: trashIds.length, trashIds};
	});
}

async function createBookmarkColumn(
	name: string,
	icon?: unknown,
	color?: unknown,
	domains?: unknown,
): Promise<ActionResult<'CREATE_BOOKMARK_COLUMN'>> {
	return mutateWithUndo('CREATE_BOOKMARK_COLUMN', async () => {
		const {store, save} = await openStore({});
		const problem = columnNameProblem(store.bookmarkColumns, name);
		if (problem) {
			return {ok: false, error: problem};
		}

		const columnName = cleanColumnName(name);

		const column = {
			id: makeId(),
			name: columnName,
			...iconField(icon),
			...colorField(color),
			...domainsField(domains),
			createdAt: Date.now(),
			isDefault: false,
		};
		store.bookmarkColumns.push(column);
		await save();
		return {ok: true, column};
	});
}

async function updateBookmarkColumn(
	columnId: string,
	name: string,
	icon?: unknown,
	color?: unknown,
	domains?: unknown,
): Promise<ActionResult<'UPDATE_BOOKMARK_COLUMN'>> {
	return mutateWithUndo('UPDATE_BOOKMARK_COLUMN', async () => {
		const {store, save} = await openStore({});
		const column = store.bookmarkColumns.find((entry) => entry.id === columnId);
		if (!column) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		const problem = columnNameProblem(store.bookmarkColumns, name, columnId);
		if (problem) {
			return {ok: false, error: problem};
		}

		const columnName = cleanColumnName(name);

		column.name = columnName;
		if (icon !== undefined) {
			const {icon: nextIcon} = iconField(icon);
			if (nextIcon) {
				column.icon = nextIcon;
			} else {
				delete column.icon;
			}
		}

		if (color !== undefined) {
			const {color: nextColor} = colorField(color);
			if (nextColor) {
				column.color = nextColor;
			} else {
				delete column.color;
			}
		}

		if (domains !== undefined) {
			const {domains: nextDomains} = domainsField(domains);
			if (nextDomains) {
				column.domains = nextDomains;
			} else {
				delete column.domains;
			}
		}

		await save();
		return {ok: true, column};
	});
}

async function deleteBookmarkColumn(
	columnId: string,
	targetColumnId: string | null = null,
	discardBookmarks = false,
): Promise<ActionResult<'DELETE_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (store.bookmarkColumns.every((entry) => entry.id !== columnId)) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		const remaining = store.bookmarkColumns.filter(
			(entry) => entry.id !== columnId,
		);
		const affected = store.bookmarks.filter(
			(bookmark) => bookmark.columnId === columnId,
		);
		const columnEntry = store.bookmarkColumns.find(
			(entry) => entry.id === columnId,
		)!;
		const columnIndex = store.bookmarkColumns.indexOf(columnEntry);
		if (discardBookmarks) {
			if (
				affected.length >= BULK_DELETE_THRESHOLD &&
				!(await safetyBackup(store, 'Before deleting a bookmark column'))
			) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was changed.',
				};
			}

			const trashId = await trashAdd(store.settings, {
				kind: 'column',
				label: columnEntry.name,
				origin: '',
				count: affected.length,
				data: {
					column: columnEntry,
					index: columnIndex,
					bookmarks: affected,
					movedIds: [],
					movedTo: null,
				},
			});
			store.bookmarks = store.bookmarks.filter(
				(bookmark) => bookmark.columnId !== columnId,
			);
			store.bookmarkColumns = remaining;
			await writeStore(store);
			return {
				ok: true,
				moved: 0,
				unfiled: 0,
				deleted: affected.length,
				trashId,
			};
		}

		if (
			affected.length > 0 &&
			remaining.length > 0 &&
			remaining.every((entry) => entry.id !== targetColumnId) &&
			targetColumnId !== BOOKMARK_UNFILED_ID
		) {
			return {
				ok: false,
				error: 'Choose a remaining bookmark column to move these links into.',
			};
		}

		const movedTo =
			remaining.length > 0 ? targetColumnId! : BOOKMARK_UNFILED_ID;
		const trashId = await trashAdd(store.settings, {
			kind: 'column',
			label: columnEntry.name,
			origin: '',
			count: 0,
			data: {
				column: columnEntry,
				index: columnIndex,
				bookmarks: [],
				movedIds: affected.map((bookmark) => bookmark.id),
				movedTo,
			},
		});
		for (const bookmark of affected) {
			bookmark.columnId = movedTo;
		}

		const movedIds = new Set(affected.map((bookmark) => bookmark.id));
		store.bookmarks = [
			...store.bookmarks.filter((bookmark) => !movedIds.has(bookmark.id)),
			...affected,
		];
		store.bookmarkColumns = remaining;
		await writeStore(store);
		return {
			ok: true,
			moved: affected.length,
			unfiled: movedTo === BOOKMARK_UNFILED_ID ? affected.length : 0,
			deleted: 0,
			trashId,
		};
	});
}

async function reorderBookmarkColumn(
	columnId: string,
	targetColumnId: string,
	position: InsertPosition = 'before',
): Promise<ActionResult<'REORDER_BOOKMARK_COLUMN'>> {
	return mutateWithUndo('REORDER_BOOKMARK_COLUMN', async () => {
		const {store, save} = await openStore({});
		const sourceIndex = store.bookmarkColumns.findIndex(
			(column) => column.id === columnId,
		);
		if (sourceIndex === -1) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		if (store.bookmarkColumns.every((column) => column.id !== targetColumnId)) {
			return {
				ok: false,
				error: 'That target bookmark column no longer exists.',
			};
		}

		if (columnId === targetColumnId) {
			return {ok: true};
		}

		const [column] = store.bookmarkColumns.splice(sourceIndex, 1);
		const targetIndex = store.bookmarkColumns.findIndex(
			(entry) => entry.id === targetColumnId,
		);
		const insertAt =
			targetIndex === -1
				? store.bookmarkColumns.length
				: targetIndex + (position === 'after' ? 1 : 0);
		store.bookmarkColumns.splice(insertAt, 0, column);
		await save();
		return {ok: true};
	});
}

function placeBookmark(
	store: Store,
	bookmarkId: string,
	targetColumnId: string,
	targetBookmarkId: string | null,
	position: InsertPosition,
): string | undefined {
	const bookmark = findBookmark(store, bookmarkId);
	if (!bookmark) {
		return 'That bookmark no longer exists.';
	}

	const targetColumnExists = store.bookmarkColumns.some(
		(column) => column.id === targetColumnId,
	);
	if (!targetColumnExists && targetColumnId !== BOOKMARK_UNFILED_ID) {
		return 'Choose an existing bookmark column.';
	}

	if (targetBookmarkId === bookmarkId && bookmark.columnId === targetColumnId) {
		return undefined;
	}

	const targetItems = store.bookmarks.filter(
		(entry) => entry.columnId === targetColumnId && entry.id !== bookmarkId,
	);
	let insertAt = targetItems.length;
	const targetIndex = targetBookmarkId
		? targetItems.findIndex((entry) => entry.id === targetBookmarkId)
		: -1;
	if (targetIndex >= 0) {
		insertAt = targetIndex + (position === 'after' ? 1 : 0);
	}

	bookmark.columnId = targetColumnId;
	bookmark.updatedAt = Date.now();
	targetItems.splice(insertAt, 0, bookmark);
	const itemsByColumn = new Map<string, Bookmark[]>([
		...store.bookmarkColumns.map((column): [string, Bookmark[]] => [
			column.id,
			[],
		]),
		[BOOKMARK_UNFILED_ID, []],
	]);
	for (const entry of store.bookmarks) {
		if (entry.id === bookmarkId) {
			continue;
		}

		if (itemsByColumn.has(entry.columnId)) {
			itemsByColumn.get(entry.columnId)!.push(entry);
		}
	}

	itemsByColumn.set(targetColumnId, targetItems);
	store.bookmarks = [
		...store.bookmarkColumns.flatMap(
			(column) => itemsByColumn.get(column.id) || [],
		),
		...(itemsByColumn.get(BOOKMARK_UNFILED_ID) || []),
	];
	return undefined;
}

async function reorderBookmark(
	bookmarkIds: string[],
	targetColumnId: string,
	targetBookmarkId: string | null = null,
	position: InsertPosition = 'after',
): Promise<ActionResult<'REORDER_BOOKMARK'>> {
	return mutateWithUndo('REORDER_BOOKMARK', async () => {
		const {store, save} = await openStore({bookmarks: 'all'});
		for (const bookmarkId of bookmarkIds) {
			const problem = placeBookmark(
				store,
				bookmarkId,
				targetColumnId,
				targetBookmarkId,
				position,
			);
			if (problem) {
				return {ok: false, error: problem};
			}
		}

		await save();
		return {ok: true};
	});
}

function importCandidates(input: unknown): unknown[] {
	if (Array.isArray(input)) {
		return input.some((entry) => isRecord(entry) && Array.isArray(entry.tabs))
			? (input as unknown[])
			: [{name: 'Imported tabs', tabs: input}];
	}

	if (!isRecord(input)) {
		return [];
	}

	if (Array.isArray(input.groups)) {
		return input.groups;
	}

	if (Array.isArray(input.tabs)) {
		return [
			{
				name: input.groupName || input.listName || 'Imported tabs',
				tabs: input.tabs,
			},
		];
	}

	return [];
}

function mergeImportedFolders(
	store: Store,
	input: ImportInput,
	candidates: unknown[],
) {
	const incoming = folderEntriesWithArchive(input?.folders);
	const sourceById = new Map<string, Raw>(
		incoming
			.filter(
				(folder): folder is Raw & {id: string} =>
					isRecord(folder) && typeof folder.id === 'string',
			)
			.map((folder) => [folder.id, folder] as const),
	);
	const idMap = new Map<string, string>([
		[DEFAULT_FOLDER_ID, DEFAULT_FOLDER_ID],
	]);
	const folderByName = new Map(
		store.folders.map((folder) => [folder.name.toLocaleLowerCase(), folder]),
	);
	for (const source of incoming) {
		const folder = normalizeFolder(source);
		if (!folder || folder.isDefault) {
			if (recordId(source)) {
				idMap.set(recordId(source), DEFAULT_FOLDER_ID);
			}

			continue;
		}

		if (folder.name.toLocaleLowerCase() === 'all sessions') {
			if (recordId(source)) {
				idMap.set(recordId(source), DEFAULT_FOLDER_ID);
			}

			continue;
		}

		let target = folderByName.get(folder.name.toLocaleLowerCase());
		if (
			!target &&
			store.folders.filter((entry) => !isArchivedFolderName(entry.name))
				.length < MAX_FOLDERS
		) {
			target = {
				...folder,
				id: makeId(),
				createdAt: Date.now(),
				isDefault: false,
			};
			store.folders.push(target);
			folderByName.set(target.name.toLocaleLowerCase(), target);
		}

		if (recordId(source)) {
			idMap.set(recordId(source), target?.id || DEFAULT_FOLDER_ID);
		}
	}

	const archivedFolder = folderByName.get(
		ARCHIVED_FOLDER_NAME.toLocaleLowerCase(),
	);
	if (archivedFolder) {
		for (const id of archivedFolderIds(input?.folders)) {
			idMap.set(id, archivedFolder.id);
		}
	}

	for (const candidate of candidates) {
		if (!isRecord(candidate)) {
			continue;
		}

		const sourceId = cleanText(candidate.folderId, DEFAULT_FOLDER_ID, 100);
		if (idMap.has(sourceId)) {
			continue;
		}

		const source = sourceById.get(sourceId);
		const name = source ? normalizeFolder(source)!.name : '';
		const target = name ? folderByName.get(name.toLocaleLowerCase()) : null;
		idMap.set(sourceId, target?.id || DEFAULT_FOLDER_ID);
	}

	return idMap;
}

function importTargetColumn(
	store: Store,
	targetColumnId: unknown,
): string | null {
	if (typeof targetColumnId !== 'string' || !targetColumnId) {
		return null;
	}

	if (targetColumnId === BOOKMARK_UNFILED_ID) {
		return BOOKMARK_UNFILED_ID;
	}

	return store.bookmarkColumns.some((column) => column.id === targetColumnId)
		? targetColumnId
		: null;
}

async function mergeImportedBookmarks(
	store: Store,
	input: ImportInput,
	options: ImportOptions = {},
): Promise<BookmarkMergeResult> {
	const targetColumnId = importTargetColumn(store, options.targetColumnId);
	const incomingColumns = targetColumnId ? [] : arrayOf(input?.bookmarkColumns);
	const incomingBookmarks = arrayOf(input?.bookmarks);
	const openTitles = await openBookmarkTitleMap();
	const idMap = new Map<string, string>();
	const columnsByName = new Map(
		store.bookmarkColumns.map((column) => [
			column.name.toLocaleLowerCase(),
			column,
		]),
	);
	const importedColumnOrder: BookmarkColumn[] = [];
	const importedColumnIds = new Set<string>();
	let columnsAdded = 0;

	for (const raw of incomingColumns) {
		const source = normalizeBookmarkColumn(raw);
		if (!source) {
			continue;
		}

		const sourceColumn = isSourceColumnId(source.id);
		let target =
			source.id === DEFAULT_BOOKMARK_COLUMN_ID || source.isDefault
				? store.bookmarkColumns.find(
						(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
					)
				: sourceColumn
					? store.bookmarkColumns.find((column) => column.id === source.id)
					: columnsByName.get(source.name.toLocaleLowerCase());
		if (!target) {
			target = {
				...source,
				id: sourceColumn ? source.id : makeId(),
				createdAt: Date.now(),
				isDefault: false,
			};
			store.bookmarkColumns.push(target);
			columnsByName.set(target.name.toLocaleLowerCase(), target);
			columnsAdded += 1;
		}

		const rawId = isRecord(raw) ? raw.id : undefined;
		if (typeof rawId === 'string') {
			idMap.set(rawId, target.id);
		}

		if (importedColumnIds.has(target.id)) {
			continue;
		}

		importedColumnIds.add(target.id);
		importedColumnOrder.push(target);
	}

	const previousColumnOrder = store.bookmarkColumns.map((column) => column.id);
	if (importedColumnOrder.length > 0) {
		const importedIds = new Set(importedColumnOrder.map((column) => column.id));
		store.bookmarkColumns = [
			...importedColumnOrder,
			...store.bookmarkColumns.filter((column) => !importedIds.has(column.id)),
		];
	}

	const columnsReordered = previousColumnOrder.some(
		(id, index) => store.bookmarkColumns[index]?.id !== id,
	);
	const knownColumnIds = new Set(
		store.bookmarkColumns.map((column) => column.id),
	);
	const fallbackColumnId =
		store.bookmarkColumns.find(
			(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
		)?.id ||
		store.bookmarkColumns[0]?.id ||
		BOOKMARK_UNFILED_ID;
	const existingUrls = new Set([
		...store.bookmarks.map((bookmark) => bookmark.url),
		...(await trashedImportUrls(store.settings, 'bookmarks')),
	]);
	const existingBookmarks = new Map(
		store.bookmarks.map((bookmark) => [bookmark.url, bookmark]),
	);
	const allowDuplicates = options.duplicateMode === 'allow';
	const importedIds = new Set(store.bookmarks.map((bookmark) => bookmark.id));
	let bookmarksAdded = 0;
	let bookmarksSkipped = 0;
	let bookmarksUpdated = 0;
	for (const raw of incomingBookmarks) {
		if (!isRecord(raw)) {
			continue;
		}

		const sourceColumnId = cleanText(
			raw.columnId,
			DEFAULT_BOOKMARK_COLUMN_ID,
			100,
		);
		const mappedColumnId =
			targetColumnId ||
			idMap.get(sourceColumnId) ||
			(knownColumnIds.has(sourceColumnId) ? sourceColumnId : fallbackColumnId);
		const url = normalizeUrl(raw.url ?? raw.href);
		if (!url) {
			continue;
		}

		const bookmark = normalizeBookmark(
			{
				...raw,
				id: makeId(),
				title: importedBookmarkTitle(raw.title ?? raw.name, url, openTitles),
				url,
				columnId: mappedColumnId,
			},
			knownColumnIds,
		);
		if (!bookmark) {
			continue;
		}

		if (existingUrls.has(bookmark.url) && !allowDuplicates) {
			bookmarksSkipped += 1;
			const existing = existingBookmarks.get(bookmark.url);
			if (
				options.titlePolicy === 'latest' &&
				existing &&
				existing.title !== bookmark.title
			) {
				existing.title = bookmark.title;
				existing.updatedAt = Date.now();
				bookmarksUpdated += 1;
			}

			continue;
		}

		while (importedIds.has(bookmark.id)) {
			bookmark.id = makeId();
		}

		importedIds.add(bookmark.id);
		existingUrls.add(bookmark.url);
		existingBookmarks.set(bookmark.url, bookmark);
		store.bookmarks.push(bookmark);
		bookmarksAdded += 1;
	}

	return {
		columnsAdded,
		columnsReordered,
		bookmarksAdded,
		bookmarksSkipped,
		bookmarksUpdated,
	};
}

async function importGroups(
	input: ImportInput,
	importMode: 'all' | 'sessions' | 'bookmarks' = 'all',
	options: ImportOptions = {},
): Promise<ActionResult<'IMPORT_GROUPS'>> {
	return mutate(() =>
		withUndo('Import', [STORAGE_KEY], async () => {
			const store = await getStore();
			const candidates =
				importMode === 'bookmarks' ? [] : importCandidates(input);
			const hasBookmarkData =
				importMode !== 'sessions' &&
				(Array.isArray(input?.bookmarks) ||
					Array.isArray(input?.bookmarkColumns));
			if (candidates.length === 0 && !hasBookmarkData) {
				return {
					ok: false,
					error: `Choose a ${APP_NAME} export or a JSON array of tabs.`,
				};
			}

			const incomingItems =
				candidates.reduce<number>(
					(sum, candidate) =>
						sum +
						(isRecord(candidate) && Array.isArray(candidate.tabs)
							? candidate.tabs.length
							: 0),
					0,
				) +
				(hasBookmarkData && Array.isArray(input?.bookmarks)
					? input.bookmarks.length
					: 0);
			if (incomingItems > LARGE_IMPORT_THRESHOLD) {
				await safetyBackup(store, 'Before a large import');
			}

			const folderMap =
				candidates.length > 0
					? mergeImportedFolders(store, input, candidates)
					: new Map<string, string>();
			const existingUrls = new Set(
				await trashedImportUrls(store.settings, 'sessions'),
			);
			const existingRecords = new Map<
				string,
				{group: Session; tab: SavedTab}
			>();
			for (const group of store.groups) {
				for (const tab of group.tabs) {
					existingUrls.add(tab.url);
					existingRecords.set(tab.url, {group, tab});
				}
			}

			const imported: Session[] = [];
			const allowDuplicates = options.duplicateMode === 'allow';
			let skipped = 0;
			let updatedTitles = 0;
			const keepPinned =
				store.settings.includePinnedTabs ||
				(isRecord(input) && Array.isArray(input.groups));
			const parts = candidates.flatMap((candidate) => {
				if (
					!isRecord(candidate) ||
					!Array.isArray(candidate.tabs) ||
					candidate.tabs.length <= MAX_TABS_PER_SESSION
				) {
					return [candidate];
				}

				const count = chunkCount(candidate.tabs.length);
				const base = cleanText(
					candidate.name ?? candidate.title,
					'Saved session',
					100,
				);
				return Array.from({length: count}, (_, part) => ({
					...candidate,
					name: `${base} (${part + 1}/${count})`,
					tabs: (candidate.tabs as unknown[]).slice(
						part * MAX_TABS_PER_SESSION,
						(part + 1) * MAX_TABS_PER_SESSION,
					),
				}));
			});
			for (const candidate of parts) {
				if (!isRecord(candidate)) {
					continue;
				}

				const sourceFolderId = cleanText(
					candidate.folderId,
					DEFAULT_FOLDER_ID,
					100,
				);
				const group = normalizeGroup(
					{
						...candidate,
						id: makeId(),
						folderId: folderMap.get(sourceFolderId) || DEFAULT_FOLDER_ID,
						createdAt: candidate.createdAt ?? candidate.timestamp ?? Date.now(),
					},
					Date.now(),
					keepPinned,
				);
				if (!group) {
					continue;
				}

				if (
					candidate.archived === true &&
					group.folderId === DEFAULT_FOLDER_ID
				) {
					group.folderId = findOrAddArchivedFolder(store.folders).id;
				}

				if (!allowDuplicates) {
					const kept: SavedTab[] = [];
					for (const tab of group.tabs) {
						if (existingUrls.has(tab.url)) {
							skipped += 1;
							const existing = existingRecords.get(tab.url);
							if (
								options.titlePolicy === 'latest' &&
								existing &&
								tab.title !== existing.tab.title
							) {
								existing.tab.title = tab.title;
								existing.group.updatedAt = Date.now();
								updatedTitles += 1;
							}

							continue;
						}

						existingUrls.add(tab.url);
						existingRecords.set(tab.url, {group, tab});
						kept.push(tab);
					}

					group.tabs = kept;
				}

				if (group.tabs.length > 0) {
					imported.push(group);
				}
			}

			const bookmarkResult =
				importMode === 'sessions'
					? ({
							columnsAdded: 0,
							columnsReordered: false,
							bookmarksAdded: 0,
							bookmarksSkipped: 0,
							bookmarksUpdated: 0,
						} satisfies BookmarkMergeResult)
					: await mergeImportedBookmarks(store, input, options);
			const groupCount = imported.reduce(
				(sum, group) => sum + group.tabs.length,
				0,
			);
			if (
				imported.length === 0 &&
				!bookmarkResult.bookmarksAdded &&
				!bookmarkResult.bookmarksUpdated &&
				!bookmarkResult.columnsAdded &&
				!bookmarkResult.columnsReordered &&
				!updatedTitles
			) {
				return {
					ok: false,
					error:
						skipped || bookmarkResult.bookmarksSkipped
							? 'Every imported URL is already saved.'
							: 'The file contains no valid web tabs or bookmarks.',
				};
			}

			if (imported.length > 0) {
				store.groups = [...imported, ...store.groups];
			}

			if (store.groups.length > MAX_SESSIONS) {
				return {ok: false, error: sessionLimitError()};
			}

			await writeStore(store);
			return {
				ok: true,
				groups: imported.length,
				count: groupCount,
				bookmarks: bookmarkResult.bookmarksAdded,
				columns: bookmarkResult.columnsAdded,
				columnsReordered: bookmarkResult.columnsReordered,
				skipped: skipped + bookmarkResult.bookmarksSkipped,
				updatedTitles: updatedTitles + bookmarkResult.bookmarksUpdated,
			};
		}),
	);
}

async function updateSettings(
	patch: Partial<Settings>,
): Promise<ActionResult<'UPDATE_SETTINGS'>> {
	return mutate(async () => {
		const store = await getStore();
		const previousSettings = store.settings;
		const requested = {...store.settings, ...patch};
		store.settings = normalizeSettings(requested);
		await writeStore(store);
		await applySettingsChange(previousSettings, store);
		return {ok: true, settings: store.settings};
	});
}

async function applySettingsChange(previousSettings: Settings, store: Store) {
	if (previousSettings.actionMode !== store.settings.actionMode) {
		await syncToolbarAction(store.settings);
	}

	if (
		previousSettings.snapshotsEnabled !== store.settings.snapshotsEnabled ||
		previousSettings.snapshotIntervalMinutes !==
			store.settings.snapshotIntervalMinutes ||
		previousSettings.autoBackup !== store.settings.autoBackup ||
		previousSettings.autoArchiveDays !== store.settings.autoArchiveDays
	) {
		await syncRecoveryAlarms(store.settings);
		if (store.settings.snapshotsEnabled && !previousSettings.snapshotsEnabled) {
			scheduleSnapshot();
		}
	}

	if (store.settings.keepLodgePinned && !previousSettings.keepLodgePinned) {
		lodgePaused.clear();
		lodgeUndoneAt.clear();
		scheduleLodgeCheck();
	}

	const sessions = menuSessions(store.groups, store.folders);
	if (
		contextMenuSignature(previousSettings, store.bookmarkColumns, sessions) !==
		contextMenuSignature(store.settings, store.bookmarkColumns, sessions)
	) {
		await rebuildContextMenus(store);
	}
}

async function resetSettings(): Promise<ActionResult<'RESET_SETTINGS'>> {
	return mutate(() =>
		withUndo('Restore default settings', [STORAGE_KEY], async () => {
			const store = await getStore();
			store.settings = normalizeSettings({...DEFAULT_SETTINGS});
			await writeStore(store);
			await syncRecoveryAlarms(store.settings);
			await syncToolbarAction(store.settings);
			await rebuildContextMenus(store);
			return {ok: true, settings: store.settings};
		}),
	);
}

async function eraseData(
	scope: EraseScope,
): Promise<ActionResult<'ERASE_DATA'>> {
	if (!isOneOf(['sessions', 'bookmarks', 'all'], scope)) {
		return {ok: false, error: `Choose which ${APP_NAME} data to erase.`};
	}

	return mutate(() =>
		withUndo('Erase data', [STORAGE_KEY], async () => {
			const store = await getStore();
			const fresh = normalizeStore(null);
			const eraseSessions = scope !== 'bookmarks';
			const eraseBookmarks = scope !== 'sessions';
			const sessions = eraseSessions ? store.groups.length : 0;
			const bookmarks = eraseBookmarks ? store.bookmarks.length : 0;
			if (
				sessions + bookmarks > 0 &&
				!(await safetyBackup(store, 'Before erasing data'))
			) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was erased.',
				};
			}

			if (eraseSessions) {
				store.groups = fresh.groups;
				store.folders = fresh.folders;
			}

			if (eraseBookmarks) {
				store.bookmarks = fresh.bookmarks;
				store.bookmarkColumns = fresh.bookmarkColumns;
			}

			await writeStore(store);
			return {ok: true, sessions, bookmarks};
		}),
	);
}

const NEW_TAB_URL = /^(?:chrome|brave|edge):\/\/(?:newtab|new-tab-page)\/?$/;
const CLAIMS_KEY = 'newTabClaims';
const claimsMutate = serialQueue();
const privateNewTabRedirects = new Set<number>();

function redirectPrivateNewTab(
	tab: chrome.tabs.Tab,
	url = tab.pendingUrl || tab.url || '',
) {
	if (
		!privateContext ||
		!tab.incognito ||
		!isInteger(tab.id) ||
		!NEW_TAB_URL.test(url) ||
		privateNewTabRedirects.has(tab.id)
	) {
		return;
	}

	const tabId = tab.id;
	privateNewTabRedirects.add(tabId);
	void privateConfigReady.then(async () => {
		if (!privateConfig.redirectNewTabs) {
			return;
		}

		try {
			await chrome.tabs.update(tabId, {
				url: chrome.runtime.getURL('newtab.html'),
			});
		} catch {}
	});
}

async function readClaims(): Promise<Record<string, number>> {
	try {
		const stored = await chrome.storage.session?.get(CLAIMS_KEY);
		return (stored?.[CLAIMS_KEY] as Record<string, number> | undefined) ?? {};
	} catch {
		return {};
	}
}

async function writeClaims(claims: Record<string, number>): Promise<void> {
	try {
		await chrome.storage.session?.set({[CLAIMS_KEY]: claims});
	} catch {}
}

function newTabTarget(
	settings: Pick<Settings, 'newTabFallback' | 'newTabFallbackUrl'>,
	attempt: number,
	brave: boolean,
): string {
	if (attempt > 1 || settings.newTabFallback === 'blank') {
		return 'about:blank';
	}

	if (settings.newTabFallback === 'custom' && settings.newTabFallbackUrl) {
		return settings.newTabFallbackUrl;
	}

	return brave ? 'brave://newtab/' : 'chrome://new-tab-page/';
}

const looksLikeBrave = () => {
	const brands = (
		globalThis as {
			navigator?: {userAgentData?: {brands?: Array<{brand: string}>}};
		}
	).navigator?.userAgentData?.brands;
	return Boolean(brands?.some((entry) => /brave/i.test(entry.brand)));
};

async function handOffNewTab(
	tabId: number,
	brave: boolean,
	claim: boolean,
): Promise<boolean> {
	const settings = await readSettings();
	if (settings.newTabEnabled) {
		return false;
	}

	const done = await claimsMutate(async () => {
		const claims = await readClaims();
		const previous = claims[tabId];
		if ((previous === undefined && !claim) || (previous ?? 0) >= 3) {
			return null;
		}

		claims[tabId] = (previous ?? 0) + 1;
		await writeClaims(claims);
		return previous ?? 0;
	});
	if (done === null) {
		return false;
	}

	try {
		await chrome.tabs.update(tabId, {
			url: newTabTarget(settings, done, brave || looksLikeBrave()),
		});
		return true;
	} catch {
		return false;
	}
}

chrome.tabs.onCreated?.addListener((tab) => {
	redirectPrivateNewTab(tab);
	if (
		isInteger(tab.id) &&
		NEW_TAB_URL.test(tab.pendingUrl || tab.url || '') &&
		!privateContext
	) {
		void handOffNewTab(tab.id, false, true);
	}
});
chrome.tabs.onUpdated?.addListener((_tabId, change, tab) => {
	redirectPrivateNewTab(tab, change.url);
});

let siteIconWrites: Promise<unknown> = Promise.resolve();

const loadSiteIcons = async () => {
	const saved = await chrome.storage.local.get([
		SITE_ICONS_KEY,
		MISSING_ICONS_KEY,
	]);
	return {
		icons: normalizeSiteIcons(saved[SITE_ICONS_KEY]),
		missing: normalizeMissingIcons(saved[MISSING_ICONS_KEY]),
	};
};

async function siteIconServer() {
	if (privateContext && privateConfig.mode !== 'shared') {
		return undefined;
	}

	const target = await regularSyncConfig();
	return target && (await getStore()).settings.siteIcons === 'server'
		? target
		: undefined;
}

async function shrinkIcon(image: Blob) {
	try {
		const bitmap = await createImageBitmap(image, {
			resizeWidth: 32,
			resizeHeight: 32,
			resizeQuality: 'high',
		});
		const canvas = new OffscreenCanvas(32, 32);
		canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
		bitmap.close();
		const png = await canvas.convertToBlob({type: 'image/png'});
		return imageDataAddress(new Uint8Array(await png.arrayBuffer()), png.type);
	} catch {
		return undefined;
	}
}

const serverIcons = createServerIcons({
	fetch: async (...request) => fetch(...request),
	server: siteIconServer,
	load: loadSiteIcons,
	async save(host, icon) {
		const write = siteIconWrites.then(async () => {
			const stored = await loadSiteIcons();
			const next = rememberServerAnswer(stored, host, icon, Date.now());
			await chrome.storage.local.set({
				[SITE_ICONS_KEY]: next.icons,
				[MISSING_ICONS_KEY]: next.missing,
			});
		});
		siteIconWrites = write.catch(() => undefined);
		await write;
	},
	shrink: shrinkIcon,
	now: Date.now,
});
chrome.tabs.onUpdated?.addListener((_tabId, change, tab) => {
	if (!IS_FIREFOX || !change.favIconUrl || tab.incognito || !tab.url) {
		return;
	}

	const {url, favIconUrl} = tab;
	siteIconWrites = siteIconWrites
		.then(async () => {
			const saved = await chrome.storage.local.get([SITE_ICONS_KEY]);
			const icons = normalizeSiteIcons(saved[SITE_ICONS_KEY]);
			const next = rememberSiteIcon(icons, url, favIconUrl);
			if (next !== icons) {
				await chrome.storage.local.set({[SITE_ICONS_KEY]: next});
			}
		})
		.catch(() => undefined);
});
chrome.tabs.onRemoved?.addListener((tabId) => {
	privateNewTabRedirects.delete(tabId);
	void claimsMutate(async () => {
		const claims = await readClaims();
		const {[String(tabId)]: gone, ...rest} = claims;
		if (gone !== undefined) {
			await writeClaims(rest);
		}
	});
});

const SNAPSHOTS_KEY = 'tablodge.snapshots';
const SNAPSHOT_LIVE_KEY = 'tablodge.snapshots.live';
const SNAPSHOT_META_KEY = 'tablodge.snapshots.meta';
const BACKUPS_KEY = 'tablodge.backups';
const TRASH_KEY = 'tablodge.trash';
const SNAPSHOT_DEBOUNCE_MS = 5000;
const SNAPSHOT_MAX_WAIT_MS = 30_000;
const SNAPSHOT_MAX_CHARS = 24_000_000;
const MIN_RECOVERY_TABS = 2;
const ALREADY_OPEN_RATIO = 0.8;
const ALARM_SNAPSHOT = 'tablodge-snapshot';
const ALARM_BACKUP = 'tablodge-backup';
const ALARM_TRASH = 'tablodge-trash';
const ALARM_ARCHIVE = 'tablodge-archive';
const SAFETY_BACKUP_KEEP = 5;
const BACKUP_MAX_CHARS = 40_000_000;
const DOWNLOAD_MAX_URL_CHARS = 2_000_000;
const TRASH_MAX_ITEMS = 500;
const TRASH_MAX_CHARS = 8_000_000;
const BULK_DELETE_THRESHOLD = 10;
const LARGE_IMPORT_THRESHOLD = 50;
const DAY_MS = 86_400_000;

type SnapshotTab = import('../src/shared/types').SnapshotTab;
type SnapshotGroup = import('../src/shared/types').SnapshotGroup;
type SnapshotWindow = import('../src/shared/types').SnapshotWindow;
type SnapshotReason = import('../src/shared/types').SnapshotReason;
type Snapshot = import('../src/shared/types').Snapshot;
type SnapshotSummary = import('../src/shared/types').SnapshotSummary;
type RecoveryInfo = import('../src/shared/types').RecoveryInfo;
type BackupKind = import('../src/shared/types').BackupKind;
type BackupSummary = import('../src/shared/types').BackupSummary;
type TrashSummary = import('../src/shared/types').TrashSummary;
type StorageUsage = import('../src/shared/types').StorageUsage;

function serialQueue() {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(operation: () => Promise<T>): Promise<T> => {
		const run = () => withSharedLibraryLock(operation);
		const result = tail.then(run, run);
		tail = result.catch(() => undefined);
		return result;
	};
}

const snapshotMutate = serialQueue();
const backupMutate = serialQueue();
const trashMutate = serialQueue();

const pad2 = (value: number) => String(value).padStart(2, '0');
const localDate = (time: number) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const localDateTime = (time: number) => {
	const date = new Date(time);
	return `${localDate(time)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

async function readKey<T>(key: string): Promise<T | undefined> {
	const saved = await library.get<Record<string, T | undefined>>([key]);
	return saved[key];
}

let settingsCache: Settings | undefined;
let settingsGeneration = 0;
let omniboxStore: Promise<Store> | undefined;

function invalidateSettings() {
	omniboxStore = undefined;
	settingsCache = undefined;
	settingsGeneration += 1;
}

onLibraryChanged((changes, areaName) => {
	if (areaName === 'local' && changes[STORAGE_KEY] !== undefined) {
		invalidateSettings();
	}
});

async function readSettings(): Promise<Settings> {
	if (settingsCache) {
		return settingsCache;
	}

	const generation = settingsGeneration;
	const meta = await libraryState.readMeta();
	if (
		meta.layout === 'records' &&
		meta.schemaVersion === SCHEMA_VERSION &&
		!meta.upgradable
	) {
		migrationChecked = true;
	}

	const settings = normalizeSettings(meta.settings as RawSettings | undefined);
	if (generation === settingsGeneration) {
		settingsCache = settings;
	}

	return settings;
}

type SnapshotMeta = {
	sessionOpen: boolean;
	liveAt: number;
	liveSig: string;
	closing: {at: number; remaining: number} | null;
	recovery: {snapshotId: string; detectedAt: number} | null;
};

const isSnapshot = (value: unknown): value is Snapshot =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	Array.isArray(value.windows) &&
	Number.isFinite(Number(value.at));

async function readSnapshotHistory(): Promise<Snapshot[]> {
	const raw = await readKey<Raw>(SNAPSHOTS_KEY);
	return Array.isArray(raw?.history) ? raw.history.filter(isSnapshot) : [];
}

async function writeSnapshotHistory(history: Snapshot[]) {
	await library.set({[SNAPSHOTS_KEY]: {version: 1, history}});
}

async function readSnapshotMeta(): Promise<SnapshotMeta> {
	const raw = await readKey<Raw>(SNAPSHOT_META_KEY);
	const closing = isRecord(raw?.closing) ? raw.closing : null;
	const recovery = isRecord(raw?.recovery) ? raw.recovery : null;
	return {
		sessionOpen: raw?.sessionOpen === true,
		liveAt: Number(raw?.liveAt) || 0,
		liveSig: typeof raw?.liveSig === 'string' ? raw.liveSig : '',
		closing: closing
			? {at: Number(closing.at) || 0, remaining: Number(closing.remaining) || 0}
			: null,
		recovery:
			recovery && typeof recovery.snapshotId === 'string'
				? {
						snapshotId: recovery.snapshotId,
						detectedAt: Number(recovery.detectedAt) || 0,
					}
				: null,
	};
}

async function writeSnapshotMeta(meta: SnapshotMeta) {
	await library.set({[SNAPSHOT_META_KEY]: meta});
}

async function readLiveSnapshot(): Promise<Snapshot | null> {
	const raw = await readKey<unknown>(SNAPSHOT_LIVE_KEY);
	return isSnapshot(raw) ? raw : null;
}

async function captureSnapshotWindows(
	settings: Settings,
): Promise<SnapshotWindow[]> {
	let windows: chrome.windows.Window[];
	try {
		windows = await chrome.windows.getAll({
			populate: true,
			windowTypes: ['normal'],
		});
	} catch {
		return [];
	}

	const groupInfo = new Map<number, SnapshotGroup>();
	try {
		for (const group of await chrome.tabGroups.query({})) {
			groupInfo.set(group.id, {
				title: cleanText(group.title, '', 100),
				color: isGroupColor(group.color) ? group.color : 'grey',
				collapsed: Boolean(group.collapsed),
			});
		}
	} catch {}

	const result: SnapshotWindow[] = [];
	for (const win of windows) {
		if (win.incognito || !Array.isArray(win.tabs)) {
			continue;
		}

		const groups: SnapshotGroup[] = [];
		const groupIndex = new Map<number, number>();
		const splitSlots = new Map<number, number[]>();
		const tabs: SnapshotTab[] = [];
		for (const tab of win.tabs.toSorted((a, b) => a.index - b.index)) {
			const url = normalizeUrl(tab.url || tab.pendingUrl);
			if (!url || !isCapturable({url} as chrome.tabs.Tab, settings)) {
				continue;
			}

			const entry: SnapshotTab = {
				url,
				title: pageTitle(tab.title, url, settings.cleanTitles, 200),
			};
			if (tab.pinned) {
				entry.pinned = true;
			}

			if (tab.active) {
				entry.active = true;
			}

			if (
				!settings.ignoreTabGroups &&
				!tab.pinned &&
				isInteger(tab.groupId) &&
				tab.groupId >= 0
			) {
				let index = groupIndex.get(tab.groupId);
				const info = groupInfo.get(tab.groupId);
				if (index === undefined && info) {
					groups.push(info);
					index = groups.length - 1;
					groupIndex.set(tab.groupId, index);
				}

				if (index !== undefined) {
					entry.group = index;
				}
			}

			const splitView = splitViewOf(tab);
			if (splitView !== null) {
				splitSlots.set(splitView, [
					...(splitSlots.get(splitView) ?? []),
					tabs.length,
				]);
			}

			tabs.push(entry);
		}

		for (const [splitView, slots] of splitSlots) {
			if (!(slots.length === 2 && slots[1] === slots[0] + 1)) {
				continue;
			}

			tabs[slots[0]].split = {id: String(splitView), position: 0};
			tabs[slots[1]].split = {id: String(splitView), position: 1};
		}

		if (tabs.length > 0) {
			result.push({
				focused: Boolean(win.focused),
				state: typeof win.state === 'string' ? win.state : 'normal',
				groups,
				tabs,
			});
		}
	}

	return result;
}

const countTabs = (windows: readonly SnapshotWindow[]) =>
	windows.reduce((sum, win) => sum + win.tabs.length, 0);

function summarizeSnapshot(snapshot: Snapshot): SnapshotSummary {
	return {
		id: snapshot.id,
		at: Number(snapshot.at),
		reason: snapshot.reason,
		tabs: countTabs(snapshot.windows),
		windows: snapshot.windows.map((win) => ({
			tabs: win.tabs.length,
			pinned: win.tabs.filter((tab) => tab.pinned).length,
			groups: win.groups.length,
			focused: Boolean(win.focused),
			titles: win.tabs.slice(0, 3).map((tab) => tab.title),
		})),
	};
}

function newSnapshot(
	windows: SnapshotWindow[],
	reason: SnapshotReason,
): Snapshot {
	const text = JSON.stringify(windows);
	return {
		id: makeId(),
		at: Date.now(),
		reason,
		sig: hashText(text),
		size: text.length,
		windows,
	};
}

function trimHistory(history: Snapshot[], keep: number): Snapshot[] {
	const result: Snapshot[] = [];
	let total = 0;
	for (const snapshot of history.slice(0, keep)) {
		total += Number(snapshot.size) || 0;
		if (result.length > 0 && total > SNAPSHOT_MAX_CHARS) {
			break;
		}

		result.push(snapshot);
	}

	return result;
}

function takeSnapshot(
	reason: SnapshotReason,
	rotate: boolean,
	force = false,
): Promise<Snapshot | null> {
	if (privateContext) {
		return Promise.resolve(null);
	}

	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled && !force) {
			return null;
		}

		const windows = await captureSnapshotWindows(settings);
		if (windows.length === 0) {
			return null;
		}

		const snapshot = newSnapshot(windows, reason);
		const meta = await readSnapshotMeta();
		const liveSig = meta.liveSig || (await readLiveSnapshot())?.sig;
		if (liveSig !== snapshot.sig) {
			await library.set({[SNAPSHOT_LIVE_KEY]: snapshot});
		}

		meta.liveSig = snapshot.sig;
		meta.sessionOpen = true;
		meta.liveAt = Date.now();
		meta.closing = null;
		await writeSnapshotMeta(meta);
		if (rotate) {
			const history = await readSnapshotHistory();
			if (history[0]?.sig !== snapshot.sig) {
				await writeSnapshotHistory(
					trimHistory([snapshot, ...history], settings.snapshotKeep),
				);
			}
		}

		return snapshot;
	});
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let snapshotFirstEventAt = 0;
function scheduleSnapshot() {
	if (settingsCache && !settingsCache.snapshotsEnabled) {
		return;
	}

	const now = Date.now();
	if (snapshotTimer === undefined) {
		snapshotFirstEventAt = now;
	} else {
		clearTimeout(snapshotTimer);
	}

	const delay = Math.max(
		0,
		Math.min(
			SNAPSHOT_DEBOUNCE_MS,
			snapshotFirstEventAt + SNAPSHOT_MAX_WAIT_MS - now,
		),
	);
	snapshotTimer = setTimeout(() => {
		snapshotTimer = undefined;
		void takeSnapshot('interval', false).catch(() => undefined);
	}, delay);
}

async function rotateLiveIntoHistory(
	reason: SnapshotReason,
	keep: number,
): Promise<Snapshot | null> {
	const live = await readLiveSnapshot();
	if (!live) {
		return null;
	}

	const history = await readSnapshotHistory();
	if (history[0]?.sig === live.sig) {
		if (reason === 'crash' && history[0].reason !== 'crash') {
			history[0] = {...history[0], reason};
			await writeSnapshotHistory(history);
		}

		return history[0];
	}

	const entry: Snapshot = {...live, id: makeId(), reason};
	await writeSnapshotHistory(trimHistory([entry, ...history], keep));
	return entry;
}

function evaluateStartup(): Promise<void> {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled) {
			return;
		}

		const meta = await readSnapshotMeta();
		const live = await readLiveSnapshot();
		const shuttingDown = Boolean(
			meta.closing &&
			meta.closing.at >= meta.liveAt &&
			meta.closing.remaining <= 1,
		);
		const crashed = meta.sessionOpen && !shuttingDown;
		if (live) {
			const entry = await rotateLiveIntoHistory(
				crashed ? 'crash' : 'exit',
				settings.snapshotKeep,
			);
			meta.recovery =
				crashed && entry && countTabs(entry.windows) >= MIN_RECOVERY_TABS
					? {snapshotId: entry.id, detectedAt: Date.now()}
					: null;
		} else {
			meta.recovery = null;
		}

		let hasWindow = true;
		try {
			hasWindow = (await chrome.windows.getAll({windowTypes: ['normal']})).some(
				(win) => !win.incognito,
			);
		} catch {}

		meta.sessionOpen = hasWindow;
		meta.closing = null;
		await writeSnapshotMeta(meta);
	});
}

function handleWindowRemoved() {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled) {
			return;
		}

		let remaining: number;
		try {
			remaining = (
				await chrome.windows.getAll({windowTypes: ['normal']})
			).filter((win) => !win.incognito).length;
		} catch {
			return;
		}

		const meta = await readSnapshotMeta();
		if (remaining > 0) {
			meta.closing = {at: Date.now(), remaining};
			await writeSnapshotMeta(meta);
			scheduleSnapshot();
			return;
		}

		meta.sessionOpen = false;
		meta.closing = null;
		await writeSnapshotMeta(meta);
		await rotateLiveIntoHistory('exit', settings.snapshotKeep);
	});
}

async function openUrlSet(): Promise<Set<string>> {
	const urls = new Set<string>();
	try {
		for (const tab of await chrome.tabs.query({})) {
			const url = normalizeUrl(tab.url);
			if (url) {
				urls.add(url);
			}
		}
	} catch {}

	return urls;
}

function privateSnapshotsError(): {ok: false; error: string} {
	return {ok: false, error: 'Private windows do not use snapshots.'};
}

async function getSnapshots(): Promise<ActionResult<'GET_SNAPSHOTS'>> {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		const history = await readSnapshotHistory();
		const live = await readLiveSnapshot();
		const meta = await readSnapshotMeta();
		let recovery: RecoveryInfo | null = null;
		const pending = meta.recovery
			? history.find((entry) => entry.id === meta.recovery!.snapshotId)
			: undefined;
		if (meta.recovery && !pending) {
			meta.recovery = null;
			await writeSnapshotMeta(meta);
		}

		if (meta.recovery && pending) {
			const open = await openUrlSet();
			const urls = pending.windows.flatMap((win) =>
				win.tabs.map((tab) => tab.url),
			);
			const already = urls.filter((url) => open.has(url)).length;
			if (urls.length > 0 && already / urls.length >= ALREADY_OPEN_RATIO) {
				meta.recovery = null;
				await writeSnapshotMeta(meta);
			} else {
				recovery = {
					snapshotId: pending.id,
					at: Number(pending.at),
					windows: pending.windows.length,
					tabs: countTabs(pending.windows),
				};
			}
		}

		return {
			ok: true,
			enabled: settings.snapshotsEnabled,
			snapshots: history.map((entry) => summarizeSnapshot(entry)),
			live: live ? summarizeSnapshot(live) : null,
			recovery,
		};
	});
}

function snapshotRecords(win: SnapshotWindow, stamp: number): SavedTab[] {
	return win.tabs.map((tab, index) => {
		const group =
			tab.group === undefined || tab.pinned ? undefined : win.groups[tab.group];
		return {
			id: makeId(),
			title: tab.title,
			url: tab.url,
			notes: '',
			pinned: Boolean(tab.pinned),
			nativeGroup: group
				? {
						key: `snapshot-${tab.group}`,
						title: group.title,
						color: group.color,
						collapsed: group.collapsed,
					}
				: null,
			savedAt: stamp,
			originalIndex: index,
			...(tab.split && {split: {...tab.split}}),
		};
	});
}

function pickSnapshotWindows(
	snapshot: Snapshot,
	windowIndex: number | undefined,
): SnapshotWindow[] | null {
	if (windowIndex === undefined) {
		return snapshot.windows;
	}

	const win = isInteger(windowIndex)
		? snapshot.windows[windowIndex]
		: undefined;
	return win ? [win] : null;
}

async function findSnapshot(id: string): Promise<Snapshot | null> {
	return id === 'live'
		? readLiveSnapshot()
		: ((await readSnapshotHistory()).find((entry) => entry.id === id) ?? null);
}

async function restoreSnapshot(
	id: string,
	windowIndex?: number,
): Promise<ActionResult<'RESTORE_SNAPSHOT'>> {
	const store = await getStore();
	const snapshot = await findSnapshot(id);
	if (!snapshot) {
		return {ok: false, error: 'That snapshot no longer exists.'};
	}

	const windows = pickSnapshotWindows(snapshot, windowIndex);
	if (!windows) {
		return {ok: false, error: 'That window is not in the snapshot.'};
	}

	const settings: Settings = {
		...store.settings,
		restoreDuplicateHandling: 'open',
	};
	let count = 0;
	let failed = 0;
	let restoredWindows = 0;
	let focusId: number | null = null;
	const tabIds: number[] = [];
	for (const win of windows) {
		const records = snapshotRecords(win, Date.now());
		const activeIndex = win.tabs.findIndex((tab) => tab.active);
		const target = await createRestoreWindow();
		const result = await restoreRecords(records, settings, undefined, {
			target,
			activeSavedId: records[Math.max(0, activeIndex)]?.id,
		});
		count += result.opened.length;
		failed += result.failures.length;
		for (const {tabId} of result.opened) {
			if (isInteger(tabId)) {
				tabIds.push(tabId);
			}
		}

		if (result.opened.length === 0) {
			if (isInteger(target.id)) {
				await chrome.windows.remove?.(target.id).catch(() => undefined);
			}

			continue;
		}

		restoredWindows += 1;
		if (win.state === 'maximized' && isInteger(target.id)) {
			await chrome.windows
				.update(target.id, {state: 'maximized'})
				.catch(() => undefined);
		}

		if (win.focused || focusId === null) {
			focusId = target.id ?? focusId;
		}
	}

	if (restoredWindows === 0) {
		return {ok: false, error: 'No tabs in that snapshot could be opened.'};
	}

	if (focusId !== null) {
		await chrome.windows
			.update(focusId, {focused: true})
			.catch(() => undefined);
	}

	if (windowIndex === undefined) {
		await snapshotMutate(async () => {
			const meta = await readSnapshotMeta();
			if (meta.recovery?.snapshotId !== id) {
				return;
			}

			meta.recovery = null;
			await writeSnapshotMeta(meta);
		});
	}

	return {ok: true, windows: restoredWindows, count, failed, tabIds};
}

async function saveSnapshotAsSession(
	id: string,
	windowIndex?: number,
): Promise<ActionResult<'SAVE_SNAPSHOT_AS_SESSION'>> {
	return mutate(async () => {
		const store = await getStore();
		const snapshot = await findSnapshot(id);
		if (!snapshot) {
			return {ok: false, error: 'That snapshot no longer exists.'};
		}

		const windows = pickSnapshotWindows(snapshot, windowIndex);
		if (!windows) {
			return {ok: false, error: 'That window is not in the snapshot.'};
		}

		const stamp = Date.now();
		const created: Session[] = [];
		for (const [offset, win] of windows.entries()) {
			const number_ = (windowIndex ?? offset) + 1;
			const records = snapshotRecords(win, stamp);
			for (
				let start = 0;
				start < records.length;
				start += MAX_TABS_PER_SESSION
			) {
				const part = Math.floor(start / MAX_TABS_PER_SESSION) + 1;
				const parts = chunkCount(records.length);
				const group = normalizeGroup(
					{
						id: makeId(),
						name: `Snapshot ${localDateTime(Number(snapshot.at))} · window ${number_}${parts > 1 ? ` (${part}/${parts})` : ''}`,
						folderId: DEFAULT_FOLDER_ID,
						createdAt: stamp,
						updatedAt: stamp,
						tabs: records.slice(start, start + MAX_TABS_PER_SESSION),
					},
					stamp,
					true,
				);
				if (group) {
					created.push(group);
				}
			}
		}

		if (created.length === 0) {
			return {ok: false, error: 'That snapshot has no tabs to save.'};
		}

		if (store.groups.length + created.length > MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		store.groups = [...created, ...store.groups];
		await writeStore(store);
		return {
			ok: true,
			groups: created.length,
			count: created.reduce((sum, group) => sum + group.tabs.length, 0),
		};
	});
}

function deleteSnapshot(id: string): Promise<ActionResult<'DELETE_SNAPSHOT'>> {
	return snapshotMutate(() =>
		withUndo('Delete snapshot', [SNAPSHOTS_KEY], async () => {
			const history = await readSnapshotHistory();
			const next = history.filter((entry) => entry.id !== id);
			if (next.length === history.length) {
				return {ok: false, error: 'That snapshot no longer exists.'};
			}

			await writeSnapshotHistory(next);
			const meta = await readSnapshotMeta();
			if (meta.recovery?.snapshotId === id) {
				meta.recovery = null;
				await writeSnapshotMeta(meta);
			}

			return {ok: true};
		}),
	);
}

async function emptySnapshots(): Promise<number> {
	const history = await readSnapshotHistory();
	await writeSnapshotHistory([]);
	await library.remove(SNAPSHOT_LIVE_KEY);
	const meta = await readSnapshotMeta();
	meta.liveSig = '';
	meta.recovery = null;
	await writeSnapshotMeta(meta);
	return history.length;
}

function clearSnapshots(): Promise<ActionResult<'CLEAR_SNAPSHOTS'>> {
	return snapshotMutate(() =>
		withUndo('Clear snapshots', [SNAPSHOTS_KEY], async () => ({
			ok: true,
			count: await emptySnapshots(),
		})),
	);
}

function dismissRecovery(): Promise<ActionResult<'DISMISS_RECOVERY'>> {
	return snapshotMutate(async () => {
		const meta = await readSnapshotMeta();
		if (meta.recovery) {
			meta.recovery = null;
			await writeSnapshotMeta(meta);
		}

		return {ok: true};
	});
}

type BackupRecord = BackupSummary & {sig: string; json: string};
type BackupStore = {
	auto: BackupRecord[];
	safety: BackupRecord[];
	downloadError: string;
	lastAutoCheckAt: number;
};
const MANUAL_BACKUP_KEEP = 10;

const isBackupRecord = (value: unknown): value is BackupRecord =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.json === 'string';

async function readBackups(): Promise<BackupStore> {
	const raw = await readKey<Raw>(BACKUPS_KEY);
	return {
		auto: Array.isArray(raw?.auto) ? raw.auto.filter(isBackupRecord) : [],
		safety: Array.isArray(raw?.safety) ? raw.safety.filter(isBackupRecord) : [],
		downloadError:
			typeof raw?.downloadError === 'string' ? raw.downloadError : '',
		lastAutoCheckAt: isInteger(raw?.lastAutoCheckAt) ? raw.lastAutoCheckAt : 0,
	};
}

async function writeBackups(backups: BackupStore) {
	await library.set({[BACKUPS_KEY]: {version: 1, ...backups}});
}

const summarizeBackup = (record: BackupRecord): BackupSummary => ({
	id: record.id,
	at: Number(record.at),
	kind: record.kind,
	reason: record.reason,
	sessions: record.sessions,
	tabs: record.tabs,
	bookmarks: record.bookmarks,
	bytes: record.bytes,
});

function backupJson(store: Store, at: number): string {
	return JSON.stringify({
		format: BACKUP_FORMAT_ID,
		version: BACKUP_VERSION,
		exportedAt: new Date(at).toISOString(),
		folders: store.folders,
		groups: store.groups,
		bookmarkColumns: store.bookmarkColumns,
		bookmarks: store.bookmarks,
		settings: store.settings,
	});
}

const dataSignature = (store: Store) =>
	hashText(
		JSON.stringify([
			store.groups,
			store.folders,
			store.bookmarkColumns,
			store.bookmarks,
		]),
	);

const storeIsEmpty = (store: Store) =>
	store.groups.length === 0 && store.bookmarks.length === 0;

function trimBackups(records: BackupRecord[], keep: number): BackupRecord[] {
	const result: BackupRecord[] = [];
	let total = 0;
	for (const record of records.slice(0, keep)) {
		total += record.bytes;
		if (result.length > 0 && total > BACKUP_MAX_CHARS) {
			break;
		}

		result.push(record);
	}

	return result;
}

function makeBackupRecord(
	store: Store,
	kind: BackupKind,
	reason: string,
): BackupRecord {
	const at = Date.now();
	const json = backupJson(store, at);
	return {
		id: makeId(),
		at,
		kind,
		reason,
		sessions: store.groups.length,
		tabs: store.groups.reduce((sum, group) => sum + group.tabs.length, 0),
		bookmarks: store.bookmarks.length,
		bytes: json.length,
		sig: dataSignature(store),
		json,
	};
}

function utf8Base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x80_00) {
		binary += String.fromCodePoint(...bytes.subarray(index, index + 0x80_00));
	}

	// eslint-disable-next-line no-restricted-globals -- Uint8Array.prototype.toBase64 is not available in Chromium yet
	return btoa(binary);
}

async function downloadBackupCopy(record: BackupRecord): Promise<string> {
	try {
		const granted = await chrome.permissions?.contains?.({
			permissions: ['downloads'],
		});
		if (!granted || !chrome.downloads?.download) {
			return 'The Downloads permission was not granted.';
		}

		const url = `data:application/json;base64,${utf8Base64(record.json)}`;
		if (url.length > DOWNLOAD_MAX_URL_CHARS) {
			return 'This backup is too large for a Downloads copy. Use Download in the backup list instead.';
		}

		await chrome.downloads.download({
			url,
			filename: `${APP_NAME}/${backupFileName(record.at)}`,
			conflictAction: 'uniquify',
			saveAs: false,
		});
		return '';
	} catch (error) {
		return cleanText(errorMessage(error), 'The download failed.', 200);
	}
}

const backupFileName = (at: number) =>
	`${APP_NAME.toLowerCase().replaceAll(/[^0-9a-z]+/g, '-')}-backup-${localDate(at)}.json`;

function addBackup(
	store: Store,
	kind: 'auto' | 'manual',
	force: boolean,
): Promise<BackupRecord | null> {
	return backupMutate(async () => {
		const backups = await readBackups();
		if (kind === 'auto') {
			backups.lastAutoCheckAt = Date.now();
		}

		if (
			!force &&
			(storeIsEmpty(store) || backups.auto[0]?.sig === dataSignature(store))
		) {
			if (kind === 'auto') {
				await writeBackups(backups);
			}

			return null;
		}

		const record = makeBackupRecord(store, kind, '');
		const scheduled = trimBackups(
			[record, ...backups.auto].filter((item) => item.kind === 'auto'),
			store.settings.autoBackupKeep,
		);
		const manual = trimBackups(
			[record, ...backups.auto].filter((item) => item.kind !== 'auto'),
			MANUAL_BACKUP_KEEP,
		);
		backups.auto = [...scheduled, ...manual].toSorted(
			(a, b) => Number(b.at) - Number(a.at),
		);
		await writeBackups(backups);
		if (store.settings.autoBackupToDownloads) {
			backups.downloadError = await downloadBackupCopy(record);
			await writeBackups(backups);
		}

		return record;
	});
}

async function safetyBackup(store: Store, reason: string): Promise<boolean> {
	if (storeIsEmpty(store)) {
		return true;
	}

	try {
		await backupMutate(async () => {
			const backups = await readBackups();
			backups.safety = trimBackups(
				[makeBackupRecord(store, 'safety', reason), ...backups.safety],
				SAFETY_BACKUP_KEEP,
			);
			await writeBackups(backups);
		});
		return true;
	} catch {
		return false;
	}
}

async function getBackups(): Promise<ActionResult<'GET_BACKUPS'>> {
	const backups = await readBackups();
	return {
		ok: true,
		auto: backups.auto.map((record) => summarizeBackup(record)),
		safety: backups.safety.map((record) => summarizeBackup(record)),
		downloadError: backups.downloadError,
	};
}

function backupNow(): Promise<ActionResult<'BACKUP_NOW'>> {
	return mutate(async () => {
		const store = await getStore();
		const record = await addBackup(store, 'manual', true);
		return {ok: true, backup: summarizeBackup(record!)};
	});
}

function runScheduledBackup(): Promise<void> {
	return mutate(async () => {
		const store = await getStore();
		if (store.settings.autoBackup !== 'off') {
			await addBackup(store, 'auto', false);
		}
	});
}

const BACKUP_PERIOD_MINUTES: Record<'daily' | 'weekly', number> = {
	daily: 1440,
	weekly: 10_080,
};

async function backupDue(settings: Settings): Promise<boolean> {
	if (settings.autoBackup === 'off') {
		return false;
	}

	const backups = await readBackups();
	const newest = backups.auto.find((record) => record.kind === 'auto');
	const last = Math.max(Number(newest?.at ?? 0), backups.lastAutoCheckAt);
	return (
		last === 0 ||
		Date.now() - last >= BACKUP_PERIOD_MINUTES[settings.autoBackup] * 60_000
	);
}

async function findBackup(id: string): Promise<BackupRecord | null> {
	const backups = await readBackups();
	return (
		[...backups.auto, ...backups.safety].find((record) => record.id === id) ??
		null
	);
}

function restoreBackup(id: string): Promise<ActionResult<'RESTORE_BACKUP'>> {
	return mutate(() =>
		withUndo('Restore backup', [STORAGE_KEY], async () => {
			const record = await findBackup(id);
			if (!record) {
				return {ok: false, error: 'That backup no longer exists.'};
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(record.json);
			} catch {
				return {ok: false, error: 'That backup could not be read.'};
			}

			const store = await getStore();
			const restored = normalizeStore({
				...(isRecord(parsed) && parsed),
				settings: store.settings,
			});
			if (!(await safetyBackup(store, 'Before restoring a backup'))) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was changed.',
				};
			}

			await writeStore(restored);
			return {
				ok: true,
				sessions: restored.groups.length,
				bookmarks: restored.bookmarks.length,
			};
		}),
	);
}

function deleteBackup(id: string): Promise<ActionResult<'DELETE_BACKUP'>> {
	return backupMutate(() =>
		withUndo('Delete backup', [BACKUPS_KEY], async () => {
			const backups = await readBackups();
			const auto = backups.auto.filter((record) => record.id !== id);
			const safety = backups.safety.filter((record) => record.id !== id);
			if (
				auto.length === backups.auto.length &&
				safety.length === backups.safety.length
			) {
				return {ok: false, error: 'That backup no longer exists.'};
			}

			await writeBackups({...backups, auto, safety});
			return {ok: true};
		}),
	);
}

async function getBackupData(
	id: string,
): Promise<ActionResult<'GET_BACKUP_DATA'>> {
	const record = await findBackup(id);
	return record
		? {ok: true, filename: backupFileName(Number(record.at)), json: record.json}
		: {ok: false, error: 'That backup no longer exists.'};
}

const pageCopies = createCopyStore({
	get: async (keys) => chrome.storage.local.get(keys),
	set: async (items) => chrome.storage.local.set(items),
	remove: async (keys) => chrome.storage.local.remove(keys),
});
const savedImages = createImageStore({
	get: async (keys) => chrome.storage.local.get(keys),
	set: async (items) => chrome.storage.local.set(items),
	remove: async (keys) => chrome.storage.local.remove(keys),
});
const PRIVATE_COPY_ERROR = 'Copies are never kept from private windows.';
let copySweep: Promise<void> | undefined;
let sweepAgain = false;

async function capturePage(tabId: number): Promise<unknown> {
	await chrome.scripting.executeScript({
		target: {tabId},
		files: ['page-copy-capture.js'],
	});
	const [injected] = await chrome.scripting.executeScript({
		target: {tabId},
		func: takeCapturedCopy,
		args: [CAPTURE_GLOBAL],
	});
	return injected?.result;
}

async function keepPageCopy(
	tab: chrome.tabs.Tab | undefined,
): Promise<ActionResult<'KEEP_PAGE_COPY'>> {
	if (privateContext || tab?.incognito) {
		return {ok: false, error: PRIVATE_COPY_ERROR};
	}

	const pageUrl = normalizeUrl(tab?.url);
	if (!isInteger(tab?.id) || !pageUrl) {
		return {ok: false, error: 'Open a regular web page to keep a copy of it.'};
	}

	let captured: unknown;
	try {
		captured = await capturePage(tab.id);
	} catch {
		return {
			ok: false,
			error: `${APP_NAME} could not read this page. Open it and choose Keep a copy from the ${APP_NAME} toolbar button or the page's right-click menu.`,
		};
	}

	const store = await getStore();
	const saved = copyLinkUrls(store, []);
	const url =
		[pageUrl, stripTrackingParameters(pageUrl)].find((candidate) =>
			saved.has(candidate),
		) ?? pageUrl;
	const copy = parsePageCopy(
		isRecord(captured) ? {...captured, url, savedAt: Date.now()} : undefined,
	);
	if (!copy) {
		return {ok: false, error: COPY_ERRORS.empty};
	}

	const kept = await pageCopies.keep(copy);
	if (!kept.ok) {
		return {ok: false, error: kept.error};
	}

	if (saved.has(url)) {
		return {ok: true, url, title: copy.title, bookmarked: false};
	}

	const added = await addBookmark({
		url,
		title: pageTitle(tab?.title, linkHost(url), store.settings.cleanTitles),
	});
	if (!added.ok) {
		await pageCopies.remove(url);
		return added;
	}

	return {ok: true, url, title: copy.title, bookmarked: true};
}

function deletePageCopy(
	url: string,
): Promise<ActionResult<'DELETE_PAGE_COPY'>> {
	if (privateContext) {
		return Promise.resolve({ok: true});
	}

	return mutate(async () => {
		const entry = (await pageCopies.list()).find((item) => item.url === url);
		if (!entry) {
			return {ok: true};
		}

		return withUndo('Delete copy', [COPY_INDEX_KEY, entry.key], async () => {
			await pageCopies.remove(url);
			return {ok: true};
		});
	});
}

async function sweepPageCopies() {
	if (
		privateContext ||
		((await pageCopies.list()).length === 0 &&
			(await savedImages.list()).length === 0) ||
		(await readUndo()).length > 0
	) {
		return;
	}

	const saved = await library.get<Raw>([STORAGE_KEY]);
	if (!isRecord(saved[STORAGE_KEY])) {
		return;
	}

	const store = await getStore();
	const live = copyLinkUrls(store, await readTrash());
	await pageCopies.sweep(live);
	await savedImages.sweep(live);
}

async function notePage(tabId: number, text: string, failed: boolean) {
	try {
		await chrome.scripting.executeScript({
			target: {tabId},
			func: showPageNote,
			args: [text, failed],
		});
		return true;
	} catch {
		return false;
	}
}

async function keepPageCopyFromMenu(tab: chrome.tabs.Tab | undefined) {
	const result = await keepPageCopy(tab).catch(
		(error: unknown): ActionFailure => ({
			ok: false,
			error: errorMessage(error) || 'Could not keep a copy of this page.',
		}),
	);
	const text = result.ok
		? result.bookmarked
			? `Copy kept. The page was not saved, so ${APP_NAME} bookmarked it.`
			: 'Copy kept.'
		: result.error;
	if (isInteger(tab?.id) && (await notePage(tab.id, text, !result.ok))) {
		return;
	}

	if (!result.ok) {
		console.warn(result.error);
	}

	flashBadge(tab, result.ok);
}

function scheduleCopySweep() {
	if (copySweep) {
		sweepAgain = true;
		return;
	}

	copySweep = (async () => {
		do {
			sweepAgain = false;
			await mutate(() => trashMutate(sweepPageCopies)).catch(() => undefined);
		} while (sweepAgain);
	})().finally(() => {
		copySweep = undefined;
	});
}

if (!privateContext) {
	onLibraryChanged((changes) => {
		if (
			Object.keys(changes).some(
				(key) =>
					key === STORAGE_KEY ||
					key === TRASH_KEY ||
					key === UNDO_KEY ||
					key.startsWith(SESSION_KEY_PREFIX) ||
					key.startsWith(SESSION_PAGE_KEY_PREFIX) ||
					key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX) ||
					key.startsWith(BOOKMARKS_KEY_PREFIX),
			)
		) {
			scheduleCopySweep();
		}
	});
	scheduleCopySweep();
}

async function addPageCopies(values: unknown): Promise<number> {
	if (privateContext || !Array.isArray(values)) {
		return 0;
	}

	const saved = copyLinkUrls(await getStore(), []);
	const have = new Set((await pageCopies.list()).map((item) => item.url));
	return pageCopies.restore(
		values.filter(
			(value: unknown) =>
				isRecord(value) &&
				typeof value.url === 'string' &&
				saved.has(value.url) &&
				!have.has(value.url),
		),
	);
}

async function captureTabImage(
	tabId: number,
	frameId: number | undefined,
	source: string,
): Promise<CapturedImage> {
	try {
		const [injected] = await chrome.scripting.executeScript({
			target: {tabId, ...(isInteger(frameId) && {frameIds: [frameId]})},
			func: captureImage,
			args: [source, IMAGE_MAX_BYTES, THUMB_MAX_SIDE, THUMB_MAX_BYTES],
		});
		const result: unknown = injected?.result;
		return isRecord(result) && typeof result.ok === 'boolean'
			? (result as CapturedImage)
			: {ok: false, reason: 'blocked'};
	} catch {
		return {ok: false, reason: 'blocked'};
	}
}

async function saveImage(
	info: MenuClickData,
	tab: chrome.tabs.Tab | undefined,
	columnId: string | undefined,
): Promise<{ok: boolean; text: string}> {
	const store = await getStore();
	const plan = mediaSave(
		{
			mediaType: 'image',
			srcUrl: info.srcUrl,
			pageUrl: info.pageUrl ?? tab?.url,
		},
		bookmarkDuplicates(
			store.bookmarks,
			columnId,
			store.settings.saveDuplicateHandling,
		).isDuplicate,
		pruneTrash(await readTrash(), store.settings.trashRetentionDays),
	);
	const url = normalizeUrl(info.srcUrl);
	if (privateContext || tab?.incognito || !isInteger(tab?.id) || !url) {
		return {ok: false, text: imageSaveNote({bookmark: 'unsupported'})};
	}

	if (!plan.ok && plan.reason !== 'saved') {
		return {ok: false, text: imageSaveNote({bookmark: plan.reason})};
	}

	if (plan.ok) {
		const added =
			columnId === undefined
				? await addBookmark({url: plan.url, title: plan.title})
				: await bookmarkToColumn(plan.url, plan.title, columnId);
		if (!added.ok) {
			return {ok: false, text: added.error};
		}
	}

	const bookmark = plan.ok ? 'added' : 'saved';
	const captured = await captureTabImage(tab.id, info.frameId, url);
	if (!captured.ok) {
		return {
			ok: false,
			text: imageSaveNote({bookmark, failure: captured.reason}),
		};
	}

	const kept = await savedImages.keep({
		...captured,
		url,
		savedAt: Date.now(),
		device: (await savedHere()).deviceName ?? '',
	});
	return kept.ok
		? {ok: true, text: imageSaveNote({bookmark})}
		: {ok: false, text: imageSaveNote({bookmark, failure: kept.reason})};
}

async function saveImageFromMenu(
	info: MenuClickData,
	tab: chrome.tabs.Tab | undefined,
	columnId: string | undefined,
) {
	const result = await saveImage(info, tab, columnId).catch(
		(error: unknown) => ({
			ok: false,
			text: errorMessage(error) || `${APP_NAME} could not save this image.`,
		}),
	);
	if (isInteger(tab?.id) && (await notePage(tab.id, result.text, !result.ok))) {
		return;
	}

	if (!result.ok) {
		console.warn(result.text);
	}

	flashBadge(tab, result.ok);
}

async function getSavedImages(): Promise<ActionResult<'GET_SAVED_IMAGES'>> {
	const items = privateContext ? [] : await savedImages.list();
	return {
		ok: true,
		items,
		size: items.reduce((sum, item) => sum + item.held, 0),
		budget: IMAGE_BUDGET,
	};
}

async function getSavedImage(
	url: string,
): Promise<ActionResult<'GET_SAVED_IMAGE'>> {
	if (privateContext) {
		return {ok: true, image: null, thumb: null};
	}

	const [thumb] = await savedImages.thumbs([url]);
	return {
		ok: true,
		image: (await savedImages.read(url)) ?? null,
		thumb: thumb ?? null,
	};
}

async function addSavedImages(values: unknown): Promise<number> {
	if (privateContext || !Array.isArray(values)) {
		return 0;
	}

	const saved = copyLinkUrls(await getStore(), await readTrash());
	const known = new Map(
		(await savedImages.list()).map((item) => [item.url, item.held > 0]),
	);
	const wanted = values.filter(
		(value: unknown): value is Raw =>
			isRecord(value) &&
			typeof value.url === 'string' &&
			saved.has(value.url) &&
			known.get(value.url) !== true,
	);
	const kept = await savedImages.restore(
		wanted.filter((value) => typeof value.data === 'string'),
	);
	const thumbs = wanted.filter(
		(value) => typeof value.data !== 'string' && !known.has(String(value.url)),
	);
	if (thumbs.length === 0) {
		return kept;
	}

	const before = (await savedImages.list()).length;
	await savedImages.applySynced(thumbs, []);
	return kept + (await savedImages.list()).length - before;
}

async function getPageCopies(): Promise<ActionResult<'GET_PAGE_COPIES'>> {
	if (privateContext) {
		return {ok: true, urls: [], size: 0, budget: COPY_BUDGET};
	}

	const items = await pageCopies.list();
	return {
		ok: true,
		urls: items.map((item) => item.url),
		size: items.reduce((sum, item) => sum + item.size, 0),
		budget: COPY_BUDGET,
	};
}

const UI_THEME_KEY = 'uiTheme';
const UI_ACCENT_KEY = 'uiAccent';
const SNAPSHOT_REASONS = new Set([
	'interval',
	'startup',
	'crash',
	'exit',
	'manual',
]);
const MAX_SNAPSHOT_WINDOWS = 50;
const MAX_SNAPSHOT_TABS = 10_000;

const asTheme = (value: unknown) =>
	value === 'light' || value === 'dark' ? value : 'system';

const asAccent = (value: unknown) =>
	typeof value === 'string' && isAccent(value) ? value : 'default';

async function getFullBackup(): Promise<ActionResult<'GET_FULL_BACKUP'>> {
	const store = await getStore();
	return {
		ok: true,
		state: store,
		preferences: {
			[UI_THEME_KEY]: asTheme(await readKey(UI_THEME_KEY)),
			[UI_ACCENT_KEY]: asAccent(await readKey(UI_ACCENT_KEY)),
		},
		snapshots: {version: 1, history: await readSnapshotHistory()},
		trash: {version: 1, items: await readTrash()},
		copies: privateContext ? [] : await pageCopies.all(),
		images: privateContext ? [] : await savedImages.thumbs(),
	};
}

function normalizeImportedSnapshot(entry: unknown): Snapshot | null {
	if (!isRecord(entry) || !Array.isArray(entry.windows)) {
		return null;
	}

	let tabCount = 0;
	const windows: SnapshotWindow[] = [];
	for (const rawWindow of entry.windows.slice(0, MAX_SNAPSHOT_WINDOWS)) {
		if (!isRecord(rawWindow) || !Array.isArray(rawWindow.tabs)) {
			continue;
		}

		const groups: SnapshotGroup[] = (
			Array.isArray(rawWindow.groups) ? rawWindow.groups : []
		)
			.slice(0, 500)
			.map((group: unknown) => {
				const raw = isRecord(group) ? group : {};
				return {
					title: cleanText(raw.title, '', 100),
					color: isGroupColor(raw.color) ? raw.color : 'grey',
					collapsed: Boolean(raw.collapsed),
				};
			});
		const tabs: SnapshotTab[] = [];
		for (const rawTab of rawWindow.tabs) {
			if (tabCount >= MAX_SNAPSHOT_TABS) {
				break;
			}

			const url = isRecord(rawTab) ? normalizeUrl(rawTab.url) : null;
			if (!isRecord(rawTab) || !url) {
				continue;
			}

			const tab: SnapshotTab = {url, title: cleanText(rawTab.title, url, 200)};
			if (rawTab.pinned === true) {
				tab.pinned = true;
			}

			if (rawTab.active === true) {
				tab.active = true;
			}

			if (
				isInteger(rawTab.group) &&
				rawTab.group >= 0 &&
				rawTab.group < groups.length
			) {
				tab.group = rawTab.group;
			}

			const split = normalizeSplit(rawTab.split);
			if (split) {
				tab.split = split;
			}

			tabs.push(tab);
			tabCount += 1;
		}

		if (tabs.length > 0) {
			windows.push({
				focused: rawWindow.focused === true,
				state: cleanText(rawWindow.state, 'normal', 20),
				groups,
				tabs,
			});
		}
	}

	const at = Number(entry.at);
	if (windows.length === 0 || !Number.isFinite(at)) {
		return null;
	}

	const text = JSON.stringify(windows);
	return {
		id: cleanText(entry.id, makeId(), 100),
		at,
		reason: SNAPSHOT_REASONS.has(String(entry.reason))
			? (entry.reason as SnapshotReason)
			: 'manual',
		sig: hashText(text),
		size: text.length,
		windows,
	};
}

function normalizeImportedTrash(entry: unknown): TrashEntry | null {
	if (!isTrashEntry(entry) || !TRASH_KINDS.has(entry.kind)) {
		return null;
	}

	return {
		id: cleanText(entry.id, makeId(), 100),
		kind: entry.kind,
		deletedAt: Number.isFinite(Number(entry.deletedAt))
			? Number(entry.deletedAt)
			: Date.now(),
		label: cleanText(entry.label, 'Deleted item', 200),
		origin: cleanText(entry.origin, '', 200),
		count: Math.max(0, Math.floor(Number(entry.count)) || 0),
		data: entry.data,
	};
}

async function applyFullBackup(
	input: Raw,
): Promise<ActionResult<'RESTORE_FULL_BACKUP'>> {
	if (input.format !== FULL_BACKUP_FORMAT_ID) {
		return {
			ok: false,
			error: `This is not a ${APP_NAME} full backup.`,
		};
	}

	const version = Number(input.version);
	if (!Number.isSafeInteger(version) || version < 1) {
		return {ok: false, error: 'This backup has no valid version.'};
	}

	if (version > FULL_BACKUP_VERSION) {
		return {
			ok: false,
			error: 'This backup is from a newer TabLodge version.',
		};
	}

	const data = input.state;
	if (!isRecord(data)) {
		return {ok: false, error: 'This backup has no data.'};
	}

	if (Number(data.schemaVersion) > SCHEMA_VERSION) {
		return {
			ok: false,
			error: 'This backup is from a newer TabLodge version.',
		};
	}

	const restored = normalizeStore(data);
	const current = await getStore();
	if (!(await safetyBackup(current, 'Before importing a full backup'))) {
		return {
			ok: false,
			error: 'Could not take a safety backup first. Nothing was changed.',
		};
	}

	const rawHistory =
		isRecord(input.snapshots) && Array.isArray(input.snapshots.history)
			? input.snapshots.history
			: [];
	const history = trimHistory(
		rawHistory
			.slice(0, 200)
			.map((entry: unknown) => normalizeImportedSnapshot(entry))
			.filter((entry): entry is Snapshot => entry !== null)
			.toSorted((a, b) => b.at - a.at),
		restored.settings.snapshotKeep,
	);
	const rawItems =
		isRecord(input.trash) && Array.isArray(input.trash.items)
			? input.trash.items
			: [];
	const items = capTrashSize(
		rawItems
			.slice(0, TRASH_MAX_ITEMS)
			.map((entry: unknown) => normalizeImportedTrash(entry))
			.filter((entry): entry is TrashEntry => entry !== null),
	);

	await writeStore(restored);
	await writeSnapshotHistory(history);
	await writeTrash(items);
	const copies =
		!privateContext && Array.isArray(input.copies)
			? await pageCopies.restore(input.copies)
			: 0;
	if (isRecord(input.preferences)) {
		await library.set({
			[UI_THEME_KEY]: asTheme(input.preferences[UI_THEME_KEY]),
			[UI_ACCENT_KEY]: asAccent(input.preferences[UI_ACCENT_KEY]),
		});
	}

	return {
		ok: true,
		sessions: restored.groups.length,
		bookmarks: restored.bookmarks.length,
		snapshots: history.length,
		trash: items.length,
		copies,
	};
}

function restoreFullBackup(
	input: Raw,
): Promise<ActionResult<'RESTORE_FULL_BACKUP'>> {
	return mutate(() =>
		snapshotMutate(() =>
			trashMutate(() =>
				withUndo<'RESTORE_FULL_BACKUP'>(
					'Import full backup',
					[STORAGE_KEY, SNAPSHOTS_KEY, TRASH_KEY, UI_THEME_KEY, UI_ACCENT_KEY],
					() => applyFullBackup(input),
				),
			),
		),
	).then(async (result) => {
		if (result.ok) {
			const store = await getStore();
			await syncRecoveryAlarms(store.settings);
			await syncToolbarAction(store.settings);
			await rebuildContextMenus(store);
		}

		return result;
	});
}

async function readTrash(): Promise<TrashEntry[]> {
	const raw = await readKey<Raw>(TRASH_KEY);
	return Array.isArray(raw?.items) ? raw.items.filter(isTrashEntry) : [];
}

async function writeTrash(items: TrashEntry[]) {
	await library.set({[TRASH_KEY]: {version: 1, items}});
}

const trashSize = (entry: TrashEntry) => {
	entry.size ??= JSON.stringify(entry.data).length;
	return entry.size;
};

function capTrashSize(items: TrashEntry[]): TrashEntry[] {
	let total = 0;
	let kept = 0;
	for (const item of items) {
		total += trashSize(item);
		if (kept > 0 && total > TRASH_MAX_CHARS) {
			break;
		}

		kept += 1;
	}

	return kept === items.length ? items : items.slice(0, kept);
}

function pruneTrash(items: TrashEntry[], retentionDays: number): TrashEntry[] {
	const cutoff = Date.now() - retentionDays * DAY_MS;
	return capTrashSize(
		items
			.filter((item) => Number(item.deletedAt) > cutoff)
			.slice(0, TRASH_MAX_ITEMS),
	);
}

function trashAdd(
	settings: Settings,
	item: Omit<TrashEntry, 'id' | 'deletedAt'>,
): Promise<string> {
	return trashMutate(async () => {
		const entry: TrashEntry = {...item, id: makeId(), deletedAt: Date.now()};
		trashSize(entry);
		await writeTrash(
			pruneTrash([entry, ...(await readTrash())], settings.trashRetentionDays),
		);
		return entry.id;
	});
}

function trashAddMany(
	settings: Settings,
	items: Array<Omit<TrashEntry, 'id' | 'deletedAt'>>,
): Promise<string[]> {
	return trashMutate(async () => {
		const deletedAt = Date.now();
		const entries = items.map((item): TrashEntry => {
			const entry = {...item, id: makeId(), deletedAt};
			trashSize(entry);
			return entry;
		});
		await writeTrash(
			pruneTrash(
				[...entries.toReversed(), ...(await readTrash())],
				settings.trashRetentionDays,
			),
		);
		return entries.map((entry) => entry.id);
	});
}

async function readSyncTrash(): Promise<TrashEntry[]> {
	return pruneTrash(
		await readTrash(),
		(await readSettings()).trashRetentionDays,
	);
}

function applySyncTrash(put: TrashEntry[], remove: string[]): Promise<void> {
	return trashMutate(async () => {
		const gone = new Set([...remove, ...put.map((entry) => entry.id)]);
		const items = [
			...put,
			...(await readTrash()).filter((entry) => !gone.has(entry.id)),
		].toSorted((a, b) => Number(b.deletedAt) - Number(a.deletedAt));
		await writeTrash(
			pruneTrash(items, (await readSettings()).trashRetentionDays),
		);
	});
}

function purgeTrash(): Promise<void> {
	return trashMutate(async () => {
		const settings = await readSettings();
		const items = await readTrash();
		const unsized = items.some((item) => item.size === undefined);
		const kept = pruneTrash(items, settings.trashRetentionDays);
		if (kept.length !== items.length || unsized) {
			await writeTrash(kept);
		}
	});
}

const trashSessionData = (session: Session, index: number): Raw => ({
	session,
	index,
});

function trashTabsEntry(
	group: Session,
	removed: Array<{tab: SavedTab; index: number}>,
	groupRemoved: boolean,
	index: number,
): Omit<TrashEntry, 'id' | 'deletedAt'> {
	const first = removed[0]?.tab;
	return {
		kind: 'tabs',
		label:
			removed.length === 1
				? first.title || first.url
				: `${removed.length} saved links`,
		origin: group.name,
		count: removed.length,
		data: {
			groupId: group.id,
			groupName: group.name,
			groupIndex: index,
			groupMeta: groupRemoved ? {...group, tabs: []} : null,
			items: removed,
		},
	};
}

function describeTrash(entry: TrashEntry): TrashSummary {
	return {
		id: entry.id,
		kind: entry.kind,
		deletedAt: Number(entry.deletedAt),
		label: entry.label,
		origin: entry.origin,
		count: entry.count,
	};
}

async function getTrash(): Promise<ActionResult<'GET_TRASH'>> {
	const settings = await readSettings();
	const items = pruneTrash(await readTrash(), settings.trashRetentionDays);
	return {
		ok: true,
		items: items.map((entry) => describeTrash(entry)),
		urls: {
			sessions: trashedUrls(items, 'sessions'),
			bookmarks: trashedUrls(items, 'bookmarks'),
		},
	};
}

async function trashedImportUrls(
	settings: Settings,
	kind: 'sessions' | 'bookmarks',
): Promise<string[]> {
	return trashedUrls(
		pruneTrash(await readTrash(), settings.trashRetentionDays),
		kind,
	);
}

const clampIndex = (value: unknown, length: number) =>
	Math.max(0, Math.min(length, isInteger(value) ? value : length));

function uniqueName(name: string, taken: (candidate: string) => boolean) {
	if (!taken(name)) {
		return name;
	}

	for (let n = 1; ; n += 1) {
		const candidate = `${name} (restored${n > 1 ? ` ${n}` : ''})`;
		if (!taken(candidate)) {
			return candidate;
		}
	}
}

function applyTrashRestore(
	store: Store,
	entry: TrashEntry,
): ActionFailure | {ok: true; placed: string} {
	const {data} = entry;
	if (entry.kind === 'session') {
		const session = normalizeGroup(data.session, Date.now(), true);
		if (!session) {
			return {ok: false, error: 'That session could not be restored.'};
		}

		if (store.groups.length >= MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		if (store.groups.some((group) => group.id === session.id)) {
			session.id = makeId();
		}

		const folder = store.folders.find((item) => item.id === session.folderId);
		if (!folder) {
			session.folderId = DEFAULT_FOLDER_ID;
		}

		store.groups.splice(
			clampIndex(data.index, store.groups.length),
			0,
			session,
		);
		return {
			ok: true,
			placed: folder?.name ?? DEFAULT_FOLDER.name,
		};
	}

	if (entry.kind === 'tabs') {
		const items = (Array.isArray(data.items) ? data.items : [])
			.filter(isRecord)
			.map((item) => ({
				tab: normalizeTab(item.tab, Date.now(), 0),
				index: Number(item.index),
			}))
			.filter(
				(item): item is {tab: SavedTab; index: number} => item.tab !== null,
			)
			.toSorted((a, b) => a.index - b.index);
		if (items.length === 0) {
			return {ok: false, error: 'Those links could not be restored.'};
		}

		const group = store.groups.find((item) => item.id === data.groupId);
		if (group && group.tabs.length + items.length > MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		if (!group && store.groups.length >= MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		if (!group) {
			const meta = isRecord(data.groupMeta) ? data.groupMeta : {};
			const created = normalizeGroup(
				{
					...meta,
					id: meta.id ?? makeId(),
					name: meta.name ?? data.groupName ?? 'Restored links',
					tabs: items.map((item) => item.tab),
				},
				Date.now(),
				true,
			);
			if (!created) {
				return {ok: false, error: 'Those links could not be restored.'};
			}

			if (store.groups.some((item) => item.id === created.id)) {
				created.id = makeId();
			}

			if (store.folders.every((item) => item.id !== created.folderId)) {
				created.folderId = DEFAULT_FOLDER_ID;
			}

			store.groups.splice(
				clampIndex(data.groupIndex, store.groups.length),
				0,
				created,
			);
			return {ok: true, placed: created.name};
		}

		const known = new Set(group.tabs.map((tab) => tab.id));
		for (const {tab, index} of items) {
			if (known.has(tab.id)) {
				tab.id = makeId();
			}

			known.add(tab.id);
			group.tabs.splice(clampIndex(index, group.tabs.length), 0, tab);
		}

		group.updatedAt = Date.now();
		return {ok: true, placed: group.name};
	}

	if (entry.kind === 'bookmark') {
		const bookmark = normalizeBookmark(
			data.bookmark,
			new Set([
				...store.bookmarkColumns.map((column) => column.id),
				BOOKMARK_UNFILED_ID,
			]),
		);
		if (!bookmark) {
			return {ok: false, error: 'That bookmark could not be restored.'};
		}

		const column = store.bookmarkColumns.find(
			(item) => item.id === data.columnId,
		);
		bookmark.columnId =
			column?.id ?? store.bookmarkColumns[0]?.id ?? BOOKMARK_UNFILED_ID;
		if (store.bookmarks.some((item) => item.id === bookmark.id)) {
			bookmark.id = makeId();
		}

		const previous = store.bookmarks.findIndex(
			(item) => item.id === data.prevId,
		);
		const next = store.bookmarks.findIndex((item) => item.id === data.nextId);
		if (column && previous !== -1) {
			store.bookmarks.splice(previous + 1, 0, bookmark);
		} else if (column && next !== -1) {
			store.bookmarks.splice(next, 0, bookmark);
		} else {
			store.bookmarks.push(bookmark);
		}

		return {
			ok: true,
			placed:
				column?.name ??
				store.bookmarkColumns.find((item) => item.id === bookmark.columnId)
					?.name ??
				'Unfiled',
		};
	}

	if (entry.kind === 'column') {
		const column = normalizeBookmarkColumn(data.column);
		if (!column) {
			return {ok: false, error: 'That column could not be restored.'};
		}

		const existing = isSourceColumnId(column.id)
			? store.bookmarkColumns.find((item) => item.id === column.id)
			: undefined;
		if (existing) {
			column.id = existing.id;
			column.name = existing.name;
		} else {
			if (store.bookmarkColumns.some((item) => item.id === column.id)) {
				column.id = makeId();
			}

			column.name = uniqueName(column.name, (candidate) =>
				columnNameTaken(store.bookmarkColumns, candidate),
			);
			column.isDefault = column.id === DEFAULT_BOOKMARK_COLUMN_ID;
			store.bookmarkColumns.splice(
				clampIndex(data.index, store.bookmarkColumns.length),
				0,
				column,
			);
		}

		const columnIds = new Set([
			...store.bookmarkColumns.map((item) => item.id),
			BOOKMARK_UNFILED_ID,
		]);
		const knownBookmarks = new Set(store.bookmarks.map((item) => item.id));
		for (const raw of Array.isArray(data.bookmarks) ? data.bookmarks : []) {
			const bookmark = normalizeBookmark(raw, columnIds);
			if (!bookmark || knownBookmarks.has(bookmark.id)) {
				continue;
			}

			bookmark.columnId = column.id;
			store.bookmarks.push(bookmark);
		}

		const moved = new Set(
			Array.isArray(data.movedIds) ? (data.movedIds as unknown[]) : [],
		);
		for (const bookmark of store.bookmarks) {
			if (moved.has(bookmark.id) && bookmark.columnId === data.movedTo) {
				bookmark.columnId = column.id;
			}
		}

		return {ok: true, placed: column.name};
	}

	const folder = normalizeFolder(data.folder);
	if (!folder) {
		return {ok: false, error: 'That folder could not be restored.'};
	}

	if (store.folders.some((item) => item.id === folder.id)) {
		folder.id = makeId();
	}

	folder.name = uniqueName(folder.name, (candidate) =>
		folderNameExists(store.folders, candidate),
	);
	folder.isDefault = false;
	store.folders.splice(clampIndex(data.index, store.folders.length), 0, folder);
	const wasIn = new Set(
		Array.isArray(data.groupIds) ? (data.groupIds as unknown[]) : [],
	);
	for (const group of store.groups) {
		if (wasIn.has(group.id) && group.folderId === DEFAULT_FOLDER_ID) {
			group.folderId = folder.id;
		}
	}

	return {ok: true, placed: folder.name};
}

function restoreTrash(id: string): Promise<ActionResult<'RESTORE_TRASH'>> {
	return mutate(async () => {
		const entry = (await readTrash()).find((item) => item.id === id);
		if (!entry) {
			return {ok: false, error: 'That item is no longer in the trash bin.'};
		}

		const store = await getStore();
		const outcome = applyTrashRestore(store, entry);
		if (!outcome.ok) {
			return outcome;
		}

		await writeStore(store);
		await trashMutate(async () => {
			await writeTrash((await readTrash()).filter((item) => item.id !== id));
		});
		return {ok: true, placed: outcome.placed};
	});
}

function deleteTrash(id: string): Promise<ActionResult<'DELETE_TRASH'>> {
	return trashMutate(() =>
		withUndo('Delete from trash bin', [TRASH_KEY], async () => {
			const items = await readTrash();
			const next = items.filter((item) => item.id !== id);
			if (next.length === items.length) {
				return {ok: false, error: 'That item is no longer in the trash bin.'};
			}

			await writeTrash(next);
			await nudgeSync();
			return {ok: true};
		}),
	);
}

function emptyTrash(): Promise<ActionResult<'EMPTY_TRASH'>> {
	return trashMutate(() =>
		withUndo('Empty trash bin', [TRASH_KEY], async () => {
			const items = await readTrash();
			await writeTrash([]);
			await nudgeSync();
			return {ok: true, count: items.length};
		}),
	);
}

const UNDO_KEY = 'tablodge.undo';
const ALARM_UNDO = 'tablodge-undo';

const UNDO_KEEP = 3;
const undoMutate = serialQueue();

type UndoRecord = {
	id: string;
	label: string;
	createdAt: number;
	keys: string[];
	before: Raw;
	after: Record<string, string>;
	from?: string;
};

const isUndoRecord = (value: unknown): value is UndoRecord =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	Array.isArray(value.keys) &&
	isRecord(value.before) &&
	isRecord(value.after);

const undoHash = (value: unknown) =>
	value === undefined ? 'none' : hashText(JSON.stringify(value));

async function readUndo(): Promise<UndoRecord[]> {
	const raw = await readKey<Raw>(UNDO_KEY);
	const cutoff = Date.now() - UNDO_WINDOW_MS;
	return Array.isArray(raw?.records)
		? raw.records.filter(
				(record): record is UndoRecord =>
					isUndoRecord(record) && Number(record.createdAt) > cutoff,
			)
		: [];
}

async function writeUndo(records: UndoRecord[]) {
	await (records.length === 0
		? library.remove(UNDO_KEY)
		: library.set({[UNDO_KEY]: {version: 1, records}}));
}

async function withUndo<K extends TabLodgeMessageType>(
	label: string,
	keys: string[],
	run: () => Promise<ActionResult<K>>,
): Promise<ActionResult<K>> {
	const others = keys.filter((key) => key !== STORAGE_KEY);
	const before = await library.get<Raw>(others);
	const tracksState = keys.includes(STORAGE_KEY);
	const checkpoint = tracksState ? await libraryState.beginCheckpoint() : null;
	const fingerprintBefore = checkpoint
		? await libraryState.fingerprint()
		: undefined;
	const stateBefore =
		tracksState && !checkpoint
			? (await library.get<Raw>([STORAGE_KEY]))[STORAGE_KEY]
			: undefined;
	let result: ActionResult<K>;
	let delta: UndoDelta | null = null;
	try {
		result = await run();
	} finally {
		if (checkpoint) {
			delta = await libraryState.endCheckpoint(checkpoint);
		}
	}

	if (!result.ok) {
		return result;
	}

	try {
		const now = await library.get<Raw>(others);
		const after: Record<string, string> = Object.fromEntries(
			others.map((key) => [key, undoHash(now[key])]),
		);
		let changed = others.some((key) => after[key] !== undoHash(before[key]));
		if (tracksState) {
			if (checkpoint) {
				const fingerprintAfter = await libraryState.fingerprint();
				after[STORAGE_KEY] = fingerprintAfter ?? 'none';
				if (fingerprintAfter !== fingerprintBefore) {
					if (!delta) {
						return result;
					}

					changed = true;
				}
			} else {
				const stateNow = (await library.get<Raw>([STORAGE_KEY]))[STORAGE_KEY];
				after[STORAGE_KEY] = undoHash(stateNow);
				changed ||= after[STORAGE_KEY] !== undoHash(stateBefore);
			}
		}

		if (!changed) {
			return result;
		}

		const record: UndoRecord = {
			id: makeId(),
			label,
			createdAt: Date.now(),
			keys,
			...(checkpoint && {from: fingerprintBefore ?? 'none'}),
			before: {
				...before,
				...(delta && {[STORAGE_KEY]: delta}),
				...(stateBefore !== undefined && {[STORAGE_KEY]: stateBefore}),
			},
			after,
		};
		await undoMutate(async () => {
			await writeUndo([record, ...(await readUndo())].slice(0, UNDO_KEEP));
		});
		await chrome.alarms?.create?.(ALARM_UNDO, {delayInMinutes: 3});
		return {...result, undoId: record.id};
	} catch {
		return result;
	}
}

const ALARM_SEND_TO_PRIVATE = 'tablodge-send-to-private';
const SEND_CLEANUP_KEY = 'tablodge.sendprivate.cleanup';
const SEND_HOLD_MS = UNDO_WINDOW_MS + 60_000;
const SEND_NEEDS_PRIVATE_WINDOW =
	'Open a private window and unlock it once, then send links to it from here.';

async function sendToPrivateState(): Promise<SendToPrivateState> {
	await privateConfigReady;
	if (
		privateContext ||
		IS_FIREFOX ||
		privateConfig.mode !== 'saved' ||
		!privateConfig.configured
	) {
		return 'hidden';
	}

	const lock = await chrome.storage.local.get([LOCK_RECORD_KEY]);
	return parseLockRecord(lock[LOCK_RECORD_KEY])?.state === 'encrypted' &&
		(await inboxPublicKey())
		? 'ready'
		: 'needs-private-window';
}

async function siteSourceColumnIds(store: Store): Promise<Set<string>> {
	const statuses = siteSourceStatuses(await readSourcesState());
	return new Set(
		store.bookmarkColumns.flatMap((column) =>
			sourceSavingInto(column.id, store.bookmarkColumns, statuses) ||
			statuses.some(
				(status) =>
					(status.wanted || status.enabled) && status.columnId === column.id,
			)
				? [column.id]
				: [],
		),
	);
}

async function inboxPublicKey(): Promise<string | undefined> {
	const saved = await chrome.storage.local.get([INBOX_PUBLIC_KEY]);
	return parseInboxPublicKey(saved[INBOX_PUBLIC_KEY]);
}

async function sendToPrivate(
	rawTargets: unknown,
): Promise<ActionResult<'SEND_TO_PRIVATE'>> {
	if (Array.isArray(rawTargets) && rawTargets.length > MAX_SENT_LINKS) {
		return {
			ok: false,
			error: `Send at most ${MAX_SENT_LINKS} links at a time. Select fewer.`,
		};
	}

	const targets = parseSendTargets(rawTargets);
	if (!targets) {
		return {ok: false, error: 'Choose the links to send.'};
	}

	const state = await sendToPrivateState();
	if (state === 'hidden') {
		return {
			ok: false,
			error: 'Private windows do not use a separate saved library.',
		};
	}

	if (state !== 'ready') {
		return {ok: false, error: SEND_NEEDS_PRIVATE_WINDOW};
	}

	const id = makeId();
	const key = inboxEntryKey(id);
	return mutate(() =>
		withUndo('Send to private storage', [STORAGE_KEY, key], async () => {
			const publicKey = await inboxPublicKey();
			if (!publicKey) {
				return {ok: false, error: SEND_NEEDS_PRIVATE_WINDOW};
			}

			const current = await getStore();
			const taken = takeOutForPrivate(current, targets, {
				keepColumnIds: await siteSourceColumnIds(current),
			});
			if (!taken.ok) {
				return taken;
			}

			const entry = await sealForInbox(publicKey, id, taken.sent);
			await library.set({
				[key]: {...entry, holdUntil: Date.now() + SEND_HOLD_MS},
			});
			if ((await inboxPublicKey()) !== publicKey) {
				await library.remove([key]);
				return {
					ok: false,
					error: 'The private library changed meanwhile. Nothing was sent.',
				};
			}

			await library.set({[SEND_CLEANUP_KEY]: true});
			try {
				await writeStore(taken.store);
			} catch (error) {
				await library.remove([key]).catch(() => undefined);
				throw error;
			}

			try {
				await chrome.alarms?.create?.(ALARM_UNDO, {delayInMinutes: 3});
			} catch {}

			return {
				ok: true,
				count: taken.count,
				...(taken.keptColumn && {keptColumn: taken.keptColumn}),
			};
		}),
	);
}

async function finishSendCleanup(records: UndoRecord[]): Promise<void> {
	const sendLive = records.some((record) =>
		record.keys.some((key) => isInboxEntryKey(key)),
	);
	if (sendLive || !(await readKey(SEND_CLEANUP_KEY))) {
		return;
	}

	try {
		await mutate(async () => {
			await libraryState.dropGarbage();
			await library.remove([SEND_CLEANUP_KEY]);
		});
	} catch {
		await chrome.alarms?.create?.(ALARM_UNDO, {delayInMinutes: 1});
	}
}

async function dropUndo(id: string): Promise<ActionResult<'DROP_UNDO'>> {
	const released = await undoMutate(async () => {
		const records = await readUndo();
		const record = records.find((entry) => entry.id === id);
		if (!record) {
			return [];
		}

		const entries = record.keys.filter((key) => isInboxEntryKey(key));
		await writeUndo(
			records.filter(
				(entry) =>
					entry.id !== id &&
					(entries.length === 0 ||
						entry.createdAt > record.createdAt ||
						!entry.keys.includes(STORAGE_KEY)),
			),
		);
		return entries;
	});
	if (released.length > 0) {
		await mutate(async () => {
			const stored = await library.get<Raw>(released);
			const unheld = Object.fromEntries(
				Object.entries(stored).flatMap(([key, value]) =>
					isRecord(value) ? [[key, {...value, holdUntil: 0}]] : [],
				),
			);
			await library.set(unheld);
		});
		await finishSendCleanup(await undoMutate(async () => readUndo()));
	}

	return {ok: true};
}

async function inboxKeyPair(): Promise<InboxKeyPair> {
	const stored = await library.get<Raw>([INBOX_PRIVATE_KEY_NAME]);
	const existing = parseInboxKeyPair(stored[INBOX_PRIVATE_KEY_NAME]);
	const pair = existing ?? (await createInboxKeyPair());
	if (!existing) {
		await library.set({[INBOX_PRIVATE_KEY_NAME]: pair});
	}

	if ((await inboxPublicKey()) !== pair.publicKey) {
		await chrome.storage.local.set({[INBOX_PUBLIC_KEY]: pair.publicKey});
	}

	return pair;
}

const heldUntil = (value: unknown) =>
	isRecord(value) && typeof value.holdUntil === 'number' ? value.holdUntil : 0;

async function receiveSentLinks(): Promise<void> {
	if (!privateContext) {
		return;
	}

	await privateConfigReady;
	if (privateConfig.mode !== 'saved') {
		return;
	}

	try {
		await takeInSentLinks();
	} catch {
		await chrome.alarms?.create?.(ALARM_SEND_TO_PRIVATE, {delayInMinutes: 1});
	}
}

async function takeInSentLinks({
	ignoreHold = false,
}: {ignoreHold?: boolean} = {}): Promise<void> {
	await mutate(async () => {
		const gate = await lockGate();
		if (!gate?.key || gate.state !== 'encrypted') {
			return;
		}

		const pair = await inboxKeyPair();
		const stored = await chrome.storage.local.get(null);
		const now = Date.now();
		const taken: string[] = [];
		const received = emptyPayload();
		let wakeAt = Infinity;
		for (const [key, value] of Object.entries(stored)) {
			if (!isInboxEntryKey(key)) {
				continue;
			}

			const hold = heldUntil(value);
			if (hold > now && !ignoreHold) {
				wakeAt = Math.min(wakeAt, hold);
				continue;
			}

			const opened = await openInboxEntry(
				pair,
				key.slice(INBOX_ENTRY_PREFIX.length),
				value,
			);
			if (!opened) {
				continue;
			}

			taken.push(key);
			received.links.push(...opened.links);
			received.columns.push(...opened.columns);
			received.sessions.push(...opened.sessions);
		}

		if (sentLinkCount(received) > 0) {
			const merged = addSent(await getStore(), received);
			if (merged.added > 0) {
				await writeStore(merged.store);
			}
		}

		if (taken.length > 0) {
			await chrome.storage.local.remove(taken);
		}

		if (Number.isFinite(wakeAt)) {
			await chrome.alarms?.create?.(ALARM_SEND_TO_PRIVATE, {when: wakeAt});
		}
	});
}

function mutateWithUndo<K extends UndoableEdit>(
	type: K,
	run: () => Promise<ActionResult<K>>,
): Promise<ActionResult<K>> {
	return mutate(() => withUndo(undoableEdit(type)!.label, [STORAGE_KEY], run));
}

async function purgeUndo(): Promise<void> {
	const records = await undoMutate(async () => {
		const live = await readUndo();
		const stored = await readKey<Raw>(UNDO_KEY);
		if (
			stored &&
			(!Array.isArray(stored.records) || stored.records.length !== live.length)
		) {
			await writeUndo(live);
		}

		return live;
	});
	await finishSendCleanup(records);
}

function undoAction(id: string): Promise<ActionResult<'UNDO'>> {
	const run = (keys: string[], apply: () => Promise<ActionResult<'UNDO'>>) => {
		let step = apply;
		if (keys.includes(TRASH_KEY)) {
			const inner = step;
			step = () => trashMutate(inner);
		}

		if (keys.includes(BACKUPS_KEY)) {
			const inner = step;
			step = () => backupMutate(inner);
		}

		if (keys.includes(SNAPSHOTS_KEY)) {
			const inner = step;
			step = () => snapshotMutate(inner);
		}

		return mutate(step);
	};

	return undoMutate(() => readUndo()).then((records) => {
		const record = records.find((entry) => entry.id === id);
		if (!record) {
			return {
				ok: false,
				error: "Can't undo: it was too long ago.",
			};
		}

		return run(record.keys, async () => {
			const delta = isUndoDelta(record.before[STORAGE_KEY])
				? record.before[STORAGE_KEY]
				: undefined;
			const others = record.keys.filter((key) => key !== STORAGE_KEY);
			const current = await library.get<Raw>(delta ? others : record.keys);
			const stateChanged =
				delta &&
				(await libraryState.fingerprint()) !== record.after[STORAGE_KEY];
			if (
				stateChanged ||
				(delta ? others : record.keys).some(
					(key) => undoHash(current[key]) !== record.after[key],
				)
			) {
				return {ok: false, error: "Can't undo: your data changed since."};
			}

			const restore: Raw = {};
			const drop: string[] = [];
			for (const key of delta ? others : record.keys) {
				if (record.before[key] === undefined) {
					drop.push(key);
				} else {
					restore[key] = record.before[key];
				}
			}

			await library.set(restore);
			if (drop.length > 0) {
				await library.remove(drop);
			}

			if (delta) {
				await libraryState.restoreCheckpoint(delta);
			}

			invalidateSettings();

			const fingerprintNow =
				delta && record.from !== undefined
					? ((await libraryState.fingerprint()) ?? 'none')
					: undefined;
			await undoMutate(async () => {
				const remaining = (await readUndo())
					.filter((entry) => entry.id !== id)
					.map((entry) =>
						fingerprintNow !== undefined &&
						entry.after[STORAGE_KEY] === record.from
							? {
									...entry,
									after: {...entry.after, [STORAGE_KEY]: fingerprintNow},
								}
							: entry,
					);
				await writeUndo(remaining);
			});
			if (record.keys.includes(STORAGE_KEY)) {
				const store = await getStore();
				await syncRecoveryAlarms(store.settings);
				await syncToolbarAction(store.settings);
				await rebuildContextMenus(store);
			}

			return {ok: true, label: record.label};
		});
	});
}

async function getStorageUsage(): Promise<ActionResult<'GET_STORAGE_USAGE'>> {
	const bytes = async (keys: string[]) => {
		try {
			return await library.getBytesInUse(keys);
		} catch {
			return 0;
		}
	};

	const usage: StorageUsage = {
		snapshots: await bytes([
			SNAPSHOTS_KEY,
			SNAPSHOT_LIVE_KEY,
			SNAPSHOT_META_KEY,
		]),
		backups: await bytes([BACKUPS_KEY]),
		trash: await bytes([TRASH_KEY]),
		state: await bytes([STORAGE_KEY]),
		images: privateContext ? 0 : (await savedImages.usage()).size,
		imageBudget: IMAGE_BUDGET,
	};
	return {ok: true, usage};
}

async function ensureAlarm(
	name: string,
	periodInMinutes: number | null,
	delayInMinutes?: number,
) {
	if (!chrome.alarms) {
		return;
	}

	try {
		const existing = await chrome.alarms.get(name);
		if (periodInMinutes === null) {
			if (existing) {
				await chrome.alarms.clear(name);
			}

			return;
		}

		if (existing?.periodInMinutes === periodInMinutes) {
			return;
		}

		await chrome.alarms.create(name, {
			periodInMinutes,
			delayInMinutes: delayInMinutes ?? periodInMinutes,
		});
	} catch {}
}

async function syncRecoveryAlarms(settings: Settings) {
	if (privateContext) {
		return;
	}

	await ensureAlarm(
		ALARM_SNAPSHOT,
		settings.snapshotsEnabled ? settings.snapshotIntervalMinutes : null,
	);
	await ensureAlarm(
		ALARM_BACKUP,
		settings.autoBackup === 'off'
			? null
			: BACKUP_PERIOD_MINUTES[settings.autoBackup],
		1,
	);
	await ensureAlarm(ALARM_TRASH, 1440, 5);
	await ensureAlarm(
		ALARM_ARCHIVE,
		settings.autoArchiveDays === 0 ? null : 1440,
		5,
	);
}

async function runStartupRecovery() {
	try {
		await evaluateStartup();
		const settings = await readSettings();
		await syncRecoveryAlarms(settings);
		await purgeTrash();
		await purgeUndo();
		await archiveStaleSessions();
		if (await backupDue(settings)) {
			await runScheduledBackup();
		}

		if (settings.snapshotsEnabled) {
			scheduleSnapshot();
		}
	} catch {}
}

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
	if (alarm.name === ALARM_PRIVATE_LOCK) {
		void privateLockInfo().catch(() => undefined);
		return;
	}

	if (alarm.name === ALARM_SEND_TO_PRIVATE) {
		void receiveSentLinks().catch(() => undefined);
		return;
	}

	if (privateContext) {
		return;
	}

	if (alarm.name === SYNC_ALARM) {
		void wakeSync().catch(() => undefined);
		return;
	}

	const work =
		alarm.name === ALARM_SNAPSHOT
			? takeSnapshot('interval', true)
			: alarm.name === ALARM_BACKUP
				? runScheduledBackup()
				: alarm.name === ALARM_TRASH
					? purgeTrash()
					: alarm.name === ALARM_UNDO
						? purgeUndo()
						: alarm.name === ALARM_ARCHIVE
							? archiveStaleSessions()
							: undefined;
	void work?.catch(() => undefined);
});

const scheduleSnapshotSoon = () => scheduleSnapshot();
chrome.tabs?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onMoved?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onActivated?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onAttached?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onDetached?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onRemoved?.addListener?.((_tabId, info) => {
	if (!info?.isWindowClosing) {
		scheduleSnapshot();
	}
});
chrome.tabs?.onUpdated?.addListener?.((_tabId, change) => {
	if (
		change.url !== undefined ||
		change.pinned !== undefined ||
		change.groupId !== undefined ||
		change.status === 'complete'
	) {
		scheduleSnapshot();
	}
});
chrome.tabGroups?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.tabGroups?.onUpdated?.addListener?.(scheduleSnapshotSoon);
chrome.tabGroups?.onRemoved?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onFocusChanged?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onRemoved?.addListener?.(() => {
	if (!privateContext) {
		void handleWindowRemoved().catch(() => undefined);
	}
});

void readSettings()
	.then((settings) => syncRecoveryAlarms(settings))
	.catch(() => undefined);

void mutate(async () => {
	await libraryState.pruneRecoveryCopy();
}).catch(() => undefined);
if (privateContext) {
	void privateLock.lockWhenWindowsClosed().catch(() => undefined);
	void resumePrivateLock()
		.then(receiveSentLinks)
		.catch(() => undefined);
	chrome.storage.onChanged.addListener((changes, area) => {
		if (
			area === 'local' &&
			Object.keys(changes).some((key) => isInboxEntryKey(key))
		) {
			void receiveSentLinks().catch(() => undefined);
		}
	});
	chrome.windows?.onCreated?.addListener?.(() => {
		void privateLock.lockWhenWindowsClosed().catch(() => undefined);
	});
	chrome.windows?.onRemoved?.addListener?.((windowId) => {
		void privateLock.lockWhenWindowsClosed(windowId).catch(() => undefined);
	});
	chrome.idle?.onStateChanged?.addListener?.((state) => {
		if (state === 'locked') {
			void privateLock.lock().catch(() => undefined);
		}
	});
}

const PRIVATE_LOCK_OPEN_MESSAGES = new Set<string>([
	'GET_PRIVATE_CONFIG',
	'GET_PRIVATE_LOCK',
	'UNLOCK_PRIVATE',
	'LOCK_PRIVATE',
	'TOUCH_PRIVATE_LOCK',
	'RESET_PRIVATE_LIBRARY',
	'GET_PRIVATE_SERVER',
	'JOIN_PRIVATE_SERVER',
	'HANDOFF_NEW_TAB',
	'PRIVATE_SYNC_STATUS',
]);

async function handlePrivateLockMessage(
	message: TabLodgeMessage,
): Promise<ActionResult> {
	if (!privateContext) {
		return {
			ok: false,
			error:
				'Open Settings in a private window to manage the lock. Regular windows only show its status.',
		};
	}

	await privateConfigReady;
	try {
		switch (message.type) {
			case 'UNLOCK_PRIVATE': {
				if (typeof message.credential !== 'string') {
					return {ok: false, error: 'Enter your password.'};
				}

				await privateLock.unlock(message.credential);
				invalidateSettings();
				await resumePrivateLock();
				void wakeSync().catch(() => undefined);
				break;
			}

			case 'LOCK_PRIVATE': {
				await privateLock.lock();
				invalidateSettings();
				break;
			}

			case 'TOUCH_PRIVATE_LOCK': {
				await privateLock.touch();
				const status = await privateLock.status();
				if (!status.locked && status.state !== 'encrypted') {
					await resumePrivateLock();
				}

				break;
			}

			case 'ENABLE_PRIVATE_LOCK': {
				if (privateConfig.mode !== 'saved' || !privateConfig.configured) {
					return {
						ok: false,
						error:
							'The lock needs a separate saved private library. Choose it in Settings first.',
					};
				}

				if (typeof message.credential !== 'string') {
					return {ok: false, error: 'Choose a password.'};
				}

				const {credential} = message;
				await mutate(async () => {
					await privateLock.enable({value: credential}, message.idleMinutes);
				});
				invalidateSettings();
				void protectPrivateSync({value: credential}).catch(() => undefined);
				if (message.sync === true) {
					await enablePrivateSync(credential).catch(() => undefined);
				}

				break;
			}

			case 'CHANGE_PRIVATE_LOCK_CREDENTIAL': {
				if (
					typeof message.credential !== 'string' ||
					typeof message.current !== 'string'
				) {
					return {ok: false, error: 'Choose a new password.'};
				}

				const {credential, current} = message;
				const failed = await rotatePassword(async () => {
					const before = parseLockRecord(
						(await chrome.storage.local.get([LOCK_RECORD_KEY]))[
							LOCK_RECORD_KEY
						],
					);
					await mutate(async () => {
						await privateLock.changeCredential(current, {value: credential});
					});
					try {
						await rewrapPrivateSyncKey({value: credential, verified: true});
					} catch (error) {
						if (error instanceof RewrapUnconfirmedError) {
							return {ok: false as const, error: REWRAP_UNCONFIRMED_MESSAGE};
						}

						if (before) {
							await mutate(async () => {
								await privateLock.changeCredential(credential, {
									value: current,
									verified: true,
								});
							});
						}

						return {ok: false as const, error: REWRAP_FAILED_MESSAGE};
					}

					return undefined;
				});
				if (failed) {
					return failed;
				}

				break;
			}

			case 'REMOVE_PRIVATE_LOCK': {
				if (typeof message.credential !== 'string') {
					return {ok: false, error: 'Enter your password.'};
				}

				const syncOn =
					(await privateRead(PRIVATE_SYNC_ON_KEY).catch(() => undefined)) ===
						true && (await regularSyncConfig()) !== undefined;
				if (syncOn) {
					return {
						ok: false,
						error:
							'Turn off private sync under Sync first. It needs this password to encrypt what it sends.',
					};
				}

				const {credential} = message;
				await privateLock.checkCredential(credential);
				await takeInSentLinks({ignoreHold: true});
				await mutate(async () => {
					await library.remove([INBOX_PRIVATE_KEY_NAME]);
					await chrome.storage.local.remove([INBOX_PUBLIC_KEY]);
					await privateLock.disable(credential);
				});
				invalidateSettings();
				break;
			}

			case 'RESET_PRIVATE_LIBRARY': {
				if (privateConfig.mode !== 'saved') {
					return {
						ok: false,
						error: 'Only a separate saved private library can be erased.',
					};
				}

				privateSync?.stop();
				privateSync = undefined;
				await privateLock.lock();
				await mutate(async () => {
					const stored = await chrome.storage.local.get(null);
					await chrome.storage.local.remove(
						Object.keys(stored).filter(
							(key) =>
								(key.startsWith(PRIVATE_PREFIX) &&
									key !== PRIVATE_CONFIG_KEY) ||
								key === INBOX_PUBLIC_KEY ||
								isInboxEntryKey(key),
						),
					);
				});
				invalidateSettings();
				break;
			}

			case 'SET_PRIVATE_LOCK_IDLE': {
				const {minutes} = message;
				await mutate(async () => {
					await privateLock.setIdleMinutes(minutes);
				});
				break;
			}

			default: {
				return {ok: false, error: `Unknown ${APP_NAME} action.`};
			}
		}
	} catch (error) {
		return (
			privateLockFailure(error) ?? {
				ok: false,
				error:
					errorMessage(error) ||
					`${APP_NAME} could not change the private lock.`,
			}
		);
	}

	if (
		message.type === 'UNLOCK_PRIVATE' ||
		message.type === 'ENABLE_PRIVATE_LOCK'
	) {
		await receiveSentLinks().catch(() => undefined);
	}

	return {ok: true, ...(await privateLockInfo())};
}

async function handleSyncMessage(
	message: Extract<
		TabLodgeMessage,
		{type: 'SYNC_STATUS' | 'SYNC_CONNECT' | 'SYNC_DISCONNECT' | 'SYNC_NOW'}
	>,
): Promise<ActionResult> {
	if (!syncClient) {
		return {ok: false, error: 'Sync is not available in private windows.'};
	}

	if (message.type === 'SYNC_CONNECT') {
		let status: SyncStatus;
		try {
			status = await syncClient.connect(
				String(message.url ?? ''),
				String(message.token ?? ''),
			);
		} catch (error) {
			if (error instanceof SyncError && error.kind !== 'config') {
				return {
					ok: false,
					error: error.message,
					field: error.kind === 'auth' ? 'token' : 'url',
				};
			}

			throw error;
		}

		await wakeSync();
		return {ok: true, status};
	}

	if (message.type === 'SYNC_DISCONNECT') {
		const status = await syncClient.disconnect();
		await wakeSync();
		return {ok: true, status};
	}

	if (message.type === 'SYNC_NOW') {
		await syncClient.syncNow();
	}

	return {ok: true, status: await syncClient.status()};
}

async function handlePrivateSyncMessage(
	message: Extract<
		TabLodgeMessage,
		{
			type:
				| 'PRIVATE_SYNC_STATUS'
				| 'PRIVATE_SYNC_ENABLE'
				| 'PRIVATE_SYNC_DISABLE'
				| 'PRIVATE_SYNC_NOW';
		}
	>,
): Promise<ActionResult> {
	if (!privateContext) {
		return {
			ok: false,
			error: 'Turn private window sync on from Settings in a private window.',
		};
	}

	try {
		switch (message.type) {
			case 'PRIVATE_SYNC_ENABLE': {
				return await enablePrivateSync(
					typeof message.credential === 'string' && message.credential !== ''
						? message.credential
						: undefined,
					typeof message.serverCredential === 'string' &&
						message.serverCredential !== ''
						? message.serverCredential
						: undefined,
				);
			}

			case 'PRIVATE_SYNC_DISABLE': {
				await privateSync?.disconnect();
				await mutate(async () => {
					await rawLibrary.remove([PRIVATE_SYNC_KEY_KEY, PRIVATE_SYNC_ON_KEY]);
				});

				await wakeSync();
				break;
			}

			case 'PRIVATE_SYNC_NOW': {
				await privateSync?.syncNow();
				break;
			}

			default: {
				break;
			}
		}
	} catch (error) {
		if (error instanceof SyncError) {
			return {ok: false, error: error.message};
		}

		throw error;
	}

	return {ok: true, privateSync: await privateSyncInfo()};
}

const sourcesMutate = serialQueue();

async function readSourcesState(): Promise<SiteSourcesState> {
	const saved = await chrome.storage.local.get([SITE_SOURCES_KEY]);
	return parseSiteSourcesState(saved[SITE_SOURCES_KEY]);
}

function changeSourcesState(change: (state: SiteSourcesState) => void) {
	return sourcesMutate(async () => {
		const state = await readSourcesState();
		change(state);
		await chrome.storage.local.set({
			[SITE_SOURCES_KEY]: siteSourcesValue(state),
		});
		syncClient?.localChanged();
		return state;
	});
}

async function sourcePermitted(source: SiteSource) {
	try {
		return await chrome.permissions.contains({origins: source.origins});
	} catch {
		return false;
	}
}

async function sourceRegistered(source: SiteSource) {
	const scripts = await chrome.scripting.getRegisteredContentScripts({
		ids: [source.scriptId],
	});
	return scripts.length > 0;
}

async function registerSource(source: SiteSource) {
	if (await sourceRegistered(source)) {
		return;
	}

	await chrome.scripting.registerContentScripts([
		{
			id: source.scriptId,
			matches: source.origins,
			js: [SITE_SOURCE_SCRIPT],
			runAt: 'document_idle',
			persistAcrossSessions: true,
		},
	]);
}

async function unregisterSource(source: SiteSource) {
	if (await sourceRegistered(source)) {
		await chrome.scripting.unregisterContentScripts({ids: [source.scriptId]});
	}
}

async function injectSourceIntoOpenTabs(source: SiteSource) {
	const tabs = await chrome.tabs.query({url: source.origins});
	await Promise.all(
		tabs.map(async (tab) =>
			isInteger(tab.id)
				? chrome.scripting
						.executeScript({
							target: {tabId: tab.id},
							files: [SITE_SOURCE_SCRIPT],
						})
						.catch(() => undefined)
				: undefined,
		),
	);
}

async function reconcileSources() {
	if (privateContext) {
		return;
	}

	const state = await readSourcesState();
	const started: SiteSource[] = [];
	const lost: SiteSource[] = [];
	for (const source of SITE_SOURCES) {
		const {enabled} = state.sites[source.id];
		if (sourceChoice(state, source).wanted && (await sourcePermitted(source))) {
			await registerSource(source);
			if (!enabled) {
				started.push(source);
			}

			continue;
		}

		if (enabled) {
			lost.push(source);
		}

		await unregisterSource(source);
	}

	if (!(started.length > 0 || lost.length > 0)) {
		return;
	}

	const dropped: SiteSource[] = [];
	await changeSourcesState((next) => {
		for (const source of started) {
			if (sourceChoice(next, source).wanted) {
				next.sites[source.id] = {enabled: true};
			} else {
				dropped.push(source);
			}
		}

		for (const source of lost) {
			next.sites[source.id] = sourceChoice(next, source).wanted
				? {enabled: false, notice: 'revoked'}
				: {enabled: false};
		}
	});
	const revoked: SiteSource[] = [];
	for (const source of started) {
		if (!dropped.includes(source) && !(await sourcePermitted(source))) {
			revoked.push(source);
		}
	}

	if (revoked.length > 0) {
		await changeSourcesState((next) => {
			for (const source of revoked) {
				next.sites[source.id] = sourceChoice(next, source).wanted
					? {enabled: false, notice: 'revoked'}
					: {enabled: false};
			}
		});
	}

	dropped.push(...revoked);
	await Promise.all(dropped.map(async (source) => unregisterSource(source)));
	void Promise.all(
		started
			.filter((source) => !dropped.includes(source))
			.map(async (source) => injectSourceIntoOpenTabs(source)),
	).catch(() => undefined);
}

async function stopSource(source: SiteSource) {
	await unregisterSource(source);
	await chrome.permissions
		.remove({origins: source.origins})
		.catch(() => undefined);
	await sourcesMutate(async () => {
		const answers = await readCatchUpState();
		await chrome.storage.local.set({
			[SOURCE_CATCH_UP_KEY]: catchUpValue({...answers, [source.id]: []}),
		});
	});
}

async function readOutsideSettings(): Promise<Record<string, unknown>> {
	const stored = await chrome.storage.local.get([
		UI_THEME_KEY,
		UI_ACCENT_KEY,
		PRIVATE_CONFIG_KEY,
	]);
	return {
		uiTheme: asTheme(stored[UI_THEME_KEY]),
		uiAccent: asAccent(stored[UI_ACCENT_KEY]),
		privateAccent: normalizePrivateConfig(stored[PRIVATE_CONFIG_KEY]).accent,
	};
}

async function applyOutsideSettings(
	put: Record<string, unknown>,
	was: Readonly<Record<string, unknown>>,
) {
	const now = await readOutsideSettings();
	const takes = (id: string) =>
		Object.hasOwn(put, id) && (was[id] === undefined || was[id] === now[id]);
	const writes: Record<string, unknown> = {};
	if (takes('uiTheme') && asTheme(put.uiTheme) === put.uiTheme) {
		writes[UI_THEME_KEY] = put.uiTheme;
	}

	if (takes('uiAccent') && isAccent(put.uiAccent)) {
		writes[UI_ACCENT_KEY] = put.uiAccent;
	}

	if (takes('privateAccent') && isPrivateAccent(put.privateAccent)) {
		const config = (await chrome.storage.local.get([PRIVATE_CONFIG_KEY]))[
			PRIVATE_CONFIG_KEY
		];
		writes[PRIVATE_CONFIG_KEY] = {
			...normalizePrivateConfig(config),
			...(isRecord(config) && config),
			accent: put.privateAccent,
		};
	}

	if (Object.keys(writes).length > 0) {
		await chrome.storage.local.set(writes);
	}
}

async function readSyncSources(): Promise<SyncedSource[]> {
	const {choices} = await readSourcesState();
	return Object.entries(choices).map(([id, value]) => ({id, value}));
}

async function applySyncSources(
	put: SyncedSource[],
	remove: string[],
	was: ReadonlyMap<string, unknown>,
) {
	let applied: ReturnType<typeof applySyncedChoices> = {removed: [], kept: []};
	await changeSourcesState((next) => {
		applied = applySyncedChoices(next, put, remove, was);
	});
	await Promise.all(applied.removed.map(async (source) => stopSource(source)));
	await reconcileSources();
}

async function setSiteSource(
	id: unknown,
	enabled: boolean,
): Promise<ActionResult<'SET_SITE_SOURCE'>> {
	const source = siteSourceById(id);
	if (!source) {
		return {ok: false, error: 'Unknown source.'};
	}

	if (privateContext) {
		return {ok: false, error: 'Add or remove sources in a regular window.'};
	}

	if (enabled && !(await sourcePermitted(source))) {
		return {
			ok: false,
			error: `The browser did not grant access to ${source.hosts.join(' and ')}, so ${source.label} stays off.`,
		};
	}

	const state = await changeSourcesState((next) => {
		next.sites[source.id] = {enabled};
		if (enabled) {
			next.choices[source.id] ??= {};
		} else {
			withoutChoice(next, source.id);
		}
	});
	if (enabled) {
		await registerSource(source);
		await injectSourceIntoOpenTabs(source);
	} else {
		await stopSource(source);
	}

	return {ok: true, sources: siteSourceStatuses(state)};
}

async function setSiteSourceColumn(
	id: unknown,
	columnId: unknown,
): Promise<ActionResult<'SET_SITE_SOURCE_COLUMN'>> {
	const source = siteSourceById(id);
	if (!source) {
		return {ok: false, error: 'Unknown source.'};
	}

	if (privateContext) {
		return {ok: false, error: 'Choose source columns in a regular window.'};
	}

	if (
		columnId !== null &&
		(await getStore()).bookmarkColumns.every((column) => column.id !== columnId)
	) {
		return {ok: false, error: 'That column no longer exists.'};
	}

	const state = await changeSourcesState((next) => {
		if (sourceChoice(next, source).wanted) {
			withChoice(
				next,
				source,
				'columnId',
				typeof columnId === 'string' ? columnId : undefined,
			);
		}
	});
	return {ok: true, sources: siteSourceStatuses(state)};
}

async function setSiteSourceKeepOff(
	id: unknown,
	keepOffSite: unknown,
): Promise<ActionResult<'SET_SITE_SOURCE_KEEP_OFF'>> {
	const source = siteSourceById(id);
	if (!source?.keepOffSite) {
		return {ok: false, error: 'That site cannot keep saves off the site.'};
	}

	if (privateContext) {
		return {ok: false, error: 'Change sources in a regular window.'};
	}

	const state = await changeSourcesState((next) => {
		if (sourceChoice(next, source).wanted) {
			withChoice(
				next,
				source,
				'keepOffSite',
				keepOffSite === true ? true : undefined,
			);
		}
	});
	return {ok: true, sources: siteSourceStatuses(state)};
}

async function markSourcesPointed(
	ids: unknown,
): Promise<ActionResult<'SITE_SOURCES_POINTED'>> {
	const sources = Array.isArray(ids)
		? SITE_SOURCES.filter((source) => ids.includes(source.id))
		: [];
	if (privateContext || sources.length === 0) {
		return {ok: true};
	}

	await changeSourcesState((next) => {
		for (const source of sources) {
			next.sites[source.id] = {...next.sites[source.id], pointed: true};
		}
	});
	return {ok: true};
}

const privateSourcesOff = () =>
	privateContext &&
	!(privateConfig.configured && privateConfig.mode === 'shared');

function senderSource(id: unknown, sender: chrome.runtime.MessageSender) {
	const source = siteSourceById(id);
	return source && siteSourceForUrl(sender.tab?.url ?? sender.url) === source
		? source
		: undefined;
}

function sourceNote(source: SiteSource, href: unknown, url: string) {
	const rule = source.discussion;
	const discussion =
		rule && typeof href === 'string' ? normalizeUrl(rule.url(href)) : null;
	return rule && discussion && discussion !== url
		? `${rule.name}: ${discussion}`
		: undefined;
}

function sourceSaveColumn(
	store: Store,
	source: SiteSource,
	state: SiteSourcesState,
	now: number,
) {
	const {id: sourceId, ...look} = source.column;
	const existing =
		store.bookmarkColumns.find(
			(entry) => entry.id === sourceChoice(state, source).columnId,
		) ?? store.bookmarkColumns.find((entry) => entry.id === sourceId);
	if (existing) {
		return existing;
	}

	const claimable = source.columnSites.filter(
		(site) => !columnForUrl(store.bookmarkColumns, `https://${site}/`),
	);
	const column = {
		id: sourceId,
		...look,
		...domainsField(claimable),
		createdAt: now,
		isDefault: false,
	};
	store.bookmarkColumns.push(column);
	return column;
}

async function saveFromSource(
	source: SiteSource,
	{
		url: href,
		title,
		discussion,
	}: {url: unknown; title?: unknown; discussion?: unknown},
): Promise<ActionResult<'SITE_SOURCE_SAVE'>> {
	const state = await readSourcesState();
	if (!state.sites[source.id].enabled || privateSourcesOff()) {
		return {ok: true, outcome: 'off'};
	}

	const url = normalizeUrl(
		typeof href === 'string' ? source.canonicalUrl(href) : null,
	);
	if (!url) {
		return {ok: false, error: `${APP_NAME} could not read that link.`};
	}

	const result = await mutate(async () =>
		withUndo(
			siteSourceUndoLabel(source),
			[STORAGE_KEY],
			async (): Promise<ActionResult<'SITE_SOURCE_SAVE'>> => {
				const store = await getStore();
				if (store.bookmarks.some((bookmark) => bookmark.url === url)) {
					return {ok: true, outcome: 'exists'};
				}

				if (
					(await trashedImportUrls(store.settings, 'bookmarks')).includes(url)
				) {
					return {ok: true, outcome: 'trashed'};
				}

				const now = Date.now();
				const column = sourceSaveColumn(store, source, state, now);
				const notes = sourceNote(source, discussion, url);
				const bookmark: Bookmark = {
					id: makeId(),
					title: await bestBookmarkTitle(
						typeof title === 'string' ? title : '',
						url,
						store.settings.cleanTitles,
					),
					url,
					columnId: column.id,
					...(notes && {notes}),
					...(await savedHere()),
					createdAt: now,
					updatedAt: now,
				};
				store.bookmarks = insertNewBookmarks(
					store.bookmarks,
					[bookmark],
					store.settings.newBookmarkPosition,
				);
				await writeStore(store);
				return {ok: true, outcome: 'saved', column: column.name};
			},
		),
	);
	if (
		result.ok &&
		result.outcome === 'saved' &&
		state.sites[source.id].notice
	) {
		await changeSourcesState((next) => {
			if (next.sites[source.id].notice === 'unreadable') {
				next.sites[source.id] = withoutNotice(next.sites[source.id]);
			}
		});
	}

	return result;
}

async function missingFromSource(
	store: Store,
	source: SiteSource,
	links: unknown,
) {
	const known = new Set([
		...store.bookmarks.map((bookmark) => bookmark.url),
		...(await trashedImportUrls(store.settings, 'bookmarks')),
	]);
	return missingSourceLinks(source, links, (url) => known.has(url));
}

async function readCatchUpState() {
	const saved = await chrome.storage.local.get([SOURCE_CATCH_UP_KEY]);
	return parseCatchUpState(saved[SOURCE_CATCH_UP_KEY]);
}

async function countSourceCatchUp(
	source: SiteSource,
	links: unknown,
): Promise<ActionResult<'SITE_SOURCE_CATCH_UP'>> {
	if (
		!(await readSourcesState()).sites[source.id].enabled ||
		privateSourcesOff()
	) {
		return {ok: true, missing: 0, ask: false};
	}

	const store = await getStore();
	const missing = await missingFromSource(store, source, links);
	const dismissed = (await readCatchUpState())[source.id];
	return {
		ok: true,
		missing: missing.length,
		ask: catchUpAsks(missing, dismissed),
		mode: store.settings.sourceCatchUp,
	};
}

async function addSourceCatchUp(
	source: SiteSource,
	links: unknown,
	automatic: boolean,
): Promise<ActionResult<'SITE_SOURCE_CATCH_UP_ADD'>> {
	const state = await readSourcesState();
	if (!state.sites[source.id].enabled || privateSourcesOff()) {
		return {ok: false, error: `${source.label} is off in ${APP_NAME}.`};
	}

	return mutate(async () =>
		withUndo(
			siteSourceUndoLabel(source),
			[STORAGE_KEY],
			async (): Promise<ActionResult<'SITE_SOURCE_CATCH_UP_ADD'>> => {
				const store = await getStore();
				const missing = await missingFromSource(store, source, links);
				const answered = automatic
					? new Set((await readCatchUpState())[source.id])
					: undefined;
				const added = answered
					? missing.filter((link) => !answered.has(link.url))
					: missing;
				if (added.length === 0) {
					return {ok: true, added: 0};
				}

				const now = Date.now();
				const column = sourceSaveColumn(store, source, state, now);
				const device = await savedHere();
				const inserted: Bookmark[] = [];
				for (const link of added) {
					const notes = sourceNote(source, link.discussion, link.url);
					inserted.push({
						id: makeId(),
						title: await bestBookmarkTitle(
							link.title,
							link.url,
							store.settings.cleanTitles,
						),
						url: link.url,
						columnId: column.id,
						...(notes && {notes}),
						...device,
						createdAt: now,
						updatedAt: now,
					});
				}

				store.bookmarks = insertNewBookmarks(
					store.bookmarks,
					inserted,
					store.settings.newBookmarkPosition,
				);

				await writeStore(store);
				return {ok: true, added: added.length, column: column.name};
			},
		),
	);
}

async function dismissSourceCatchUp(
	source: SiteSource,
	links: unknown,
): Promise<ActionResult<'SITE_SOURCE_CATCH_UP_DISMISS'>> {
	if (privateSourcesOff()) {
		return {ok: true};
	}

	await sourcesMutate(async () => {
		if (!(await readSourcesState()).sites[source.id].enabled) {
			return;
		}

		const missing = await missingFromSource(await getStore(), source, links);
		const state = await readCatchUpState();
		state[source.id] = dismissMissing(state[source.id], missing);
		await chrome.storage.local.set({
			[SOURCE_CATCH_UP_KEY]: catchUpValue(state),
		});
	});
	return {ok: true};
}

const PENDING_SOURCE_MS = 15_000;

const pendingSourceSaves = new Map<
	number,
	{
		source: SiteSource;
		at: number;
		result: Promise<ActionResult<'SITE_SOURCE_SAVE'>>;
	}
>();

async function takePendingSourceSave(
	source: SiteSource,
	sender: chrome.runtime.MessageSender,
): Promise<ActionResult<'SITE_SOURCE_PENDING'>> {
	const tabId = sender.tab?.id;
	const pending = isInteger(tabId) ? pendingSourceSaves.get(tabId) : undefined;
	if (
		!isInteger(tabId) ||
		!pending ||
		pending.source !== source ||
		Date.now() - pending.at > PENDING_SOURCE_MS
	) {
		return {ok: true};
	}

	pendingSourceSaves.delete(tabId);
	const result = await pending.result.catch(() => undefined);
	if (!result?.ok || result.outcome === 'off') {
		return {ok: true};
	}

	const {outcome, column, undoId} = result;
	return {
		ok: true,
		saved: {outcome, ...(column && {column}), ...(undoId && {undoId})},
	};
}

async function undoSourceSave(id: unknown): Promise<ActionResult<'UNDO'>> {
	const labels = new Set(
		SITE_SOURCES.map((source) => siteSourceUndoLabel(source)),
	);
	const records = await undoMutate(async () => readUndo());
	if (
		typeof id !== 'string' ||
		records.every((record) => !(record.id === id && labels.has(record.label)))
	) {
		return {ok: false, error: "Can't undo: it was too long ago."};
	}

	return undoAction(id);
}

const TOAST_UNDO_PREFIX = 'toastUndoTab:';

async function bindToastUndo(
	type: 'QUOTE_UNDO' | 'TRASH_UNDO',
	id: string,
	tabId: number,
) {
	try {
		await chrome.storage.session?.set({
			[`${TOAST_UNDO_PREFIX}${type}:${id}`]: tabId,
		});
	} catch {}
}

async function claimToastUndo(
	type: 'QUOTE_UNDO' | 'TRASH_UNDO',
	id: string,
	tabId: number | undefined,
): Promise<boolean> {
	const key = `${TOAST_UNDO_PREFIX}${type}:${id}`;
	try {
		const stored = await chrome.storage.session?.get(key);
		if (!isInteger(tabId) || stored?.[key] !== tabId) {
			return false;
		}

		await chrome.storage.session?.remove(key);
		return true;
	} catch {
		return false;
	}
}

async function handleSourceMessage(
	message: TabLodgeMessage | undefined,
	sender: chrome.runtime.MessageSender,
): Promise<ActionResult> {
	await privateConfigReady;
	switch (message?.type) {
		case 'SITE_SOURCE_SAVE': {
			const source = senderSource(message.source, sender);
			if (!source) {
				return {ok: false, error: 'This page cannot save to that source.'};
			}

			const result = saveFromSource(source, message);
			const tabId = sender.tab?.id;
			if (source.saveLoadsPage && isInteger(tabId)) {
				const now = Date.now();
				for (const [id, entry] of pendingSourceSaves) {
					if (now - entry.at > PENDING_SOURCE_MS) {
						pendingSourceSaves.delete(id);
					}
				}

				pendingSourceSaves.set(tabId, {source, at: now, result});
			}

			return result;
		}

		case 'SITE_SOURCE_MODE': {
			const source = senderSource(message.source, sender);
			const state = source && (await readSourcesState());
			return {
				ok: true,
				keepOffSite: Boolean(
					source &&
					state?.sites[source.id].enabled &&
					sourceChoice(state, source).keepOffSite &&
					!privateSourcesOff(),
				),
			};
		}

		case 'TOAST_PREFS': {
			return toastPrefs();
		}

		case 'SITE_SOURCE_PENDING': {
			const source = senderSource(message.source, sender);
			return source ? takePendingSourceSave(source, sender) : {ok: true};
		}

		case 'SITE_SOURCE_CATCH_UP': {
			const source = senderSource(message.source, sender);
			return source
				? countSourceCatchUp(source, message.links)
				: {ok: false, error: 'This page cannot save to that source.'};
		}

		case 'SITE_SOURCE_CATCH_UP_ADD': {
			const source = senderSource(message.source, sender);
			return source
				? addSourceCatchUp(source, message.links, message.automatic === true)
				: {ok: false, error: 'This page cannot save to that source.'};
		}

		case 'SITE_SOURCE_CATCH_UP_DISMISS': {
			const source = senderSource(message.source, sender);
			return source
				? dismissSourceCatchUp(source, message.links)
				: {ok: false, error: 'This page cannot save to that source.'};
		}

		case 'SITE_SOURCE_UNREADABLE': {
			const source = senderSource(message.source, sender);
			if (!source || privateContext) {
				return {ok: true, reported: false};
			}

			const state = await changeSourcesState((next) => {
				if (next.sites[source.id].enabled) {
					next.sites[source.id] = {
						...next.sites[source.id],
						notice: 'unreadable',
					};
				}
			});
			return {ok: true, reported: state.sites[source.id].enabled};
		}

		case 'QUOTE_UNDO': {
			const {id} = message;
			if (
				typeof id !== 'string' ||
				!(await claimToastUndo('QUOTE_UNDO', id, sender.tab?.id))
			) {
				return {ok: false, error: "Can't undo: it was too long ago."};
			}

			return undoAction(id);
		}

		case 'TRASH_UNDO': {
			const {id} = message;
			if (
				typeof id !== 'string' ||
				!(await claimToastUndo('TRASH_UNDO', id, sender.tab?.id))
			) {
				return {ok: false, error: "Can't undo: it was too long ago."};
			}

			const result = await restoreTrash(id);
			return result.ok
				? {ok: true, message: `Restored to ${result.placed}.`}
				: result;
		}

		case 'SITE_SOURCE_UNDO': {
			return privateSourcesOff()
				? {ok: false, error: "Can't undo in this window."}
				: undoSourceSave(message.id);
		}

		default: {
			return {ok: false, error: `Unknown ${APP_NAME} action.`};
		}
	}
}

chrome.permissions?.onRemoved?.addListener?.((removed) => {
	const origins = new Set(removed.origins);
	const lost = SITE_SOURCES.filter((source) =>
		source.origins.some((origin) => origins.has(origin)),
	);
	if (privateContext || lost.length === 0) {
		return;
	}

	void (async () => {
		await changeSourcesState((next) => {
			for (const source of lost) {
				if (next.sites[source.id].enabled) {
					next.sites[source.id] = {enabled: false, notice: 'revoked'};
				}
			}
		});
		await Promise.all(lost.map(async (source) => unregisterSource(source)));
	})().catch(() => undefined);
});

async function handleMessage(
	message: TabLodgeMessage | undefined,
	sender: chrome.runtime.MessageSender,
): Promise<ActionResult> {
	await privateConfigReady;
	await mutationQueue;
	if (
		privateContext &&
		!privateConfig.configured &&
		![
			'GET_PRIVATE_CONFIG',
			'GET_PRIVATE_LOCK',
			'SET_PRIVATE_CONFIG',
			'SET_PRIVATE_NEW_TAB_REDIRECT',
			'SET_PRIVATE_ACCENT',
			'HANDOFF_NEW_TAB',
		].includes(message?.type || '')
	) {
		return {
			ok: false,
			error: 'Open the private dashboard to configure private storage first.',
		};
	}

	if (privateContext && !PRIVATE_LOCK_OPEN_MESSAGES.has(message?.type ?? '')) {
		const gate = await lockGate();
		if (gate && !gate.key) {
			return {ok: false, error: LOCKED_MESSAGE, locked: true};
		}
	}

	switch (message?.type) {
		case 'GET_PRIVATE_CONFIG': {
			return {ok: true, ...privateConfig};
		}

		case 'GET_LINK_PREVIEW': {
			return {ok: true, preview: await linkPreview(message.url)};
		}

		case 'GET_SERVER_ICONS': {
			return {ok: true, on: Boolean(await siteIconServer())};
		}

		case 'GET_SERVER_ICON': {
			return {
				ok: true,
				icon: (await serverIcons.iconFor(String(message.url))) ?? null,
			};
		}

		case 'GET_PRIVATE_LOCK': {
			return {ok: true, ...(await privateLockInfo())};
		}

		case 'UNLOCK_PRIVATE':
		case 'LOCK_PRIVATE':
		case 'TOUCH_PRIVATE_LOCK':
		case 'ENABLE_PRIVATE_LOCK':
		case 'CHANGE_PRIVATE_LOCK_CREDENTIAL':
		case 'REMOVE_PRIVATE_LOCK':
		case 'SET_PRIVATE_LOCK_IDLE':
		case 'RESET_PRIVATE_LIBRARY': {
			return handlePrivateLockMessage(message);
		}

		case 'GET_PRIVATE_SERVER': {
			return {ok: true, privateServer: await privateServerInfo()};
		}

		case 'JOIN_PRIVATE_SERVER': {
			return typeof message.credential === 'string' && message.credential !== ''
				? joinPrivateServer(message.credential)
				: {ok: false, error: 'Enter the password.'};
		}

		case 'SET_PRIVATE_CONFIG': {
			if (!['shared', 'saved', 'temporary'].includes(message.mode)) {
				return {ok: false, error: 'Choose a valid private storage mode.'};
			}

			if (
				message.mode !== 'saved' &&
				(await privateLock.readRecord()) !== undefined
			) {
				return {
					ok: false,
					error:
						'The saved private library is locked with a password. Open Settings in a private window, unlock it, and remove the lock before choosing another storage mode. No data was changed.',
				};
			}

			const config: PrivateConfig = {
				...privateConfig,
				mode: message.mode,
				configured: true,
			};
			await chrome.storage.local.set({[PRIVATE_CONFIG_KEY]: config});
			await mutationQueue;
			return {ok: true, ...config};
		}

		case 'SET_PRIVATE_NEW_TAB_REDIRECT': {
			if (typeof message.enabled !== 'boolean') {
				return {
					ok: false,
					error: 'Choose whether private new tabs open the TabLodge dashboard.',
				};
			}

			const config = {...privateConfig, redirectNewTabs: message.enabled};
			await chrome.storage.local.set({[PRIVATE_CONFIG_KEY]: config});
			await mutationQueue;
			return {ok: true, ...config};
		}

		case 'SET_PRIVATE_ACCENT': {
			if (!isPrivateAccent(message.accent)) {
				return {ok: false, error: 'Choose a valid accent for private windows.'};
			}

			const config = {...privateConfig, accent: message.accent};
			await chrome.storage.local.set({[PRIVATE_CONFIG_KEY]: config});
			await mutationQueue;
			return {ok: true, ...config};
		}

		case 'TOAST_PREFS': {
			return toastPrefs();
		}

		case 'GET_STATE': {
			return {ok: true, ...(await getRevisionedStore())};
		}

		case 'GET_STATE_CHANGES': {
			return getStateChanges(String(message.since));
		}

		case 'GET_BOOKMARK_PROMPT': {
			const store = await getStore();
			return {
				ok: true,
				bookmarkColumns: store.bookmarkColumns,
				defaultColumnId: defaultBookmarkColumnId(
					store.bookmarkColumns,
					store.bookmarks,
				),
				existingColumnId: store.bookmarks.find(
					(bookmark) => bookmark.url === message.url,
				)?.columnId,
				settings: store.settings,
			};
		}

		case 'GET_SETTINGS_DEFAULTS': {
			return {ok: true, settings: {...DEFAULT_SETTINGS}};
		}

		case 'SAVE_TABS': {
			return saveTabs(
				message.scope || 'window',
				sender.tab,
				message.folderId || DEFAULT_FOLDER_ID,
				{
					tabIds: message.tabIds,
					groupName: message.groupName,
					includePinned: message.includePinned === true,
					allowDuplicates: message.allowDuplicates === true,
				},
			);
		}

		case 'PREVIEW_SESSION_NAME': {
			return previewSessionName(message, sender.tab);
		}

		case 'SAVE_CURRENT_TAB_TO_GROUP': {
			return saveCurrentTabToGroup(sender.tab);
		}

		case 'RESTORE_GROUP': {
			const result = await restoreGroup(
				message.groupId,
				sender.tab,
				Boolean(message.forceRemove),
				{
					restoreMode: message.restoreMode,
					restoreTarget: message.restoreTarget,
					activate: message.activate,
				},
			);
			return result;
		}

		case 'SWITCH_WORKSPACE': {
			return switchWorkspace(message.groupId, sender.tab);
		}

		case 'DELETE_GROUP': {
			return deleteGroup(message.groupId);
		}

		case 'ARCHIVE_GROUP': {
			return archiveGroup(message.groupId);
		}

		case 'UPDATE_GROUP': {
			return updateGroup(message.groupId, message.fields || {});
		}

		case 'SET_GROUP_ORDER': {
			return setGroupOrder(message.order);
		}

		case 'CREATE_FOLDER': {
			return createFolder(
				message.name,
				message.icon,
				message.color,
				message.colorSessions,
			);
		}

		case 'UPDATE_FOLDER': {
			return updateFolder(
				message.folderId,
				message.name,
				message.icon,
				message.color,
				message.colorSessions,
			);
		}

		case 'DELETE_FOLDER': {
			return deleteFolder(message.folderId);
		}

		case 'DELETE_TAB': {
			return deleteTab(message.groupId, message.tabId);
		}

		case 'MERGE_GROUPS': {
			return mergeGroups(
				String(message.sourceGroupId),
				String(message.targetGroupId),
			);
		}

		case 'ADD_LINKS_TO_SESSION': {
			return addLinksToSession(
				String(message.groupId),
				message.links,
				message.targetTabId || null,
				message.position,
			);
		}

		case 'CREATE_SESSION_FROM_LINKS': {
			return createSessionFromLinks(
				message.links,
				typeof message.name === 'string' ? message.name : '',
			);
		}

		case 'UPDATE_GROUP_FROM_WINDOW': {
			return updateGroupFromWindow(
				String(message.groupId),
				message.mode,
				sender.tab,
			);
		}

		case 'SPLIT_GROUP': {
			return splitGroup(
				String(message.groupId),
				message.tabIds,
				typeof message.name === 'string' ? message.name : '',
			);
		}

		case 'MOVE_TAB': {
			return moveTab(
				message.fromGroupId,
				message.tabId,
				message.toGroupId,
				message.targetTabId || null,
				message.position,
				message.copy === true,
				message.restoreTrashId || null,
			);
		}

		case 'UPDATE_TAB': {
			return updateTab(message.groupId, message.tabId, message.fields || {});
		}

		case 'ADD_BOOKMARK': {
			return addBookmark(message.bookmark || {});
		}

		case 'SAVE_QUOTE': {
			return saveQuote(message.url, message.quote, message.title);
		}

		case 'ADD_BOOKMARKS': {
			return addBookmarks(
				message.bookmarks,
				message.columnId || null,
				message.targetBookmarkId || null,
				message.position,
				message.undoable === true,
			);
		}

		case 'UPDATE_BOOKMARK': {
			return updateBookmark(message.bookmarkId, message.fields || {});
		}

		case 'DELETE_BOOKMARK': {
			return deleteBookmark(message.bookmarkId);
		}

		case 'REMOVE_DUPLICATE_BOOKMARKS': {
			return removeDuplicateBookmarks(message.bookmarkIds);
		}

		case 'CREATE_BOOKMARK_COLUMN': {
			return createBookmarkColumn(
				message.name,
				message.icon,
				message.color,
				message.domains,
			);
		}

		case 'UPDATE_BOOKMARK_COLUMN': {
			return updateBookmarkColumn(
				message.columnId,
				message.name,
				message.icon,
				message.color,
				message.domains,
			);
		}

		case 'DELETE_BOOKMARK_COLUMN': {
			return deleteBookmarkColumn(
				message.columnId,
				message.targetColumnId || null,
				message.discardBookmarks === true,
			);
		}

		case 'REORDER_BOOKMARK_COLUMN': {
			return reorderBookmarkColumn(
				message.columnId,
				message.targetColumnId,
				message.position,
			);
		}

		case 'REORDER_BOOKMARK': {
			return reorderBookmark(
				message.bookmarkIds ?? [message.bookmarkId],
				message.targetColumnId,
				message.targetBookmarkId || null,
				message.position,
			);
		}

		case 'IMPORT_GROUPS': {
			return importGroups(
				message.data as ImportInput,
				'all',
				message.importOptions || {},
			);
		}

		case 'IMPORT_SESSIONS': {
			return importGroups(
				message.data as ImportInput,
				'sessions',
				message.importOptions || {},
			);
		}

		case 'IMPORT_BOOKMARKS_FILE': {
			return importGroups(
				message.data as ImportInput,
				'bookmarks',
				message.importOptions || {},
			);
		}

		case 'IMPORT_BROWSER_BOOKMARKS': {
			return importBrowserBookmarks(
				message.duplicateMode,
				message.titlePolicy,
				message.targetColumnId ?? null,
			);
		}

		case 'ADD_EXCLUDED_ORIGINS': {
			return addExcludedOrigins(
				Array.isArray(message.origins) ? message.origins.slice(0, 500) : [],
			);
		}

		case 'ADD_EXCLUDED_ORIGIN': {
			return addExcludedOrigin(message.origin);
		}

		case 'REMOVE_EXCLUDED_ORIGIN': {
			return removeExcludedOrigin(message.origin);
		}

		case 'UPDATE_SETTINGS': {
			return updateSettings(message.settings || {});
		}

		case 'RESET_SETTINGS': {
			return resetSettings();
		}

		case 'ERASE_DATA': {
			return eraseData(message.scope);
		}

		case 'GET_SNAPSHOTS': {
			return privateContext
				? {
						ok: true,
						enabled: false,
						snapshots: [],
						live: null,
						recovery: null,
					}
				: getSnapshots();
		}

		case 'RESTORE_SNAPSHOT': {
			return privateContext
				? privateSnapshotsError()
				: restoreSnapshot(message.id, message.windowIndex);
		}

		case 'SAVE_SNAPSHOT_AS_SESSION': {
			return privateContext
				? privateSnapshotsError()
				: saveSnapshotAsSession(message.id, message.windowIndex);
		}

		case 'DELETE_SNAPSHOT': {
			return privateContext
				? privateSnapshotsError()
				: deleteSnapshot(message.id);
		}

		case 'CLEAR_SNAPSHOTS': {
			return privateContext ? privateSnapshotsError() : clearSnapshots();
		}

		case 'DISMISS_RECOVERY': {
			return privateContext ? privateSnapshotsError() : dismissRecovery();
		}

		case 'GET_BACKUPS': {
			return getBackups();
		}

		case 'BACKUP_NOW': {
			return backupNow();
		}

		case 'RESTORE_BACKUP': {
			return restoreBackup(message.id);
		}

		case 'DELETE_BACKUP': {
			return deleteBackup(message.id);
		}

		case 'GET_BACKUP_DATA': {
			return getBackupData(message.id);
		}

		case 'GET_FULL_BACKUP': {
			return getFullBackup();
		}

		case 'RESTORE_FULL_BACKUP': {
			return restoreFullBackup(message);
		}

		case 'KEEP_PAGE_COPY': {
			return keepPageCopy(
				await chrome.tabs.get(message.tabId).catch(() => undefined),
			);
		}

		case 'GET_PAGE_COPIES': {
			return getPageCopies();
		}

		case 'GET_PAGE_COPY': {
			return {
				ok: true,
				copy: privateContext
					? null
					: ((await pageCopies.read(String(message.url))) ?? null),
			};
		}

		case 'DELETE_PAGE_COPY': {
			return deletePageCopy(String(message.url));
		}

		case 'ADD_PAGE_COPIES': {
			return {ok: true, copies: await addPageCopies(message.copies)};
		}

		case 'GET_SAVED_IMAGES': {
			return getSavedImages();
		}

		case 'GET_IMAGE_THUMBS': {
			return {
				ok: true,
				thumbs:
					privateContext || !Array.isArray(message.urls)
						? []
						: await savedImages.thumbs(message.urls.map(String)),
			};
		}

		case 'GET_SAVED_IMAGE': {
			return getSavedImage(String(message.url));
		}

		case 'DELETE_SAVED_IMAGE': {
			if (!privateContext) {
				await savedImages.remove(String(message.url));
			}

			return {ok: true};
		}

		case 'ADD_SAVED_IMAGES': {
			return {ok: true, images: await addSavedImages(message.images)};
		}

		case 'GET_TRASH': {
			return getTrash();
		}

		case 'RESTORE_TRASH': {
			return restoreTrash(message.id);
		}

		case 'SHOW_TRASH_UNDO': {
			return showTrashUndo(sender, message);
		}

		case 'DELETE_TRASH': {
			return deleteTrash(message.id);
		}

		case 'EMPTY_TRASH': {
			return emptyTrash();
		}

		case 'UNDO': {
			return undoAction(message.id);
		}

		case 'DROP_UNDO': {
			return dropUndo(String(message.id));
		}

		case 'SEND_TO_PRIVATE': {
			return sendToPrivate(message.targets);
		}

		case 'SEND_TO_PRIVATE_STATE': {
			return {ok: true, state: await sendToPrivateState()};
		}

		case 'GET_STORAGE_USAGE': {
			return getStorageUsage();
		}

		case 'SYNC_STATUS':
		case 'SYNC_CONNECT':
		case 'SYNC_DISCONNECT':
		case 'SYNC_NOW': {
			return handleSyncMessage(message);
		}

		case 'PRIVATE_SYNC_STATUS':
		case 'PRIVATE_SYNC_ENABLE':
		case 'PRIVATE_SYNC_DISABLE':
		case 'PRIVATE_SYNC_NOW': {
			return handlePrivateSyncMessage(message);
		}

		case 'OPEN_PRIVATE_SYNC': {
			return openPrivateSync();
		}

		case 'GET_SHARED_PAGES':
		case 'UPLOAD_SHARED_PAGE':
		case 'DELETE_SHARED_PAGE': {
			return handleSharedPagesMessage(message);
		}

		case 'GET_SITE_SOURCES': {
			return {ok: true, sources: siteSourceStatuses(await readSourcesState())};
		}

		case 'SET_SITE_SOURCE': {
			return setSiteSource(message.source, message.enabled);
		}

		case 'SET_SITE_SOURCE_COLUMN': {
			return setSiteSourceColumn(message.source, message.columnId);
		}

		case 'SET_SITE_SOURCE_KEEP_OFF': {
			return setSiteSourceKeepOff(message.source, message.keepOffSite);
		}

		case 'SITE_SOURCES_POINTED': {
			return markSourcesPointed(message.sources);
		}

		case 'HANDOFF_NEW_TAB': {
			const tabId = sender.tab?.id;
			try {
				return {
					ok: true,
					handedOff:
						isInteger(tabId) &&
						(await handOffNewTab(tabId, message.brave === true, false)),
				};
			} catch (error) {
				if (error instanceof PrivateLockError && error.code === 'locked') {
					return {ok: true, handedOff: false};
				}

				throw error;
			}
		}

		default: {
			return {ok: false, error: `Unknown ${APP_NAME} action.`};
		}
	}
}

async function pageToastPlacement() {
	const {toastPosition, toastDuration} = await readSettings();
	const {top, bottom, left, right, transform} = toastEdges(
		toastPlace(toastPosition, 'bottom'),
		24,
	);
	return {
		edges: {top, bottom, left, right, transform},
		closeMs: toastMs(6000, toastDuration),
	};
}

async function toastPrefs(): Promise<ActionResult<'TOAST_PREFS'>> {
	const {toastPosition, toastDuration} = await readSettings();
	return {ok: true, position: toastPosition, duration: toastDuration};
}

async function showTrashUndo(
	sender: chrome.runtime.MessageSender,
	message: {tabId: number; message: string; trashId: string},
): Promise<ActionResult<'SHOW_TRASH_UNDO'>> {
	const windowId = paletteAnchorWindow(sender);
	const tab = isInteger(message.tabId)
		? await chrome.tabs.get(message.tabId).catch(() => undefined)
		: undefined;
	if (
		windowId === undefined ||
		tab?.windowId !== windowId ||
		!isInteger(tab.id) ||
		!/^https?:/i.test(tab.url ?? '')
	) {
		return {ok: false, error: 'That page cannot show a message.'};
	}

	try {
		const [injected] = await chrome.scripting.executeScript({
			target: {tabId: tab.id},
			func: showQuoteToast,
			args: [
				{
					message: message.message,
					failed: false,
					undo: {
						type: 'TRASH_UNDO' as const,
						id: message.trashId,
						done: 'Restored.',
					},
					theme: asTheme(await readKey(UI_THEME_KEY)),
					...(await pageToastPlacement()),
				},
			],
		});
		if (injected?.result !== true) {
			return {ok: false, error: 'That page cannot show a message.'};
		}

		await bindToastUndo('TRASH_UNDO', message.trashId, tab.id);
		return {ok: true};
	} catch {
		return {ok: false, error: 'That page cannot show a message.'};
	}
}

const EXTENSION_ORIGIN = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const fromPage = sender.url?.startsWith(EXTENSION_ORIGIN) === true;
	Promise.resolve(fromPage ? paletteSender(sender) : sender)
		.then(async (effective) =>
			fromPage
				? handleMessage(message as TabLodgeMessage | undefined, effective)
				: handleSourceMessage(
						message as TabLodgeMessage | undefined,
						effective,
					),
		)
		.then(sendResponse)
		.catch((error: unknown) => {
			sendResponse(
				privateLockFailure(error) ?? {
					ok: false,
					error:
						errorMessage(error) ||
						`${APP_NAME} could not complete that action.`,
				},
			);
		});
	return true;
});

chrome.action.onClicked.addListener((tab) => {
	void handleToolbarAction(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
	if (command === 'save-window') {
		void saveTabs('selected-or-window', tab, DEFAULT_FOLDER_ID, {
			promptName: true,
		}).then((result) => {
			reportBadgeSave(tab, result, `${APP_NAME} could not save this window.`);
		});
	}

	if (command === 'bookmark-page') {
		runMenuAction(tab, `${APP_NAME} could not bookmark this page.`, () =>
			openBookmarkPrompt(tab),
		);
	}

	if (command === 'open-dashboard') {
		void openDashboardForTab(tab);
	}

	if (command === 'open-palette') {
		openPalette(tab).catch((error: unknown) => {
			console.warn(
				errorMessage(error) || `${APP_NAME} could not open the search palette.`,
			);
			flashBadge(tab, false);
		});
	}

	if (command === 'toggle-side-panel') {
		openSidePanel(tab);
	}
});

async function omniboxCatalog() {
	omniboxStore ??= getStore();
	const [store, tabs] = await Promise.all([
		omniboxStore.catch((error: unknown) => {
			omniboxStore = undefined;
			throw error;
		}),
		chrome.tabs.query({}),
	]);
	const own = chrome.runtime.getURL('');
	return {
		store,
		index: omniboxIndex({
			groups: store.groups,
			folders: store.folders,
			bookmarks: store.bookmarks,
			columns: store.bookmarkColumns,
			tabs: tabs.flatMap((tab) =>
				isInteger(tab.id) && tab.url && !tab.url.startsWith(own)
					? [
							{
								id: tab.id,
								windowId: tab.windowId,
								title: tab.title ?? '',
								url: tab.url,
							},
						]
					: [],
			),
		}),
	};
}

async function omniboxEnter(
	text: string,
	disposition: `${chrome.omnibox.OnInputEnteredDisposition}`,
) {
	const {store, index} = await omniboxCatalog();
	const item = findOmniboxItem(text, index);
	if (item?.kind === 'tab') {
		try {
			await chrome.tabs.update(Number(item.ref), {active: true});
			if (item.windowId !== undefined) {
				await chrome.windows.update(item.windowId, {focused: true});
			}

			return;
		} catch {
			await searchDashboard(item.title);
			return;
		}
	}

	if (item?.kind === 'session') {
		await openDashboard(
			await currentWindowId(),
			`?${new URLSearchParams({group: item.ref ?? ''})}`,
			store.settings.dashboardBehavior,
		);
		return;
	}

	if (item?.url) {
		const url = store.settings.removeTrackingParameters
			? stripTrackingParameters(item.url)
			: item.url;
		const [active] =
			disposition === 'currentTab'
				? await chrome.tabs.query({active: true, lastFocusedWindow: true})
				: [];
		const keepsPinned =
			store.settings.keepLodgePinned && active?.pinned && isLodgeTab(active);
		if (isInteger(active?.id) && !keepsPinned) {
			await chrome.tabs.update(active.id, {url});
		} else {
			await chrome.tabs.create({
				url,
				active: disposition !== 'newBackgroundTab',
			});
		}

		return;
	}

	await searchDashboard(text);
}

void chrome.omnibox?.setDefaultSuggestion?.({
	description: `Search ${APP_NAME} for <match>%s</match>`,
});
chrome.omnibox?.onInputChanged?.addListener((text, suggest) => {
	omniboxCatalog()
		.then(({index}) => {
			suggest(omniboxSuggestions(text, index));
		})
		.catch(() => {
			suggest([]);
		});
});
chrome.omnibox?.onInputEntered?.addListener((text, disposition) => {
	omniboxEnter(text, disposition).catch(() => {});
});

function openSidePanel(tab?: chrome.tabs.Tab) {
	if (!chrome.sidePanel?.open) {
		void sidebarAction?.open?.().catch(() => {});
		return;
	}

	const windowId = tab?.windowId;
	const request =
		windowId === undefined
			? chrome.windows
					.getLastFocused()
					.then(async (focused) =>
						chrome.sidePanel.open({windowId: focused.id!}),
					)
			: chrome.sidePanel.open({windowId});
	void Promise.resolve(request).catch(() => {});
}

async function syncToolbarAction(settings: Settings) {
	const sidePanelEnabled = Boolean(
		settings.actionMode === 'sidepanel' && chrome.sidePanel,
	);
	if (chrome.sidePanel) {
		try {
			await chrome.sidePanel.setOptions({
				enabled: true,
				path: 'sidepanel.html',
			});
			await chrome.sidePanel.setPanelBehavior({
				openPanelOnActionClick: sidePanelEnabled,
			});
		} catch {}
	}

	if (!chrome.action?.setPopup) {
		return;
	}

	await chrome.action.setPopup({
		popup:
			settings.actionMode === 'popup' ||
			(settings.actionMode === 'sidepanel' && !sidePanelEnabled)
				? 'popup.html'
				: '',
	});
}

async function saveCurrentTabToGroup(
	senderTab?: chrome.tabs.Tab,
	groupId?: string,
): Promise<ActionResult<'SAVE_CURRENT_TAB_TO_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const windowId = await currentWindowId(senderTab);
		if (!isInteger(windowId)) {
			return {ok: false, error: 'Open a browser window before saving a tab.'};
		}

		const window = (await chrome.windows.get(windowId, {
			populate: true,
		})) as PopulatedWindow;
		const tab =
			window.tabs.find((entry) => entry.id === senderTab?.id) ||
			window.tabs.find((entry) => entry.active);
		if (
			!tab ||
			!isCapturable(tab, store.settings) ||
			(tab.pinned && !store.settings.includePinnedTabs)
		) {
			return {ok: false, error: 'There is no eligible web tab to save.'};
		}

		const group = groupId
			? findGroup(store, groupId)
			: defaultTargetSession(store.groups, store.folders);
		if (!group) {
			return {
				ok: false,
				error: groupId
					? 'That saved session no longer exists.'
					: 'Create a session before sending this tab to a session.',
			};
		}

		if (group.tabs.length >= MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		const nativeGroups = await getWindowGroups(window.id);
		const now = Date.now();
		const tabUrl = normalizeUrl(tab.url)!;
		const title = pageTitle(tab.title, tabUrl, store.settings.cleanTitles);
		const copies = store.groups
			.flatMap((entry) => entry.tabs)
			.filter((entry) => entry.url === tabUrl);
		const duplicate = sessionDuplicates(
			store.groups,
			group.id,
			store.settings.saveDuplicateHandling,
		).isDuplicate(tabUrl);
		if (
			copies.length > 0 &&
			store.settings.saveDuplicateTitle === 'latest' &&
			copies.some((entry) => entry.title !== title)
		) {
			for (const copy of copies) {
				copy.title = title;
			}

			await writeStore(store);
		}

		if (!duplicate) {
			group.tabs.push({
				id: makeId(),
				title:
					copies.length > 0 && store.settings.saveDuplicateTitle !== 'latest'
						? copies[0].title
						: title,
				url: tabUrl,
				notes: copies[0]?.notes || '',
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0 && !store.settings.ignoreTabGroups
						? normalizeNativeGroup(
								nativeGroups.get(tab.groupId),
								String(tab.groupId),
							)
						: null,
				savedAt: now,
				originalIndex: isInteger(tab.index) ? tab.index : group.tabs.length,
			});
		}

		if (!duplicate) {
			group.updatedAt = now;
			await writeStore(store);
		}

		if (duplicate) {
			return {
				ok: false,
				error: duplicateError('session'),
				duplicate: true,
			};
		}

		if (store.settings.closeOnSave) {
			const remaining = await chrome.tabs.query({windowId});
			const candidate = remaining.find((entry) => entry.id === tab.id);
			if (
				candidate &&
				normalizeUrl(candidate.url) === normalizeUrl(tab.url) &&
				(!candidate.pinned || store.settings.includePinnedTabs)
			) {
				if (
					remaining.length === 1 &&
					!(await closeEmptiedWindow(windowId, store.settings))
				) {
					const isFocusedWindow = window.id === (await currentWindowId());
					const useDashboard =
						store.settings.openDashboardAfterSave && isFocusedWindow;
					await chrome.tabs.create({
						windowId,
						url: useDashboard
							? `${DASHBOARD_URL}?group=${encodeURIComponent(group.id)}`
							: NEW_TAB_PAGE_URL,
						active: useDashboard,
					});
				}

				try {
					await chrome.tabs.remove(tab.id!);
				} catch {}
			}
		}

		return {ok: true, count: 1, skipped: 0, groupId: group.id};
	});
}

async function handleToolbarAction(tab?: chrome.tabs.Tab) {
	const settings = await readSettings();
	if (settings.actionMode === 'current-tab-to-group') {
		reportBadgeSave(
			tab,
			await saveCurrentTabToGroup(tab),
			`${APP_NAME} could not add the current tab to a session.`,
		);
		return;
	}

	const scopeByMode: Partial<Record<Settings['actionMode'], SaveScope>> = {
		'current-group': 'current-group',
		'current-window': 'selected-or-window',
		'full-window': 'window',
		'all-windows': 'all-windows',
		'current-tab': 'current-tab',
	};
	const scope = scopeByMode[settings.actionMode];
	if (!scope) {
		return;
	}

	reportBadgeSave(
		tab,
		await saveTabs(scope, tab, DEFAULT_FOLDER_ID, {promptName: true}),
		`${APP_NAME} could not save tabs from the toolbar action.`,
	);
}

async function openDashboardForTab(tab?: chrome.tabs.Tab) {
	const settings = await readSettings();
	const windowId = await currentWindowId(tab);
	await openDashboard(windowId, '', settings.dashboardBehavior);
}

type MenuOutcome = ActionFailure | {ok: true};
type MenuClickData = chrome.contextMenus.OnClickData & {linkText?: string};
const MENU_SAVE_SCOPES: Record<string, SaveScope> = {
	...Object.fromEntries(PAGE_SAVE_ITEMS.map(([id, , scope]) => [id, scope])),
	[MENU.actionSaveWindow]: 'selected-or-window',
};
const MENU_REBUILD_DELAY = 150;
const BADGE_DURATION = 1500;

let menuQueue: Promise<void> = Promise.resolve();
let menuSignature = '';
let menuRebuildTimer: ReturnType<typeof setTimeout> | undefined;
const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	isRecord(value) && typeof value.then === 'function';

function menuCallback(label: string, done?: () => void) {
	return () => {
		const error = chrome.runtime.lastError;
		if (error) {
			console.warn(
				`${APP_NAME} could not ${label}: ${error.message || 'unknown error'}`,
			);
		}

		done?.();
	};
}

function removeAllMenus(): Promise<void> {
	return new Promise((resolve) => {
		try {
			const pending = (chrome.contextMenus as CallbackMenuApi).removeAll(
				menuCallback('clear its menus', resolve),
			);
			if (isThenable(pending)) {
				pending.then(
					() => resolve(),
					() => resolve(),
				);
			}
		} catch (error) {
			console.warn(
				errorMessage(error) || `${APP_NAME} could not clear its menus.`,
			);
			resolve();
		}
	});
}

function updateMenu(
	id: string,
	properties: {checked?: boolean; enabled?: boolean; title?: string},
): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			Boolean(chrome.runtime.lastError);
			resolve();
		};

		try {
			const pending = (chrome.contextMenus as CallbackMenuApi).update(
				id,
				properties,
				done,
			);
			if (isThenable(pending)) {
				pending.then(done, done);
			}
		} catch {
			resolve();
		}
	});
}

async function menuTabOrigin(tab?: chrome.tabs.Tab): Promise<string | null> {
	try {
		const target =
			tab ??
			(await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0];
		const url = normalizeUrl(target?.url);
		return url ? urlHost(url) : null;
	} catch {
		return null;
	}
}

async function saveWindowMenuTitle(settings: Settings) {
	const highlighted = await chrome.tabs.query({
		lastFocusedWindow: true,
		highlighted: true,
	});
	if (selectionSlots(highlighted) <= 1) {
		return 'Save this window';
	}

	const count = selectionSlots(
		highlighted.filter(
			(tab) =>
				isCapturable(tab, settings) &&
				(settings.includePinnedTabs || !tab.pinned),
		),
	);
	return `Save ${count} selected ${count === 1 ? 'tab' : 'tabs'}`;
}

async function excludeMenuState(settings: Settings, tab?: chrome.tabs.Tab) {
	const origin = await menuTabOrigin(tab);
	return {
		checked: Boolean(
			origin && hostIsExcluded(origin, settings.excludedOrigins),
		),
		enabled: Boolean(origin && normalizeExcludedHost(origin)),
	};
}

function rebuildContextMenus(
	source?: Pick<Store, 'settings' | 'bookmarkColumns' | 'groups' | 'folders'>,
): Promise<void> {
	if (source) {
		menuSignature = contextMenuSignature(
			source.settings,
			source.bookmarkColumns,
			menuSessions(source.groups, source.folders),
		);
	}

	const run = async () => {
		if (!chrome.contextMenus?.create) {
			return;
		}

		try {
			const store = source || (await getStore());
			const sessions = menuSessions(store.groups, store.folders);
			menuSignature = contextMenuSignature(
				store.settings,
				store.bookmarkColumns,
				sessions,
			);
			const plan = contextMenuPlan(
				store.settings,
				store.bookmarkColumns,
				sessions,
				{
					appName: APP_NAME,
					hasSidePanel: HAS_SIDE_PANEL,
					hasTabContext: HAS_TAB_MENU,
					hasAmpersandAccessKeys: IS_FIREFOX,
					keepsImages: !privateContext,
				},
				await excludeMenuState(store.settings),
			);
			menuGeneration += 1;
			syncedMenuState = '';
			pageBookmarkTitle = PAGE_BOOKMARK_TITLE.page;
			await removeAllMenus();
			for (const item of plan) {
				chrome.contextMenus.create(
					item,
					menuCallback(`create the menu item "${item.title || item.id}"`),
				);
			}

			menuGeneration += 1;
			syncedMenuState = '';
		} catch (error) {
			console.warn(
				errorMessage(error) ||
					`${APP_NAME} could not build its right-click menus.`,
			);
		}
	};

	menuQueue = menuQueue.then(run, run);
	return menuQueue;
}

function scheduleContextMenuRebuild() {
	if (menuRebuildTimer !== undefined) {
		clearTimeout(menuRebuildTimer);
	}

	menuRebuildTimer = setTimeout(() => {
		menuRebuildTimer = undefined;
		void rebuildContextMenus();
	}, MENU_REBUILD_DELAY);
}

let syncedMenuState = '';
let menuGeneration = 0;
let pageBookmarkTitle: string = PAGE_BOOKMARK_TITLE.page;

async function syncExcludeMenuItem(tab?: chrome.tabs.Tab) {
	if (!chrome.contextMenus?.update) {
		return;
	}

	try {
		const settings = await readSettings();
		if (!settings.contextMenusEnabled || !settings.contextMenuActionEnabled) {
			return;
		}

		const generation = menuGeneration;
		const exclude = await excludeMenuState(settings, tab);
		const title = await saveWindowMenuTitle(settings);
		const state = `${exclude.checked}|${exclude.enabled}|${title}`;
		if (state === syncedMenuState && generation === menuGeneration) {
			return;
		}

		await updateMenu(MENU.actionExclude, exclude);
		await updateMenu(MENU.actionSaveWindow, {title});
		if (generation === menuGeneration) {
			syncedMenuState = state;
		}
	} catch {}
}

onLibraryChanged((changes, areaName) => {
	const change = areaName === 'local' ? changes[STORAGE_KEY] : undefined;
	if (!change || !isRecord(change.newValue)) {
		return;
	}

	void followMenus(
		change.newValue,
		isRecord(change.oldValue) ? change.oldValue : {},
	).catch(() => undefined);
});

async function followMenus(next: Raw, previous: Raw) {
	const sessionsOf = async (state: Raw) =>
		state.layout === 'records'
			? libraryState.readSessionEntries(state)
			: state.groups;
	const before = await sessionsOf(previous).catch(() => undefined);
	const nextSettings = normalizeSettings(
		next.settings as RawSettings | undefined,
	);
	const nextSignature = contextMenuSignature(
		nextSettings,
		normalizeBookmarkColumns(next.bookmarkColumns),
		menuSessions(await sessionsOf(next), next.folders),
	);
	const previousSignature = contextMenuSignature(
		normalizeSettings(previous.settings as RawSettings | undefined),
		normalizeBookmarkColumns(previous.bookmarkColumns),
		menuSessions(before, previous.folders),
	);
	if (nextSignature !== previousSignature && nextSignature !== menuSignature) {
		scheduleContextMenuRebuild();
	}

	const previousOrigins = isRecord(previous.settings)
		? normalizeExcludedOrigins(previous.settings.excludedOrigins)
		: [];
	if (previousOrigins.join(' ') !== nextSettings.excludedOrigins.join(' ')) {
		void syncExcludeMenuItem();
	}
}

chrome.tabs?.onActivated?.addListener?.(() => {
	void syncExcludeMenuItem();
});
chrome.tabs?.onHighlighted?.addListener?.(() => {
	void syncExcludeMenuItem();
});
chrome.tabs?.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
	if (changeInfo.url && tab.active) {
		void syncExcludeMenuItem(tab);
	}
});
chrome.windows?.onFocusChanged?.addListener?.((windowId) => {
	if (windowId !== chrome.windows.WINDOW_ID_NONE) {
		void syncExcludeMenuItem();
	}
});

function watchContextMenuShown() {
	const menus = chrome.contextMenus as ContextMenusWithOnShown | undefined;
	try {
		menus?.onShown?.addListener?.((info, tab) => {
			if (typeof menus.update !== 'function') {
				return;
			}

			const contexts = new Set([
				info?.contextType,
				...(Array.isArray(info?.contexts) ? info.contexts : []),
			]);
			if (contexts.has('action')) {
				void syncExcludeMenuItem(tab).then(() => menus.refresh?.());
			}

			const title = contexts.has('tab')
				? PAGE_BOOKMARK_TITLE.tab
				: PAGE_BOOKMARK_TITLE.page;
			if (!HAS_TAB_MENU || title === pageBookmarkTitle) {
				return;
			}

			pageBookmarkTitle = title;
			void updateMenu(MENU.pageBookmark, {title}).then(() => menus.refresh?.());
		});
	} catch {}
}

watchContextMenuShown();

function flashBadge(
	tab: chrome.tabs.Tab | undefined,
	result: boolean | SaveKind,
) {
	const badge =
		SAVE_BADGES[
			typeof result === 'boolean' ? (result ? 'saved' : 'failed') : result
		];
	const {action} = chrome;
	if (!action?.setBadgeText) {
		return;
	}

	const tabId = isInteger(tab?.id) && tab.id >= 0 ? tab.id : -1;
	const target = tabId >= 0 ? {tabId} : {};
	const previous = badgeTimers.get(tabId);
	if (previous !== undefined) {
		clearTimeout(previous);
	}

	void (async () => {
		try {
			await action.setBadgeBackgroundColor?.({
				...target,
				color: badge.color,
			});
			await action.setBadgeText({...target, text: badge.text});
		} catch {
			return;
		}

		badgeTimers.set(
			tabId,
			setTimeout(() => {
				badgeTimers.delete(tabId);
				void Promise.resolve(action.setBadgeText({...target, text: ''})).catch(
					() => undefined,
				);
			}, BADGE_DURATION),
		);
	})();
}

function saveKindOf(
	result: MenuOutcome | void | {ok: true; count?: number; skipped?: number},
): SaveKind {
	if (!result) {
		return 'saved';
	}

	if (result.ok) {
		const {count, skipped} = result as {count?: number; skipped?: number};
		return saveOutcomeOf({ok: true, count: count ?? 1, skipped}, 'tab').kind;
	}

	return result.duplicate ? 'duplicate' : 'failed';
}

function reportBadgeSave(
	tab: chrome.tabs.Tab | undefined,
	result: Parameters<typeof saveKindOf>[0] | undefined,
	fallback: string,
) {
	const kind = result ? saveKindOf(result) : 'failed';
	if (kind === 'failed') {
		console.warn((result && !result.ok && result.error) || fallback);
	}

	flashBadge(tab, kind);
}

function runMenuAction(
	tab: chrome.tabs.Tab | undefined,
	fallback: string,
	action: () => Promise<MenuOutcome | void>,
	badge = true,
) {
	void action()
		.then((result) => {
			if (result && !result.ok && !result.duplicate) {
				console.warn(result.error || fallback);
			}

			if (badge) {
				flashBadge(tab, saveKindOf(result));
			}
		})
		.catch((error: unknown) => {
			console.warn(errorMessage(error) || fallback);
			if (badge) {
				flashBadge(tab, false);
			}
		});
}

function linkHost(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./i, '') || url;
	} catch {
		return url;
	}
}

async function menuLinkTitle(info: MenuClickData, url: string) {
	const linkText = cleanText(info.linkText, '', 500);
	const selection = cleanText(info.selectionText, '', 500);
	const text = linkText || (selection.length <= 300 ? selection : '');
	return text && !bookmarkTitleIsUrl(text, url)
		? text
		: (await openBookmarkTitleMap()).get(url) || linkHost(url);
}

async function bookmarkToColumn(
	rawUrl: unknown,
	title: string,
	columnId: string,
): Promise<MenuOutcome> {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const store = await getStore();
	if (
		columnId !== BOOKMARK_UNFILED_ID &&
		store.bookmarkColumns.every((column) => column.id !== columnId)
	) {
		return {ok: false, error: 'That bookmark column no longer exists.'};
	}

	return addBookmarks([{url, title}], columnId);
}

async function bookmarkMedia(
	info: MenuClickData,
	tab: chrome.tabs.Tab | undefined,
	columnId: string | 'new',
): Promise<MenuOutcome> {
	const store = await getStore();
	const plan = mediaSave(
		{
			mediaType: info.mediaType,
			srcUrl: info.srcUrl,
			pageUrl: info.pageUrl ?? tab?.url,
			pageTitle: pageTitle(tab?.title, '', store.settings.cleanTitles),
		},
		bookmarkDuplicates(
			store.bookmarks,
			columnId === 'new' ? undefined : columnId,
			store.settings.saveDuplicateHandling,
		).isDuplicate,
		pruneTrash(await readTrash(), store.settings.trashRetentionDays),
	);
	if (!plan.ok) {
		switch (plan.reason) {
			case 'saved': {
				return {ok: false, error: duplicateError('bookmark'), duplicate: true};
			}

			case 'trash': {
				return {
					ok: false,
					error:
						'This address is in the trash bin. Restore it from there to keep it.',
				};
			}

			default: {
				return {
					ok: false,
					error: 'Only media on http and https pages can be saved.',
				};
			}
		}
	}

	return columnId === 'new'
		? openPrefilledBookmarkDialog(plan.url, plan.title, tab)
		: bookmarkToColumn(plan.url, plan.title, columnId);
}

async function openPrefilledBookmarkDialog(
	rawUrl: unknown,
	title: string,
	tab?: chrome.tabs.Tab,
): Promise<MenuOutcome> {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const settings = await readSettings();
	const query = new URLSearchParams({
		bookmarkUrl: url,
		bookmarkTitle: cleanText(title, linkHost(url), 500),
		bookmarkColumn: 'new',
	});
	await openDashboard(
		await currentWindowId(tab),
		`?${query}`,
		settings.dashboardBehavior,
	);
	return {ok: true};
}

function dashboardSearchQuery(text: unknown) {
	const q = literalQuery(
		cleanText(
			typeof text === 'string' ? text.replaceAll(/\s+/g, ' ') : '',
			'',
			500,
		),
	);
	return q ? `?${new URLSearchParams({q})}` : '';
}

async function searchDashboard(
	text: unknown,
	tab?: chrome.tabs.Tab,
): Promise<MenuOutcome> {
	const settings = await readSettings();
	await openDashboard(
		await currentWindowId(tab),
		dashboardSearchQuery(text),
		settings.dashboardBehavior,
	);
	return {ok: true};
}

async function quoteFromMenu(info: MenuClickData, tab?: chrome.tabs.Tab) {
	const pageUrl = info.pageUrl ?? tab?.url;
	const title =
		tab?.url && pageUrl && pageAddress(tab.url) === pageAddress(pageUrl)
			? tab.title
			: undefined;
	let result: ActionResult<'SAVE_QUOTE'>;
	try {
		result = await saveQuote(pageUrl, info.selectionText, title);
	} catch (error) {
		result = {
			ok: false,
			error: errorMessage(error) || `${APP_NAME} could not save this quote.`,
		};
	}

	if (!result.ok) {
		console.warn(result.error);
	}

	const toast = result.ok
		? {
				message: `Quote saved to ${result.placed}.`,
				failed: false,
				...(result.undoId && {
					undo: {
						type: 'QUOTE_UNDO' as const,
						id: result.undoId,
						done: 'Quote removed.',
						expiresMs: UNDO_OFFER_MS,
					},
				}),
			}
		: {message: result.error, failed: true};
	let shown = false;
	if (isInteger(tab?.id)) {
		if (result.ok && result.undoId) {
			await bindToastUndo('QUOTE_UNDO', result.undoId, tab.id);
		}

		try {
			const [injected] = await chrome.scripting.executeScript({
				target: {tabId: tab.id},
				func: showQuoteToast,
				args: [
					{
						...toast,
						theme: asTheme(await readKey(UI_THEME_KEY)),
						...(await pageToastPlacement()),
					},
				],
			});
			shown = injected?.result === true;
		} catch {}
	}

	if (!shown) {
		flashBadge(tab, result.ok);
	}
}

async function toggleExcludedSite(
	tab?: chrome.tabs.Tab,
): Promise<Result<{origin: string; excluded: boolean}>> {
	const origin = await menuTabOrigin(tab);
	if (!origin) {
		return {ok: false, error: 'Open a regular web page to exclude its site.'};
	}

	if (!normalizeExcludedHost(origin)) {
		return {
			ok: false,
			error: 'This site cannot be added to the excluded list.',
		};
	}

	const settings = await readSettings();
	const covering = settings.excludedOrigins.filter(
		(entry) => origin === entry || origin.endsWith(`.${entry}`),
	);
	let result:
		| Awaited<ReturnType<typeof addExcludedOrigin>>
		| Awaited<ReturnType<typeof removeExcludedOrigin>> =
		await (covering.length > 0
			? removeExcludedOrigin(covering[0])
			: addExcludedOrigin(origin));
	for (const entry of covering.slice(1)) {
		if (result.ok) {
			result = await removeExcludedOrigin(entry);
		}
	}

	if (!result.ok) {
		return result;
	}

	const excluded = hostIsExcluded(origin, result.settings.excludedOrigins);
	await updateMenu(MENU.actionExclude, {checked: excluded, enabled: true});
	if (excluded) {
		console.info(
			`${APP_NAME} will skip ${origin} and its subdomains in future session saves.`,
		);
	}

	return {ok: true, origin, excluded};
}

async function openExtensionPage(
	page: 'help.html' | 'options.html',
): Promise<MenuOutcome> {
	if (page === 'options.html' && chrome.runtime.openOptionsPage) {
		await chrome.runtime.openOptionsPage();
	} else {
		await chrome.tabs.create({url: chrome.runtime.getURL(page)});
	}

	return {ok: true};
}

function handleContextMenuClick(info: MenuClickData, tab?: chrome.tabs.Tab) {
	const id = String(info.menuItemId);
	let scope = MENU_SAVE_SCOPES[id];
	if (scope === 'selected' && tab?.highlighted === false) {
		scope = 'this-tab';
	}

	if (scope) {
		runMenuAction(tab, `${APP_NAME} could not save these tabs.`, () =>
			saveTabs(scope, tab, DEFAULT_FOLDER_ID, {promptName: true}),
		);
		return;
	}

	if (id.startsWith(LINK_COLUMN_PREFIX) || id === MENU.linkBookmarkNew) {
		const url = normalizeUrl(info.linkUrl);
		runMenuAction(
			tab,
			`${APP_NAME} could not save this link.`,
			async () => {
				if (!url) {
					return {ok: false, error: 'Only http and https links can be saved.'};
				}

				const title = await menuLinkTitle(info, url);
				if (id === MENU.linkBookmarkNew) {
					return openPrefilledBookmarkDialog(url, title, tab);
				}

				return bookmarkToColumn(
					url,
					title,
					id.slice(LINK_COLUMN_PREFIX.length),
				);
			},
			id !== MENU.linkBookmarkNew,
		);
		return;
	}

	if (id === MENU.imageSave || id.startsWith(IMAGE_SAVE_PREFIX)) {
		void saveImageFromMenu(
			info,
			tab,
			id === MENU.imageSave ? undefined : id.slice(IMAGE_SAVE_PREFIX.length),
		);
		return;
	}

	const mediaPrefix = id.startsWith(IMAGE_COLUMN_PREFIX)
		? IMAGE_COLUMN_PREFIX
		: id.startsWith(MEDIA_COLUMN_PREFIX)
			? MEDIA_COLUMN_PREFIX
			: undefined;
	if (
		mediaPrefix ||
		id === MENU.imageBookmarkNew ||
		id === MENU.mediaBookmarkNew
	) {
		const isNew = !mediaPrefix;
		runMenuAction(
			tab,
			`${APP_NAME} could not bookmark this.`,
			() =>
				bookmarkMedia(
					info,
					tab,
					mediaPrefix ? id.slice(mediaPrefix.length) : 'new',
				),
			!isNew,
		);
		return;
	}

	if (id.startsWith(PAGE_COLUMN_PREFIX) || id === MENU.pageBookmarkNew) {
		const url = normalizeUrl(tab?.url ?? info.pageUrl);
		runMenuAction(
			tab,
			`${APP_NAME} could not bookmark this page.`,
			async () => {
				if (!url) {
					return {ok: false, error: 'Open a regular web page to bookmark it.'};
				}

				const title = pageTitle(
					tab?.title,
					linkHost(url),
					(await readSettings()).cleanTitles,
				);
				if (id === MENU.pageBookmarkNew) {
					return openPrefilledBookmarkDialog(url, title, tab);
				}

				return bookmarkToColumn(
					url,
					title,
					id.slice(PAGE_COLUMN_PREFIX.length),
				);
			},
			id !== MENU.pageBookmarkNew,
		);
		return;
	}

	if (id === MENU.pageKeepCopy) {
		void keepPageCopyFromMenu(tab);
		return;
	}

	if (id.startsWith(PAGE_SEND_PREFIX) || id === MENU.pageSendNew) {
		runMenuAction(
			tab,
			`${APP_NAME} could not send this tab to a session.`,
			() =>
				id === MENU.pageSendNew
					? saveTabs('this-tab', tab, DEFAULT_FOLDER_ID, {promptName: true})
					: saveCurrentTabToGroup(tab, id.slice(PAGE_SEND_PREFIX.length)),
		);
		return;
	}

	if (id === MENU.selectionSearch) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open its search.`,
			() => searchDashboard(info.selectionText, tab),
			false,
		);
		return;
	}

	if (id === MENU.selectionQuote) {
		void quoteFromMenu(info, tab);
		return;
	}

	if (id === MENU.actionExclude) {
		runMenuAction(
			tab,
			`${APP_NAME} could not change this site's exclusion.`,
			() => toggleExcludedSite(tab),
		);
		return;
	}

	if (id === MENU.actionOpen) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open its dashboard.`,
			() => openDashboardForTab(tab),
			false,
		);
		return;
	}

	if (id === MENU.actionSidePanel) {
		openSidePanel(tab);
		return;
	}

	if (id === MENU.actionHelp) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open Help.`,
			() => openExtensionPage('help.html'),
			false,
		);
		return;
	}

	if (id === MENU.actionSettings) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open Settings.`,
			() => openExtensionPage('options.html'),
			false,
		);
	}
}

chrome.contextMenus?.onClicked?.addListener((info, tab) =>
	handleContextMenuClick(info, tab),
);

const REMOVED_LOCKED_KEYS = [
	'tablodge.locked',
	'tablodge.locked.key',
	'tablodge.locked.flag',
	'tablodge.locked.attempts',
];

async function removeLockedLeftovers() {
	await chrome.storage.local.remove(REMOVED_LOCKED_KEYS);
	await chrome.storage.session?.remove(REMOVED_LOCKED_KEYS);
}

async function initializeExtension(openDashboardAtStartup = false) {
	if (privateContext) {
		return;
	}

	await removeLockedLeftovers().catch(() => undefined);
	await mutate(async () => undefined);
	if (openDashboardAtStartup) {
		await runStartupRecovery();
	}

	const store = await getStore();
	await syncRecoveryAlarms(store.settings);
	await syncToolbarAction(store.settings);
	await rebuildContextMenus(store);
	if (store.settings.keepLodgePinned) {
		scheduleLodgeCheck();
	}

	if (!openDashboardAtStartup || !store.settings.openDashboardOnStartup) {
		return;
	}

	if (store.settings.startupBehavior === 'last-session') {
		const archivedFolder = store.folders.find((folder) =>
			isArchivedFolderName(folder.name),
		);
		const latest = store.groups
			.filter((group) => group.folderId !== archivedFolder?.id)
			.toSorted((a, b) => b.createdAt - a.createdAt)[0];
		if (latest) {
			await restoreGroup(latest.id, undefined, false, {restoreMode: 'keep'});
			return;
		}
	}

	await openDashboardForTab();
}

const BROWSER_BOOKMARK_QUIET_MS = 1500;
const BROWSER_IMPORT_KEY = 'browserBookmarkImporting';
let browserBookmarkImporting = false;
let browserBookmarkBurst: chrome.bookmarks.BookmarkTreeNode[] = [];
let browserBookmarkTimer: ReturnType<typeof setTimeout> | undefined;

async function handleBrowserBookmark(node: chrome.bookmarks.BookmarkTreeNode) {
	if (privateContext) {
		return;
	}

	const url = normalizeUrl(node.url);
	if (!url) {
		return;
	}

	const stored = await chrome.storage.session?.get(BROWSER_IMPORT_KEY);
	if (stored?.[BROWSER_IMPORT_KEY] === true) {
		return;
	}

	const store = await getStore();
	const {settings} = store;
	if (
		settings.browserBookmarkAction === 'off' ||
		store.bookmarks.some((bookmark) => bookmark.url === url)
	) {
		return;
	}

	let active: chrome.tabs.Tab | undefined;
	try {
		const focused = await chrome.windows.getLastFocused({
			windowTypes: ['normal'],
		});
		if (isInteger(focused.id)) {
			active = (
				await chrome.tabs.query({active: true, windowId: focused.id})
			).find((tab) => tab.active);
		}
	} catch {
		return;
	}

	if (!active || normalizeUrl(active.url) !== url) {
		return;
	}

	if (settings.browserBookmarkAction === 'ask') {
		await openBookmarkPrompt(active, {title: node.title, fromBrowser: true});
		return;
	}

	const columnId =
		columnForUrl(store.bookmarkColumns, url)?.id ??
		(store.bookmarkColumns.some(
			(column) => column.id === settings.browserBookmarkColumn,
		)
			? settings.browserBookmarkColumn
			: store.bookmarkColumns[0]?.id);
	const result = await addBookmark({title: node.title, url, columnId});
	flashBadge(
		active,
		result.ok ? 'saved' : result.duplicate ? 'duplicate' : 'failed',
	);
}

function flushBrowserBookmarks() {
	browserBookmarkTimer = undefined;
	const burst = browserBookmarkBurst;
	browserBookmarkBurst = [];
	if (burst.length !== 1) {
		return;
	}

	void handleBrowserBookmark(burst[0]).catch((error: unknown) => {
		console.warn(errorMessage(error));
	});
}

chrome.bookmarks?.onImportBegan?.addListener(() => {
	browserBookmarkImporting = true;
	void chrome.storage.session?.set({[BROWSER_IMPORT_KEY]: true});
});

chrome.bookmarks?.onImportEnded?.addListener(() => {
	browserBookmarkImporting = false;
	void chrome.storage.session?.remove(BROWSER_IMPORT_KEY);
});

chrome.bookmarks?.onCreated?.addListener((_id, node) => {
	if (browserBookmarkImporting) {
		return;
	}

	browserBookmarkBurst.push(node);
	clearTimeout(browserBookmarkTimer);
	browserBookmarkTimer = setTimeout(
		flushBrowserBookmarks,
		BROWSER_BOOKMARK_QUIET_MS,
	);
});

chrome.runtime.onInstalled.addListener((details) => {
	void initializeExtension();
	void reconcileSources().catch(() => undefined);
	if (details.reason === 'install') {
		void chrome.tabs.create({
			url: chrome.runtime.getURL('newtab.html'),
			active: true,
		});
	}
});

chrome.runtime.onStartup.addListener(() => {
	void initializeExtension(true);
	void reconcileSources().catch(() => undefined);
});

void wakeSync().catch(() => undefined);
