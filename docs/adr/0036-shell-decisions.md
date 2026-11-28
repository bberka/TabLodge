# 36. Background worker and page script decisions that were code comments (shell)

Status: accepted, 2026-11-25. Issue #442.

## Context

This is the last of the code comments in `apps/extension/shell/`. [ADR 34](0034-service-worker-decisions.md) and [ADR 35](0035-service-worker-decisions-part-2.md) cover `service-worker.ts` up to line 9000. This record covers the rest of `service-worker.ts`: startup, the private lock and sync messages, Sources (the site save integrations), the toolbar and context menus, the address bar search, the browser bookmark watcher, and the message handler. It also covers four small page scripts: `add-bookmark-preload.ts`, `page-copy-capture.ts`, `site-source.ts` (the Sources content script), and `theme-boot.ts`. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Sources settings are in [ADR 9](0009-sources-settings-sync.md) and [ADR 33](0033-shared-remaining-decisions.md). The private lock is in [ADR 28](0028-shared-library-storage-decisions.md).

## Decisions

### Startup (`service-worker.ts:initializeExtension`, `service-worker.ts:evaluateStartup`)

* **Alarms can be lost when the browser restarts,** and the worker may wake without `onStartup`, so the startup checks run on every start (`service-worker.ts:initializeExtension`).
* **An update moves the library to the per-record layout** at once, not at the first edit. Later runs find it current (`service-worker.ts:initializeExtension`, [ADR 34](0034-service-worker-decisions.md)).
* **The browser just started:** the previous run is judged before anything is captured (`service-worker.ts:initializeExtension`, `service-worker.ts:evaluateStartup`).
* **A worker stopped and started again by any event** reopens the live socket and catches up (`service-worker.ts:initializeExtension`, [ADR 27](0027-shared-sync-decisions.md)).
* **The locked area was removed before any release shipped it.** Its storage keys can still sit in a development profile, so they are removed at startup and no orphaned encrypted entry stays (`service-worker.ts:REMOVED_LOCKED_KEYS`, `service-worker.ts:removeLockedLeftovers`).
* **A persisted schema migration is saved once,** through the mutation queue (`service-worker.ts:initializeExtension`).

### Private lock and sync messages (`service-worker.ts:handlePrivateLockMessage`, `service-worker.ts:handlePrivateSyncMessage`)

* **Some messages work while the private library is locked.** They read no library data. The list is `PRIVATE_LOCK_OPEN_MESSAGES`, and the Settings "Finish" button sends one after an interrupted pass (`service-worker.ts:PRIVATE_LOCK_OPEN_MESSAGES`).
* **Turning the lock on with `sync` also starts private sync,** and the set-a-password screen's choice shows in Settings › Sync. The lock stands either way (`service-worker.ts:handlePrivateLockMessage`, [ADR 30](0030-shared-types-decisions.md)).
* **A server that keeps the old password means the library goes back to it** (`service-worker.ts:handlePrivateSyncMessage`).
* **Private sync is only on while its setting is on,** and it needs the password. A key left from a server that is gone does not count (`service-worker.ts:handlePrivateSyncMessage`).
* **Private sync is stopped first** when the library is emptied, so nothing is written back while it is empty. The server's copy stays (`service-worker.ts:handlePrivateSyncMessage`).
* **Without a live client** (no server any more, say), the key and the switch still go (`service-worker.ts:handlePrivateSyncMessage`).
* **A lock protects only the saved separate library.** Moving away from that storage would leave the data encrypted and unreachable, or show another library in its place, so the lock comes off first (`service-worker.ts:handleMessage`).
* **Private windows take no snapshots.** In shared storage mode, the library holds the regular windows' snapshots (`service-worker.ts:handleMessage`, [ADR 35](0035-service-worker-decisions-part-2.md)).
* **The new-tab setting sits in the locked library.** The page shows the lock screen instead (`service-worker.ts:handleMessage`).
* **Private windows that closed while the worker was stopped lock the library** as soon as the worker starts, before any page asks. A new window never counts as one of them, and the check shares one queue with unlocking (`service-worker.ts:handlePrivateLockMessage`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **A lock pass that was cut off finishes as soon as the key is in memory** (`service-worker.ts:resumePrivateLock`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **Locking the screen locks the library too.** The browser wakes the worker for that event (`service-worker.ts:handlePrivateLockMessage`).

### Sources (`service-worker.ts:handleSourceMessage`, `service-worker.ts:reconcileSources`)

* **Sources are the site save integrations,** set in Settings › Sources (`src/app/site-sources.ts`). The choices sync with the regular library's server. Whether a site runs in this browser stays local (`service-worker.ts:readSourcesState`, [ADR 9](0009-sources-settings-sync.md)).
* **A site's content script is registered only while the site is on and the browser grants its optional host permission.** Only the regular worker registers it, since the permission and registration belong to the browser (`service-worker.ts:registerSource`, `service-worker.ts:sourcePermitted`).
* **Pages of the site already open when it is switched on get the script too,** so the user need not reload them (`service-worker.ts:injectSourceIntoOpenTabs`).
* **Reconciling brings registrations in line with the choices and permissions.** It is safe to run any number of times. A site that is on and has its permission runs here (`service-worker.ts:reconcileSources`).
* **A Remove that runs while permissions are checked wins.** Access revoked during the check is handled by the removal handler, and either the check or that handler turns the site off (`service-worker.ts:reconcileSources`).
* **Access that goes after a run is reported as Allow again** in Settings (`service-worker.ts:stopSource`).
* **A site going off** removes its script, its permission, and its "Not now" answers, so adding it again asks afresh (`service-worker.ts:stopSource`).
* **Values from other browsers that are not valid here are left out.** One changed in this browser during a round stays as it is (`service-worker.ts:applyOutsideSettings`, `service-worker.ts:applySyncSources`).
* **Removing a site drops its choices in every browser.** Adding it again starts with the site's own column and save. Turning a site on keeps the choices another browser made (`service-worker.ts:setSiteSource`).
* **Sources state changes run in one queue,** so a Remove that clears the answers cannot be undone by a later finish (`service-worker.ts:sourcesMutate`, `service-worker.ts:changeSourcesState`).
* **A private window takes source saves only after its setup chose the regular library.** Before setup, or with a separate private library, it saves and undoes nothing and never reads a library (`service-worker.ts:saveFromSource`).
* **A content script's message speaks only for its own site,** the one the sending page is on (`service-worker.ts:senderSource`).
* **A source's note is the item's discussion page,** for a site whose items link elsewhere. Only an address the site's own discussion rule accepts is kept (`service-worker.ts:sourceNote`).
* **A source saves into the column chosen in Settings** while it exists. Otherwise it uses the site's source column, added when missing. The fixed id makes two devices that create it at once write the same record (`service-worker.ts:sourceSaveColumn`, [ADR 33](0033-shared-remaining-decisions.md)).
* **The site's own pages saved by hand go to the source column too,** except an address another column already claims (`service-worker.ts:sourceSaveColumn`).
* **An address in the library or the trash counts as saved** for a source save, the same rule as an import (`service-worker.ts:saveFromSource`).
* **The items of a saved page that the library lacks** are the ones not in any column and not in the trash, as a click-save counts them (`service-worker.ts:missingFromSource`).
* **Catch-up adds are applied in the page's order,** one after another, as the site lists them (`service-worker.ts:addSourceCatchUp`).
* **Adding catch-up sites runs through the library's mutation queue, with Undo** (`service-worker.ts:addSourceCatchUp`). **Dismissing a catch-up runs in the sources queue** (`service-worker.ts:dismissSourceCatchUp`).
* **A catch-up added in a hidden tab holds its Undo until the notice is seen,** and removes only its own bookmarks: **Open saved pages** adds from several tabs in turn, so a whole-library Undo would refuse all but the last (`service-worker.ts:removeCatchUp`, `service-worker.ts:startUndoTime`).
* **A source save's result waits for the next page in its tab for a short time.** A click on a favorite link can load another page before the first one can show the result (`service-worker.ts:PENDING_SOURCE_MS`, `service-worker.ts:pendingSourceSaves`).
* **The last source save of each tab is kept from the moment it starts,** so a page that loads while the save still runs waits for it (`service-worker.ts:pendingSourceSaves`).
* **Toast Undo acts only on what that page's toast reported.** The undo ids of each toast are tied to its tab (`service-worker.ts:bindToastUndo`, `service-worker.ts:claimToastUndo`).
* **Messages from web pages** (the site content script and the toasts the worker draws) get only the source actions, their Undo, and the quote and palette toast Undo (`service-worker.ts:handleSourceMessage`, `service-worker.ts:handleMessage`).
* **The choice stays on when access is revoked,** because access is this browser's and the site stays on in the others (`service-worker.ts:reconcileSources`).

### Toasts (`service-worker.ts:pageToastPlacement`, `service-worker.ts:showTrashUndo`)

* **A page toast's place and length are read from the toast settings,** because the page script cannot import `toast-prefs` (`service-worker.ts:pageToastPlacement`, [ADR 32](0032-shared-menus-links-bookmarks-decisions.md)).
* **Messages not sent from an extension page came from the site content script** in a web page (`service-worker.ts:handleMessage`).
* **The window is the feedback,** so only a failure flashes the badge (`service-worker.ts:handleMessage`).

### Toolbar and side panel (`service-worker.ts:openSidePanel`, `service-worker.ts:syncToolbarAction`)

* **The side panel opens synchronously inside a user gesture** (a command, a menu click), so it is not awaited behind other work (`service-worker.ts:openSidePanel`).
* **Refusals to open the sidebar or panel are ignored.** They can only open from a user action, and Side Panel may be missing on an old Chromium build (`service-worker.ts:openSidePanel`).
* **A browser that cannot open the panel from the toolbar button keeps the popup** (Firefox, and old Chromium) (`service-worker.ts:syncToolbarAction`, [Browser support](../architecture.md#browser-support)).
* **A tab is added to the named session,** or to the first session when none is named (`service-worker.ts:saveCurrentTabToGroup`).
* **With no session chosen,** the most recently updated one that is not archived is used (`service-worker.ts:saveCurrentTabToGroup`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **A skipped duplicate leaves its tab open,** as the setting says (`service-worker.ts:saveCurrentTabToGroup`).
* **The source tab may close during a save** (`service-worker.ts:saveCurrentTabToGroup`).

### Address bar search (`service-worker.ts:omniboxCatalog`, `service-worker.ts:omniboxEnter`)

* **"tl" followed by text lists matching open tabs, bookmarks, saved tabs, and sessions,** ranked by the finder's scorer (`service-worker.ts:omniboxCatalog`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **The store it reads is cached** until `invalidateSettings` drops it (`service-worker.ts:omniboxCatalog`).
* **A tab that closed since the list was shown** is searched for in the dashboard instead (`service-worker.ts:omniboxEnter`).
* **The pinned TabLodge tab stays put.** A link meant for the current tab opens beside it (`service-worker.ts:omniboxEnter`).
* **Enter on the typed text itself** opens the dashboard with that search (`service-worker.ts:omniboxEnter`).
* **The address bar has nowhere to report a failed open** (`service-worker.ts:omniboxEnter`).

### Context menus (`service-worker.ts:rebuildContextMenus`, `service-worker.ts:scheduleContextMenuRebuild`)

* **Rebuilds are serialized.** Each one creates its items synchronously right after `removeAll` settles, so two rebuilds never interleave and hit duplicate ids (`service-worker.ts:rebuildContextMenus`).
* **Bursts of storage writes are debounced** (column drags, imports) (`service-worker.ts:scheduleContextMenuRebuild`).
* **A missing menu item** (menus off, or mid-rebuild) is expected, so its error is consumed silently. Reading `lastError` marks it handled, so Chrome does not log it (`service-worker.ts:removeAllMenus`, `service-worker.ts:updateMenu`).
* **`removeAll` with a callback** serves Chrome 116 to 122, which return nothing, and also settles when an implementation returns a promise (`service-worker.ts:removeAllMenus`, `service-worker.ts:menuCallback`).
* **An error from a contextMenus callback is logged,** never thrown (`service-worker.ts:menuCallback`).
* **The menus' signature is kept,** and a storage change that keeps it skips the rebuild (`service-worker.ts:menuSignature`).
* **The toolbar's two dynamic items are cleared** whenever the menus are rebuilt, since new items start from defaults (`service-worker.ts:syncedMenuState`).
* **The shared bookmark item's title** is "Bookmark this tab to" while the tab strip's menu shows it (`service-worker.ts:pageBookmarkTitle`, [ADR 32](0032-shared-menus-links-bookmarks-decisions.md)).
* **The "Exclude this site" checkbox follows the active tab.** Most activations leave both items as they are, so the two updates are skipped then (`service-worker.ts:syncExcludeMenuItem`).
* **The checkbox is cosmetic.** A click still reads the stored exclusions (`service-worker.ts:syncExcludeMenuItem`).
* **Column and settings changes from any page, import, or erase** land in the stored state, so the menus follow them here (`service-worker.ts:followMenus`).
* **Chrome has no `contextMenus.onShown`,** so the feature check makes the watcher a no-op there (`service-worker.ts:watchContextMenuShown`).
* **An incomplete contextMenus API does not stop the worker starting** (`service-worker.ts:watchContextMenuShown`).
* **Most menu actions show no page toast;** only Save quote does. The toolbar badge flashes instead: a check mark for a skipped duplicate, a mark for a failure (`service-worker.ts:runMenuAction`, `service-worker.ts:reportBadgeSave`).
* **The badge shows a save's result** as a failure, a skipped duplicate (nothing stored, something skipped), or a success (`service-worker.ts:saveKindOf`, `service-worker.ts:flashBadge`).
* **A menu action's result** with `duplicate` is a skipped duplicate. It flashes its own badge and is never a success (`service-worker.ts:MenuOutcome`).
* **The title of "Save this window" changes to "Save N selected tabs"** while tabs are selected in the focused window. The toolbar item saves with the selection or window, so the title says what a click saves (`service-worker.ts:saveWindowMenuTitle`).
* **A single-label host** such as `http://wiki/` cannot be an excluded-site entry, so the item is off for it (`service-worker.ts:excludeMenuState`).
* **A menu's exact host name** is null for non-web pages (`service-worker.ts:menuTabOrigin`).
* **The clicked link's title** is its text, a short selection, the open tab's title, or then the host (`service-worker.ts:menuLinkTitle`).
* **A readable host label** is used for a link without text (`service-worker.ts:linkHost`).
* **"Bookmark image to" and "Bookmark video to"** save the media's own address, or the page for a stream, into the chosen column or a new one (`service-worker.ts:bookmarkMedia`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **"New column" opens the add-bookmark dialog** prefilled, and `bookmarkColumn=new` asks it to start a new column. Pages that do not support it ignore the parameter (`service-worker.ts:openPrefilledBookmarkDialog`).
* **A selection search** is sent to the dashboard as written. Text that looks like an operator becomes a quoted phrase (`service-worker.ts:dashboardSearchQuery`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **"Save quote"** saves the selection and confirms it in a page toast, with Undo. The click grants `activeTab`, so no site access is needed. Where the page cannot be scripted, the badge says so instead (`service-worker.ts:quoteFromMenu`).
* **Toggling the site in the excluded list** goes through the same handlers as Settings (`service-worker.ts:toggleExcludedSite`).
* **An excluded host, directly or through a parent domain,** is un-excluded by removing every entry that covers it (`service-worker.ts:toggleExcludedSite`).
* **The tab strip's menu saves the clicked tab** when it sits outside the selection (`service-worker.ts:handleContextMenuClick`).

### Browser bookmark watcher (`service-worker.ts:handleBrowserBookmark`)

* **Offer to add pages bookmarked with the browser's own feature** (the star, Ctrl/Cmd+D). Extensions cannot hook the star, so the worker watches `bookmarks.onCreated` and acts only when exactly one bookmark arrives in a burst (`service-worker.ts:handleBrowserBookmark`, `service-worker.ts:BROWSER_BOOKMARK_QUIET_MS`).
* **Folders count toward a burst** (a pasted folder arrives as a folder and its children) but are never offered (`service-worker.ts:handleBrowserBookmark`).

### Page scripts

* **`add-bookmark-preload.ts`** starts the add-bookmark window's data read while its page bundle loads. The page adopts this request (`add-bookmark-preload.ts`).
* **`page-copy-capture.ts`** is injected by "Keep a copy" with `chrome.scripting` and `activeTab`, so no host permission is needed. It reads a clone of the page as rendered, with the shared extractor, and leaves the copy where the worker's next call picks it up. An injected file cannot return a value, and it runs in the extension's isolated world, so page scripts never see the copy (`page-copy-capture.ts`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **`theme-boot.ts`** applies the saved theme and accent before the first paint, so extension pages never flash the wrong background or accent. `src/shared/theme.tsx` mirrors the chosen theme and accent into this extension's localStorage. Every page loads it as a classic script in `<head>` (`theme-boot.ts`, [ADR 33](0033-shared-remaining-decisions.md)).
* **Storage can be unavailable,** and the HTML default `system` stays (`theme-boot.ts`).
* **The Sources content script (`site-source.ts`)** is registered for a site only while the user has it on and the browser grants its optional host permission. It reads the page when the user clicks. When that click is the site's own save, it hands the link to the service worker and shows the result on the page. On a site's saved page it reads the list and offers to add what TabLodge lacks ([ADR 9](0009-sources-settings-sync.md)). It changes nothing on the site, except on a site set to "Save to TabLodge only". It never makes a request of its own (`site-source.ts` header).
* **Sites whose saved page lists the user's saves in a form that can be read reliably** are the only ones that get the catch-up read (`site-source.ts`).
* **A second copy of the script stays quiet** when Settings injects it into an open tab (`site-source.ts`).
* **The script is off until the worker says otherwise,** so a click before its answer reaches the site does not get stopped (`site-source.ts`).
* **A script left behind by an update or removal** can no longer reach the worker, so it does nothing. Such a script has no runtime id and cannot save, so it never stops a click (`site-source.ts`).
* **Under "Save to TabLodge only", the site never sees the click.** When the link cannot be saved, the click goes on to the site, so the user's save is never lost (`site-source.ts`).
* **The worker keeps a result for the next page of a site whose save loads one,** but a stopped save loaded none. The page shows the result, and a later page in the tab must not show it again (`site-source.ts`).
* **Clicks pass through while a refresh is out.** Only the newest answer counts, so an older answer cannot switch the site back on (`site-source.ts`).
* **A result is shown once, and taken a little later** on a site whose save control loads another page. A page that has gone never takes it (`site-source.ts`).
* **A save whose click loaded the page** (a favorite link on Hacker News) shows its result on that page (`site-source.ts`).
* **The choice in Settings and a private window's library choice can change while the page is open** (`site-source.ts`).
