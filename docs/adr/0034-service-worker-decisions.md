# 34. Service worker decisions that were code comments, part 1 (shell/service-worker.ts)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/shell/service-worker.ts` is the extension's background script. It is about 13,000 lines and held 426 comments. This record covers its first part, lines 1 to 4000: the message and type surface, browser differences, the private-window lock and the shared-library storage locks, library storage and migration, sync and private sync wiring, shared pages, link previews, the private password change and join, saving tabs and naming them, the palette and prompt windows, the pinned Lodge tab, and restores. The later part is in a separate record. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The storage layout is in [ADR 25](0025-paged-library-layout.md), the lock and encryption in [ADR 28](0028-shared-library-storage-decisions.md), and sync in [ADR 27](0027-shared-sync-decisions.md).

## Decisions

### Types and imports

* **Types come from the shared model through `import()` type queries,** not an `import type` statement, which would leave an `export {}` behind in the classic script. The value imports are bundled into the script by the build, and by `tests/worker-source.ts` for the tests (`service-worker.ts` header).
* **A browser window from `populate: true` always has an id and its tabs.** `title` is not in the Chrome API, but it is read when a browser provides it (`service-worker.ts:PopulatedWindow`).
* **A save that skipped duplicates reports the open tabs they came from,** so a save can offer to add them anyway (`service-worker.ts:CaptureResult`).
* **Some browsers return a promise from callback forms** of `removeAll` and `update`, though Chrome's types say they return nothing (`service-worker.ts:CallbackMenuApi`).
* **`contextMenus.onShown` and `refresh` exist only in some Chromium browsers,** so they are feature-detected (`service-worker.ts:ContextMenusWithOnShown`).
* **A record id is a string,** and anything else is treated as empty (`service-worker.ts:recordId`).

### Names and identifiers

* **The display name comes from the manifest's `short_name`,** the one place it is set (`service-worker.ts:APP_NAME`).
* **Storage keys, export formats, and menu ids keep the `tablodge` prefix,** independent of the display name. Changing one would orphan saved data (`service-worker.ts:STORAGE_KEY`, `service-worker.ts:PRIVATE_PREFIX`).

### Browser differences (`service-worker.ts:IS_FIREFOX`)

* **One worker runs in Chromium (a service worker) and in Firefox (an event page).** Differences the code cannot find by looking for an API are keyed off `IS_FIREFOX`, which reads the extension page addresses.
* **A starting or emptied window opens a page that the browser accepts.** Chromium maps `chrome://newtab/` to the new-tab page. Firefox refuses `chrome:` and `about:newtab` addresses, so there a window starts blank and a tab starts without an address (`service-worker.ts:START_WINDOW_URL`, `service-worker.ts:NEW_TAB_PAGE_URL`).
* **Chromium's Side Panel and Firefox's sidebar both show `sidepanel.html`.** Either opens only from a user action (`service-worker.ts:HAS_SIDE_PANEL`).
* **The tab strip's right-click menu exists in Firefox and in Chromium 150 or newer** (`service-worker.ts:HAS_TAB_MENU`, [ADR 32](0032-shared-menus-links-bookmarks-decisions.md)).

### Private windows and the lock (`service-worker.ts:privateWindowIds`, `service-worker.ts:privateLock`)

* **The private windows that exist now are listed by `chrome.windows`,** which needs no permission. Only the private worker sees them. A regular worker has no private windows to list (`service-worker.ts:privateWindowIds`).
* **The lock state for a library is null when none applies:** regular windows, shared and temporary storage, or no lock set (`service-worker.ts:privateLockInfo`).
* **Values of one storage part are sealed with that part's key,** and reads and writes throw while the library is locked (`service-worker.ts:keyFor`).
* **A saved private library's values are sealed and opened in one place.** `rawLibrary` does that, so nothing above it knows the lock exists (`service-worker.ts:rawLibrary`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **A sealed value reads as absent,** not as ciphertext, to the rest of the worker (`service-worker.ts:withoutSealedValues`).
* **The lock record is in local storage, and the data key only in session storage** (`service-worker.ts:privateLock`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **Private sync runs only with separate saved storage** (`service-worker.ts:privateSyncAvailability`).
* **The lock's idle timeout is checked by an alarm,** so pages lock even if nothing reads the library (`service-worker.ts:ALARM_PRIVATE_LOCK`, `service-worker.ts:syncPrivateLockAlarm`).
* **Whatever the worker kept from an unlocked library goes when the key does** (`service-worker.ts:privateLockFailure`, `service-worker.ts:onLibraryChanged`).
* **A cut-off lock pass is finished inside the mutation queue,** and does nothing while locked or when none is pending (`service-worker.ts:resumePrivateLock`).
* **The lock state given to pages is the same for every window.** Regular windows get the status, since the key sits in shared session storage, but cannot change it (`service-worker.ts:privateLockInfo`).

### Shared-library storage locks (`service-worker.ts:acquireSharedLibraryLock`, `service-worker.ts:withSharedLibraryLock`)

* **Web Locks are partitioned between normal and private contexts,** but extension storage is shared. So the two workers use Lamport's bakery lock, with one slot each and normal winning ties (`service-worker.ts:sharedLockTail`, `service-worker.ts:acquireSharedLibraryLock`).
* **Nested recovery queues and concurrent queues in one worker share one acquisition** (`service-worker.ts:withSharedLibraryLock`).
* **Each split worker owns its mutation queue.** A mode change joins that queue, so a write cannot change libraries midway (`service-worker.ts:mutationQueue`).
* **The plain key/value view of the library's storage area is separate from the logical library.** `library` adds the logical state key on top (`service-worker.ts:libraryStorage`, `service-worker.ts:library`).
* **While the lock is being removed, new writes stay plain,** so that pass can finish (`service-worker.ts:storageParts`).

### Library storage and migration (`service-worker.ts:getStore`, `service-worker.ts:migrateStoreOnce`)

* **The rest of the worker sees the library as one store.** Sessions live in their own keys behind it, and the logical key `STORAGE_KEY` is the whole library in the shape the single `tablodge.state` entry always had (`service-worker.ts:libraryState`, [ADR 25](0025-paged-library-layout.md)).
* **Stored values are untrusted.** Only property reads happen before normalization (`service-worker.ts:getStore`).
* **Read paths never write.** The schema migration is saved once, inside `mutate` (`service-worker.ts:migrateStoreOnce`).
* **Migration runs once per worker run, and only while the library is still the old single entry.** It runs inside the mutation queue, so it cannot race a mutation or a concurrent read. If it fails the old layout keeps working, and the next try waits `MIGRATION_RETRY_MS` or a worker restart (`service-worker.ts:migrateStoreOnce`, `service-worker.ts:MIGRATION_RETRY_MS`).
* **A restorable copy is kept through the usual recovery list** before migration, and is skipped when an interrupted attempt already took one (`service-worker.ts:migrateStoreOnce`).
* **An unreadable migration result is refused and reported by `getStore`,** and never overwritten (`service-worker.ts:getStore`).
* **Removing or skipping one tab of a split pair orphans its partner.** Delete, restore-and-remove, and import duplicates all do it (`service-worker.ts:deleteGroup`, `service-worker.ts:restoreGroup`, [ADR 30](0030-shared-types-decisions.md)).

### Sync wiring (`service-worker.ts:nudgeSync`, `service-worker.ts:syncClient`)

* **Changes made on this device go out in the next sync round.** A private window that shares the regular library asks the regular worker, which runs sync, through local storage (`service-worker.ts:nudgeSync`).
* **Theme and accents sync between browsers,** as settings kept outside the library (`platform` in `setting-scopes.ts`). Pages store them themselves, and the private accent sits in the private config, whose other fields stay on this device (`service-worker.ts:OUTSIDE_SETTING_DEFAULTS`, [ADR 11](0011-setting-sync-scopes.md)).
* **Only the regular worker syncs with a self-hosted server.** Private workers never sync, since their library is separate and may be temporary. The client runs its own library reads and writes inside the mutation queue (`service-worker.ts:syncClient`, [ADR 27](0027-shared-sync-decisions.md)).
* **Sources belong to the browser,** so only the regular client carries them, never private sync (`service-worker.ts:syncClient`).
* **Records from other devices are normalized like an import** before they are stored (`service-worker.ts:syncClient`).
* **Private sync uses the regular connection.** A new server or token, or none, starts it over (`service-worker.ts:regularSyncConfig`).
* **A different server or token ends private sync here.** Its key belongs to the old server, so the library must not start syncing to a new one without it. Turning it on again asks for the password once (`service-worker.ts:regularSyncConfig`, `service-worker.ts:privateSync`).
* **Private sync goes to the regular server under `/private`,** and follows the regular connection. With a password, values are encrypted first (`service-worker.ts:createPrivateSyncClient`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **The private client is created when its library can be read,** or stopped when it cannot. `wakeSync` then wakes it (`service-worker.ts:createPrivateSyncClient`, `service-worker.ts:wakeSync`).
* **The fallback alarm follows whether sync is on,** then catches up and reopens the live socket (`service-worker.ts:openPrivateSync`, `service-worker.ts:wakeSync`).

### This device's name (`service-worker.ts:thisDevice`, `service-worker.ts:readDeviceName`)

* **The device name is what the browser gives its sessions and bookmarks** when it saves them: the one set in Settings, else the browser and system. It is read once at start and again when the setting changes, and saves wait for the first read (`service-worker.ts:readDeviceName`, [ADR 33](0033-shared-remaining-decisions.md)).
* **A failed first read keeps the default name,** so later saves do not fail with it (`service-worker.ts:readDeviceName`).

### Shared pages and link previews (`service-worker.ts:linkPreview`, `service-worker.ts:handleSharedPagesMessage`)

* **Link previews are asked of the sync server,** which fetches the page itself. Nothing is asked unless the setting is on and a server is connected. Answers, including misses, are kept while the worker runs (`service-worker.ts:linkPreview`, `service-worker.ts:PREVIEW_CACHE_SIZE`).
* **Offline or refused means no card,** and the next hover asks again (`service-worker.ts:linkPreview`).
* **Shared pages are on the regular sync server** and public at their link. They are never made from a private window, whichever library it uses (`service-worker.ts:handleSharedPagesMessage`, [ADR 12](0012-shared-page-import.md), [ADR 13](0013-live-shared-pages-and-passwords.md)).
* **Server answers that are not strings or ids are read field by field** (`service-worker.ts:serverField`).

### Private password change and join (`service-worker.ts:enablePrivateSync`, `service-worker.ts:joinPrivateServer`, `service-worker.ts:rewrapPrivateSyncKey`)

* **`sync: true` asks for private sync to be turned on** (`service-worker.ts:enablePrivateSync`, [ADR 30](0030-shared-types-decisions.md)).
* **The library's own lock is the one secret.** It must match the server's, so the server and the lock never use two (`service-worker.ts:enablePrivateSync`).
* **A library kept on this device has a password of its own.** The server's replaces it, so there is one (`service-worker.ts:joinPrivateServer`).
* **A join takes the server's password as the lock,** then turns private sync on, so the server's data merges into what is here. Nothing is locked unless the credential opens the server's key (`service-worker.ts:joinPrivateServer`).
* **A lock saved by an earlier try of the same join lets the join carry on** (`service-worker.ts:joinPrivateServer`).
* **After a library's first password, its copy on the server is replaced by an encrypted one.** This is best effort, and the lock is on either way (`service-worker.ts:protectPrivateSync`).
* **After a new password, the server's copy of the sync key is wrapped with it instead.** If the server cannot take it, the caller undoes the change, so the library never has one password and the server another (`service-worker.ts:rewrapPrivateSyncKey`).
* **The server may have taken the new wrapper even when the reply was lost,** so what the server holds now decides. The library keeps the new password, and a second change settles it (`service-worker.ts:RewrapUnconfirmedError`, `service-worker.ts:REWRAP_UNCONFIRMED_MESSAGE`).
* **Another browser may have rewrapped the same key,** so the server's copy is what the swap checks (`service-worker.ts:rewrapPrivateSyncKey`).
* **Password changes run one after another,** from the local write through the server's update and any undo, so two pages cannot each win on one side (`service-worker.ts:rewrapPrivateSyncKey`).
* **Turning private sync on runs in the same queue as password changes.** Its read of the lock and its adoption of the server's password cannot fall between a change's local write and its server update (`service-worker.ts:enablePrivateSyncNow`).
* **A regular window opens Settings › Sync in a new private window** to turn private sync on, since only a private window can read the private library and ask for its password (`service-worker.ts:openPrivateSync`).
* **What the server holds for the private library** is read for the set-a-password screen. Errors count as nothing found (`service-worker.ts:privateServerInfo`).

### Saving tabs and naming them (`service-worker.ts:captureTabs`, `service-worker.ts:saveTabs`)

* **The tabs a save would store** are web pages only, without excluded sites, and with pinned tabs only when allowed (`service-worker.ts:captureTabs`).
* **Split pairs get a shared pair key** after exclusions, pinned filtering, and duplicate rejection. A pair whose partner was dropped is stored as a plain tab (`service-worker.ts:assignSplitPairs`).
* **A split view's id is the browser's, and `null` when a tab is not split.** Chromium can report both halves of an active split as highlighted, and that alone is not a multi-tab selection (`service-worker.ts:splitViewOf`, `service-worker.ts:selectionSlots`).
* **Rejected duplicates are not stored again, and their tabs stay open,** so the save can offer to add them anyway. Allowed duplicates share notes, and by policy the title, with the copies already saved (`service-worker.ts:saveTabs`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **A new session takes only the duplicate setting into account** (`service-worker.ts:saveTabs`).
* **A capture with tabs is always a stored session.** A session holds at most 1,000 links, so a large capture becomes several numbered sessions (`service-worker.ts:saveTabs`, `service-worker.ts:sessionFullError`).
* **"Save only the focused tab" applies to selection saves** (shortcut, menus, and the toolbar's selected-or-window mode). A whole-window save keeps both halves of a pair, and a quick-popup pick is saved as chosen (`service-worker.ts:captureTabs`).
* **Explicit picks from the quick popup override the scope,** so unhighlighted tabs can be chosen. The popup can allow pinned tabs for one save without changing the stored setting (`service-worker.ts:captureTabs`).
* **A save across several windows is numbered per window** when named, such as "Name (1/3)" (`service-worker.ts:saveTabs`).
* **A titled native tab group keeps its title,** so there is nothing to ask (`service-worker.ts:saveTabs`).
* **A save with no page that can ask for a name** (shortcut, right-click menu, toolbar button) saves with the fallback name first, then opens the small name prompt for `ask` (`service-worker.ts:saveTabs`, `service-worker.ts:openNamePrompt`).
* **Cancelling the name prompt keeps the fallback name,** and a failure to open it never fails the save (`service-worker.ts:openNamePrompt`).
* **The sessions are saved with the fallback name first,** and the prompt only renames them. It is a convenience, so the save does not wait on it (`service-worker.ts:openNamePrompt`).
* **A workspace switch saves the window but leaves its tabs open** until the other session is open. This save does not open the dashboard (`service-worker.ts:saveTabs`, `service-worker.ts:switchWorkspace`).
* **Closing a window a save empties** happens only when the setting asks, and another normal window of the same incognito state is open. That window is focused first. Otherwise the window keeps a new tab (`service-worker.ts:closeEmptiedWindow`).
* **A tab can close while a save is completed,** so the save falls back to keeping the window open (`service-worker.ts:closeEmptiedWindow`).
* **"Force add" stores tabs whose address is already saved,** whatever the duplicate setting says (`service-worker.ts:saveTabs`).
* **A name is previewed for Settings** with the same formatter, the chosen style and template, and the tabs of the sender's window (`service-worker.ts:previewSessionName`).
* **The name for a "Bookmark this page" action** comes from the active tab of the last focused normal window. The prompt takes focus afterwards (`service-worker.ts:openBookmarkPrompt`).
* **A column that claims the site takes the bookmark without asking** (`service-worker.ts:openBookmarkPrompt`).

### Palette and prompt windows (`service-worker.ts:openPaletteInPage`, `service-worker.ts:openPalette`)

* **The palette shows over the page the shortcut was pressed on,** using the activeTab grant that the shortcut gives. No content script runs on any page, and no site permission is requested. Where that is not possible it falls back to a small window of its own: chrome pages, the Web Store, the PDF viewer, and extension pages (`service-worker.ts:openPaletteInPage`, `service-worker.ts:openPalette`).
* **The dashboard has a search palette of its own,** so the shortcut toggles that one instead of injecting a frame (`service-worker.ts:openPaletteInPage`).
* **Messages from the palette act on the window it was opened over,** not on the palette's own window, which is no place to restore tabs into (`service-worker.ts:paletteSender`, `service-worker.ts:paletteAnchorWindow`).
* **Without a window position, the browser places the prompt or palette itself** (`service-worker.ts:openNamePrompt`, `service-worker.ts:openPalette`).
* **The name prompt is centered near the top of the window that was saved** (`service-worker.ts:NAME_PROMPT_WIDTH`, `service-worker.ts:openNamePrompt`).

### Pinned Lodge tab (`service-worker.ts:ensureLodgePinned`, `service-worker.ts:scheduleLodgeCheck`)

* **The pinned TabLodge tab is the window's fixed home.** The worker prefers the one in this window and never moves it. Keeping the dashboard open is the fallback when the browser cannot move it (`service-worker.ts:ensureLodgePinned`).
* **With "Keep TabLodge pinned" on, each normal window gets exactly one pinned TabLodge tab.** Checks are debounced (`service-worker.ts:LODGE_CHECK_DELAY_MS`, `service-worker.ts:scheduleLodgeCheck`).
* **Fighting the user is avoided.** If the user closes or unpins the tab twice within `LODGE_FIGHT_WINDOW_MS`, the window is left alone until it is focused again (`service-worker.ts:lodgeUndoneAt`, `service-worker.ts:lodgePaused`).
* **Only user-triggered repairs are recorded** when the user last removed or unpinned the tab, per window (`service-worker.ts:lodgeUserTriggered`).
* **A window can close while it is being checked,** and that is not an error (`service-worker.ts:runLodgeChecks`).

### Restores (`service-worker.ts:restoreRecords`, `service-worker.ts:restoreGroup`)

* **A restore into a new window** starts with a bootstrap tab, removed once the restored tabs are open. Chromium rejects bounds that are mostly off the visible desktop on some displays, so those are not used (`service-worker.ts:createRestoreWindow`).
* **Restores go into the window chosen, or a new one** (`service-worker.ts:chooseRestoreWindow`).
* **A split pair is made after its two tabs are created.** The tabs were created next to each other, with the same pinned state and in the same tab group, so the browser's same-group rule holds. If the browser refuses, a non-adjacent pair is moved together and split again (`service-worker.ts:splitRestoredPair`).
* **Tabs open in saved order,** so the halves of a pair are created next to each other (`service-worker.ts:restoreRecords`).
* **Grouping comes before splitting.** Creating a split needs both tabs in one group, and `tabs.group` keeps the pair adjacent in the group's tab ids (`service-worker.ts:restoreRecords`).
* **Only pairs whose two tabs both opened are split.** A skipped or failed partner leaves a plain tab (`service-worker.ts:restoreRecords`).
* **Titles, colors, and collapsing are applied after splitting,** so a pair is never split inside a collapsed group (`service-worker.ts:restoreRecords`).
* **Group metadata is best effort,** and so is tab grouping on Chromium builds that lack it (`service-worker.ts:restoreRecords`).
* **Discarding waits until a tab has committed its address.** A tab discarded during its first navigation loses the address and reopens blank, so tabs that are not there yet are discarded when `tabs.onUpdated` reports their URL, for up to a minute (`service-worker.ts:unloadWhenCommitted`, `service-worker.ts:UNLOAD_WAIT_MS`).
* **Split tabs stay loaded.** Either half can be on screen next to the active tab, and discarding one would leave a blank pane (`service-worker.ts:restoreRecords`).
* **A restore of more than `RESTORE_BATCH_THRESHOLD` tabs opens them in batches,** so the browser never has hundreds of pages loading at once (`service-worker.ts:RESTORE_BATCH_THRESHOLD`, `service-worker.ts:RESTORE_BATCH_SIZE`).
* **A batch waits until at most `RESTORE_BATCH_SLACK` tabs are still loading,** or for `RESTORE_BATCH_WAIT_MS`, so a few slow pages do not hold the next batch back. The wait never rejects (`service-worker.ts:waitUntilLoaded`, `service-worker.ts:RESTORE_BATCH_POLL_MS`).
* **With unloading on, a batch is unloaded after it loads,** so memory use stays near one batch. The active tab and split pairs stay loaded (`service-worker.ts:restoreRecords`).
* **A restore of one tab of a pair passes one record,** so the pair logic leaves it a plain tab (`service-worker.ts:restoreRecords`).
* **A restore opens every tab, even when the window already shows its address,** and restores into that window when asked (`service-worker.ts:restoreGroup`).
* **Workspace switch** saves the window's web tabs as a new session, unless a saved session already has exactly those pages, opens another session in the same window, and then closes the saved tabs. A window that already shows a saved session is not saved a second time (`service-worker.ts:switchWorkspace`).
