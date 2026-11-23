# 22. Android library decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/src/library` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The sync client is [ADR 1](0001-record-level-sync-protocol.md) and [ADR 10](0010-settings-sync.md); the trash shape is shared with the extension and the server. The mobile area's other decisions are in [ADR 20](0020-mobile-decisions.md), [ADR 21](0021-mobile-ui-decisions.md), and the private and settings files [ADR 18](0018-mobile-private-decisions.md) and [ADR 19](0019-mobile-settings-decisions.md).

## Decisions

### Background sync and widgets

* **One background round runs about every 15 minutes, with no live connection.** `src/library/background-sync.ts:MINUTES`. It runs while a server is connected and **Sync in the background** is on. A round is the same pull and push the app does on open. It holds no wake lock.
* **Fifteen minutes is Android's floor for periodic work.** `background-sync.ts:MINUTES`. Android may wait longer to batch the run with other apps.
* **The task is defined when the bundle loads.** `background-sync.ts:defineBackgroundSync`. Android may start the app only to run the task, and it finds the task this way, before the app mounts.
* **One background round reads the saved library if this process has not yet.** `background-sync.ts:runBackgroundSync`. It redraws the widgets only when the round changed the library.
* **Registering the task is serial and reads state when it starts.** `background-sync.ts:reconcile`. A quick off and on cannot end with the task cancelled.
* **A failed registration is tried again on the next change.** `background-sync.ts:reconcile`.
* **The widget's copy is written only when something it shows changed.** `src/library/widget-sync.ts:publishWidgetSnapshot`. A session edit does not redraw the widgets.
* **The widget copy is written at once on every change.** `widget-sync.ts:publishWidgetSnapshot`. A save from the share sheet or a tile closes the app moments later.
* **The widget copy is not written before the library is read.** `widget-sync.ts:publishWidgetSnapshot`. An empty store would delete the widget's copy.
* **The widget format is versioned.** `src/library/widget-snapshot.ts`. The Kotlin side refuses any other version and shows its "not loaded" message.
* **All is offered in the widget even when the app hides its All chip.** `widget-snapshot.ts:isWebLink`. Each column's first web links come in the column's own order, capped so the file stays small.
* **A row in the widget opens its link the way the regular library's Open links setting says.** `widget-snapshot.ts:WidgetSnapshot`.

### Library store and sync

* **Reads and writes run one after another.** `src/library/library-core.ts:run`. This is the same as the extension's service worker. Screens redraw at once; the save to SQLite follows and holds the next edit, not the screen.
* **No save runs before the saved library is read.** `src/library/library-store.ts:loaded`. A save that arrives early would be written over the saved library, or start from an empty one and send a delete for everything. An early edit, such as a link shared into a cold start, waits.
* **One switch decides whether settings travel through sync.** `library-store.ts:syncClient`. The app's own and the extension's settings both follow it.
* **The phone keeps no backup of its own.** `library-store.ts:syncClient`. Every write is either the user's edit or a merge of the server's records, and the extension keeps the only other copy.
* **The library is read without opening the live connection.** `library-store.ts:loadLibrary`. Background sync starts here, since the app may not be running.
* **A connection starts the private library's sync on the same connection.** `library-store.ts:connectServer`.
* **Disconnecting stops the private library's sync too, and both libraries stay on the phone.** `library-store.ts:disconnectServer`.
* **A change is sent after a short delay.** `library-store.ts:editRegular`. Trash changes go with the next sync.
* **Going to the background sends what is waiting and closes the live connection.** `library-store.ts:pauseSync`. `wakeSync` reopens it when the app returns, so nothing keeps the radio awake.
* **Resetting or changing an extension setting that travels with the library sends it at the next sync.** `library-store.ts:resetSyncedSettings` and `setSyncedSetting`.
* **Extension settings that travel with the library keep the extension's defaults.** `library-store.ts:resetSyncedSettings`.

### Sample data (dev builds only)

* **A fresh dev install starts with sample data.** `library-store.ts:seed`. It is skipped when a server is connected or when `EXPO_PUBLIC_SEED_DATA=0`.
* **Sample data is loaded only in dev builds.** `library-store.ts:sampleModule`. The import sits inside a `__DEV__` condition, which Metro removes from release bundles. The directive that disables the lint rule for that import states its reason.
* **Sample data is removed before connecting.** `library-store.ts:connectServer`, so it never reaches the real library.
* **Sample data is refused while a server is connected.** `library-store.ts:loadSampleData`. Its records would be sent to the server.
* **Clearing works without telling the server only while no server is connected.** `library-store.ts:clearLibrary`. A connected library would send the deletes.
* **The seed flag is kept in storage.** `library-store.ts:SEED_KEY`. It is `on` while the library holds sample data and `off` once it was cleared or a server was connected.
* **The seed fixture is the extension's.** `src/library/seed.ts`. It is the same fixture the extension's `dev:chrome --seed-data` loads. `apps/mobile/tests/mobile-library.test.ts` checks the shape.

### Board and session edits

* **Each edit returns only the new store.** `src/library/board-edits.ts` and `session-edits.ts`. A screen counts what an edit added by comparing stores, as in `save-outcome.ts`.
* **The "All bookmarks" column is not stored and cannot change.** `board-edits.ts:ALL_BOOKMARKS_ID`.
* **A bookmark that points at a missing column shows in Unfiled.** `board-edits.ts:columnViews`.
* **A new bookmark goes to the end of its column, unless it is a duplicate.** `board-edits.ts:addBookmark`. The shared rule in `save-rules.ts` decides: a column never holds a link twice, and the duplicate setting covers the other columns. A missing column falls back as the extension does.
* **A duplicate leaves the store as it was.** `board-edits.ts:addBookmark`.
* **A moved bookmark keeps its place, unless its column changes.** `board-edits.ts:updateBookmark`. A bookmark whose column changes goes to the end of the new column, as in the extension.
* **Tags and removed kinds are put back for Undo.** `board-edits.ts:setBookmarkTags`.
* **A bookmark removed for Undo keeps its place.** `board-edits.ts:removedBookmarks`. Each bookmark records the bookmark before it that stays, or nothing when it was first.
* **A restored bookmark gets a new id, though the server would take the old one back.** `board-edits.ts:restoreBookmarks`. A newer change beats a delete on the server.
* **Restored neighbours come back in their old order.** `board-edits.ts:restoreBookmarks`. The last one restored behind each anchor is kept.
* **A column's icon and colour are rebuilt, so an empty value drops the field.** `board-edits.ts:updateColumn`.
* **A column's sites are normalised and de-duplicated, and an empty list removes the field.** `board-edits.ts:setColumnSites`.
* **A column deleted with no other column to take its bookmarks sends them to Unfiled.** `board-edits.ts:deleteColumn`.
* **A restored column reconnects links that were moved out of it.** `board-edits.ts:restoreColumn`. A source column that the browser saved to again rejoins its bookmarks.
* **A session folder cannot be renamed or deleted when it is Unfiled or Archived.** `session-edits.ts:isArchived` and `folderNameProblem`.
* **There is a limit of 200 folders.** `session-edits.ts:folderLimitProblem`. The rules are the extension's.
* **Deleting a folder moves its sessions to Unfiled.** `session-edits.ts:deleteFolder`, as the extension does.
* **A folder that colours its sessions colours a session moved into it.** `session-edits.ts:moveSession`.
* **The Archived folder is made when it is first needed.** `session-edits.ts:archiveSession`.
* **Unarchiving goes to Unfiled, or the first folder that is not Archived.** `session-edits.ts:unarchiveSession`.
* **A saved session's description is cut to the extension's limit.** `session-edits.ts:DESCRIPTION_MAX`, from the extension's `SESSION_TEXT_MAX`.
* **In a new session only the duplicate setting applies.** `session-edits.ts:addSession`. Nothing left means no session.
* **A session's title changes in every saved copy of the same address, but a new address belongs to one saved link only.** `session-edits.ts:updateSessionTab`, as in the extension.
* **Sessions are sorted as the extension's sort setting says, and All leaves out archived ones.** `session-edits.ts:sessionsIn`. `custom` keeps the library's own order.
* **Sessions in a folder that no longer exists fall under Other.** `session-edits.ts:sessionFolders`.
* **Opening a session notes when, for the recently opened sort.** `session-edits.ts:markSessionOpened`.

### Trash

* **The trash has the same shape as the extension and the server.** `src/library/trash.ts`. A deletion on one device can be restored on another, both ways.
* **The trash keeps the old app's entries readable.** `trash.ts:fromEarlier`. An entry stored in the earlier shape, with its details beside the id, is read.
* **Entries from other devices are read defensively.** `trash.ts:restoreEntry`. Anything that does not look like a session, link, bookmark or column is refused.
* **Retention is the extension's: 30 days by default, and 500 entries at most.** `trash.ts:DEFAULT_RETENTION_DAYS` and `TRASH_MAX_ITEMS`.
* **The retention is read each time, because the setting itself syncs.** `trash-storage.ts:readTrash`.
* **Adding an entry purges expired ones.** `trash.ts:addToTrash`. A retention that is not a positive number keeps the default.
* **An entry restored to a new place says where it went.** `trash.ts:restoreEntry`. Where the folder or column is gone it goes to the first one, and the message says so. Bookmarks get new ids; everything syncs, because a restore is newer than the delete.
* **A link moved out of a deleted column goes back only if it is still where it was put.** `trash.ts:restoreEntry`.
* **Expiry runs on each device's own clock, and nothing is sent for it.** `trash-store.ts:purgeTrash` and `trash-storage.ts:changeTrash`. A device drops expired items from its own copy when it opens the trash or starts. `readTrash` hides them without writing them back, so an offline device keeps its stored copy until its next trash write. The comment that said expiry happens on every device at once was wrong, and it is not carried into this ADR.
* **Trash changes queue, so two deletes made together both land.** `trash-storage.ts`. The regular and private trash each have a list, and the private list is offered only while the private library is open.
* **A trash change waits for the queued ones.** `trash-storage.ts`, the queue wait. A caller about to delete the trash is not overtaken.
* **What a round brings in is added in one step of the queue.** `trash-storage.ts:readTrash`. A delete made on the phone meanwhile stays.
* **The screens' trash keeps what was just deleted on screen.** `trash-store.ts:trashDeleted`.

### Shared content

* **The file name decides a shared file first.** `src/library/shared-content.ts:fileKind`. Apps often send a generic or wrong type.
* **Shared text is cleaned of the quotation marks Chrome adds to a selection.** `shared-content.ts:unquote`.
* **A selection Chrome shares becomes a quote with a link to the passage.** `shared-content.ts:readShare`, with `#:~:text=` where one can be made. Other words open Save link, which offers to save them as a quote.
* **A shared page title is the words around its link.** `shared-content.ts:readShare`, and `store-shape.ts:splitShared`.
* **When a shared file cannot be copied, the library falls back to its address, which the app cannot read.** `shared-content.ts:readShare`.
* **Only the share library's copies in the app's cache are deleted.** `shared-content.ts:cacheCopies`. Files the share library left where they were are not the app's to delete.
* **Saving a quote goes to the page's bookmark, else its saved tab and copies, else a new bookmark.** `src/library/quote-edits.ts`, as the extension's "Save quote" does.
* **Undo puts back what a quote changed, unless its note was edited since.** `quote-edits.ts:setTabNotes`.

### Links and page copies

* **Link lookups wait until the address stops changing.** `src/library/link-preview.ts:DEBOUNCE_MS`. A late answer for an address that has since changed is dropped.
* **With a server connected, the server reads a page.** `link-preview.ts:loadPreview`. The site sees the server, not this phone. Without one, the phone reads the page itself.
* **The phone sends its own user agent.** `link-preview.ts:USER_AGENT`. Some sites refuse the network library's default.
* **A page larger than 3 MB is not worth downloading for a title.** `link-preview.ts:MAX_BYTES`.
* **Only the start of a page is read for its title.** `src/library/page-title.ts:READ_LIMIT`, the same cut the server makes.
* **The title is the share's title when there is one, else the page's own.** `page-title.ts:found`.
* **Readable page copies are never synced.** `src/library/page-copies.ts`. They live in the same store as the library, for the regular library only.
* **A copy is fetched through the server when it has `/v1/page-source`.** `page-copies.ts:fetchHtml`. Otherwise it is fetched from the site.
* **The page cap is the server's.** `page-copies.ts:MAX_PAGE_BYTES`. A copy outlives its last link for a window, so a restored backup's Undo still has it.
* **An empty library is more likely a failed load than an emptied one, so copies are kept.** `page-copies.ts:sweep`.
* **The sweep runs a little after start.** `page-copies.ts:scheduleSweep`, `SWEEP_DELAY_MS`.
* **A removed link's copy is kept in the trash.** `page-copies.ts`. The trash holds it, so the sweep only covers backups restored over the library.
* **A missing server feature is read from the last status.** `src/library/server-features.ts`. Undefined means not connected, or not asked yet.
* **Shared pages need the `shared-pages` feature.** `server-features.ts`, and the **Share › HTML page › Get a link** action.
* **The shared-pages state is `ready`, `old`, `unknown` or `none`.** `src/library/shared-pages.ts`. `unknown` is shown while the server has not answered.

### Search

* **Each search box looks through its own screen, and then through the other places.** `src/library/search-elsewhere.ts`. The extension's ranked search runs over the other places when the screen finds nothing, or when the person asks.
* **Bookmarks does not list its own columns in the other places.** `search-elsewhere.ts:Place`. The screen's chips already show them.
* **The Settings sections are search results.** `search-elsewhere.ts:ELSEWHERE`, by their title, other names, and the settings they hold.
* **The search count waits for typing to stop before it is shown and read out.** `src/library/search-count.ts:SEARCH_COUNT_DELAY`.
* **The result count names the same words that are shown and announced.** `search-count.ts:resultCount`.

### Other

* **The sync-dismissed banner is kept on this phone and never syncs.** `src/library/sync-dismissed.ts`. The banner stays hidden while it still matches.
* **The dismissed flag is undefined until read, so the banner does not flash.** `sync-dismissed.ts:dismissed`.
* **The library on screen is the regular one, or the private one (read only) when that view is on.** `src/library/view.ts`.
* **Pull to refresh syncs the library on screen, the private one while it is open.** `src/library/use-refresh.ts`.
* **Links are cleaned and shown as the extension's synced settings say.** `src/library/links.ts`. The defaults are the extension's, so a phone that has not synced yet behaves the same.
* **A notification counter at the start of a title is dropped.** `links.ts:TITLE_JUNK`, such as "(3) ".
* **Tracking parameters are dropped from the address to open when the setting says so.** `links.ts:text`.
* **The row's address mode shows only the web address.** `links.ts:linkToOpen`.
* **Portable preferences come from the server, and this app reads none of them.** `store-shape.ts:emptyStore`.
* **Browsers share a list of tabs as links, which are read in order without repeats.** `store-shape.ts:extractUrls`.
* **A saved link's row actions look the same wherever they are named.** `src/library/row-actions.ts:rowActionLook`. Session actions in an archived folder take the session out of it instead (`sessionActionLook`).
* **Choosing a locked private library asks for its password first.** `src/library/library-choice.tsx`. It switches once the library is open.
* **A jump waits for the screen it is meant for, and is taken once.** `src/library/jump.ts:requestJump`.
* **A column chooser's "New column" entry asks for a name and an icon only once it is chosen.** `src/library/column-choice.tsx`.

## Excuses

None. The one lint directive in this folder that lacked a reason, `library-store.ts:sampleModule`, now carries its reason inside the directive.
