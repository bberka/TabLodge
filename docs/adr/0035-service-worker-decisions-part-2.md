# 35. Service worker decisions that were code comments, part 2 (shell/service-worker.ts, lines 4000 to 9000)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/shell/service-worker.ts` held 426 comments. [ADR 34](0034-service-worker-decisions.md) covers lines 1 to 4000. This record covers lines 4001 to 9000: session and link edits, bookmark columns and their imports, settings changes, erase and the new-tab hand-off, site icons, recovery snapshots, backups, page copies, the trash, and Undo. The part after 9000 is in a separate record. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Storage layouts are in [ADR 25](0025-paged-library-layout.md), and Undo's trash and sync ties are in [ADR 27](0027-shared-sync-decisions.md).

## Decisions

### Sessions and links (`service-worker.ts:updateGroupFromWindow`, `service-worker.ts:createSessionFromLinks`, `service-worker.ts:moveTab`)

* **Replacing a session from its window swaps its links for the window's links.** Appending adds only what the session lacks. No tab is opened or closed. The save rules apply: web pages only, excluded sites, pinned tabs only when allowed, and the duplicate setting. A replaced session's own links never count as duplicates (`service-worker.ts:updateGroupFromWindow`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **A session made from pasted or dropped links** takes the default name from the naming settings, and an `ask` style uses its fallback style. Repeated addresses are kept once and counted as skipped. Undo removes the session (`service-worker.ts:linksSessionName`, `service-worker.ts:createSessionFromLinks`).
* **Splitting a session** moves the chosen links into a new session placed right after the source, in the same folder. Undo restores the source (`service-worker.ts:splitGroup`).
* **Moving a link leaves its split view.** The partner becomes a plain tab too. A copy leaves the pair alone (`service-worker.ts:moveTab`).
* **Undoing a move that emptied its source** brings the source session back from the trash, because it holds the link, and takes the link out of where it went (`service-worker.ts:moveTab`, `service-worker.ts:applyTrashRestore`).
* **An emptied source goes to the trash** with its name, notes, and folder, instead of vanishing (`service-worker.ts:moveTab`).
* **Titles and notes describe the page,** so edits apply to every saved copy of the same address. A new address belongs to that one saved link only (`service-worker.ts:updateTab`).
* **A typed address is not checked against excluded sites.** Excluded sites only filter what is captured from open tabs, as imports and bookmarks are (`service-worker.ts:updateTab`).
* **A quote goes to the note of the page's bookmark,** else of its saved tab (every saved copy of the page, as an edit does), else of a new bookmark in the column the Add bookmark dialog would start on. A note with no room is left as it was (`service-worker.ts:saveQuote`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **With only source columns, the default for a quote is none,** so the quote goes to Unfiled rather than a site's column (`service-worker.ts:saveQuote`).

### Bookmarks and columns (`service-worker.ts:addBookmarks`, `service-worker.ts:updateBookmark`, `service-worker.ts:placeBookmark`)

* **Adding several links to one column is one write.** They are used for drops of links or whole sessions. They go in together, in order, before or after the target bookmark, or at the column end (`service-worker.ts:addBookmarks`, `service-worker.ts:placeBookmark`).
* **An address in the trash counts as saved** for imports, so an import does not bring back what was deleted (`service-worker.ts:importBrowserBookmarks`, `service-worker.ts:trashedImportUrls`).
* **With a target column,** folders do not become columns. Every bookmark goes into that column (`service-worker.ts:importBrowserBookmarks`, `service-worker.ts:importTargetColumn`).
* **Each list is replaced whole when sent,** and an empty one clears the field (`service-worker.ts:updateBookmark`).
* **The flat list interleaves columns,** so neighbors are found within the bookmark's own column (`service-worker.ts:reorderBookmark`).
* **A column's `icon` omitted keeps the icon.** An empty or unknown id resets it to the default. `color` omitted keeps the color, and an empty value or one that is not a color removes it. `domains` omitted keeps the list, and an empty one clears it (`service-worker.ts:updateBookmarkColumn`, [ADR 30](0030-shared-types-decisions.md)).
* **The target of a column delete is a remaining column or Unfiled,** checked before the write (`service-worker.ts:deleteBookmarkColumn`).
* **Moved bookmarks keep their order** and go after the target column's own bookmarks (`service-worker.ts:deleteBookmarkColumn`).
* **Sources that do not normalize** (id `all`) are mapped first (`service-worker.ts:importGroups`).
* **A source column joins the one with its id,** or keeps that id, since the id is what marks it (`service-worker.ts:mergeImportedBookmarks`, [ADR 33](0033-shared-remaining-decisions.md)).
* **A TabLodge export keeps its pinned tabs,** as a backup restore does. The setting that skips pinned tabs filters only other shapes of tab lists (`service-worker.ts:importGroups`).
* **A session holds at most 1,000 links,** so a bigger import becomes several numbered sessions (`service-worker.ts:importGroups`).
* **Exports from older builds may carry archived sessions,** and they follow the same rule as the stored-data migration (`service-worker.ts:importGroups`, [ADR 34](0034-service-worker-decisions.md)).

### Settings (`service-worker.ts:updateSettings`, `service-worker.ts:applySettingsChange`)

* **Changed settings are applied to the toolbar, alarms, the pinned tab, and menus,** whether changed here or through sync (`service-worker.ts:applySettingsChange`).
* **Settings may differ from what the alarms, toolbar, and menus were set up for,** so they are re-checked after a change (`service-worker.ts:applySettingsChange`).
* **Erasing data keeps settings and excluded sites.** Only the chosen data returns to its fresh-install state (`service-worker.ts:eraseData`).

### New-tab hand-off (`service-worker.ts:handOffNewTab`, `service-worker.ts:newTabTarget`)

* **With "Use TabLodge for new tabs" off, the override page cannot be uninstalled.** Tabs the browser opens as new tabs are sent on to the browser's own page, or a blank or custom page (`service-worker.ts:handOffNewTab`).
* **Where a new tab goes** is the browser's page, a blank page, or a custom page. After one failed attempt, when the browser sent the tab back to TabLodge, it falls back to a blank page, so a tab cannot loop (`service-worker.ts:newTabTarget`).
* **The redirect count for each tab is kept.** A tab the browser sends back gets a blank page (`service-worker.ts:readClaims`, `service-worker.ts:CLAIMS_KEY`).
* **Brave is recognized by its own marker** (`service-worker.ts:looksLikeBrave`).

### Site icons (`service-worker.ts:loadSiteIcons`, `service-worker.ts:siteIconWrites`)

* **Firefox has no favicon service.** The icon of each site the user opens is remembered by host, for bookmarks of that site that are not open. Chromium keeps its own cache and needs none. Icons from the sync server go to the same store on both browsers, through the same chain of writes (`service-worker.ts:loadSiteIcons`, `service-worker.ts:siteIconWrites`).
* **The server is asked for icons** only with Site icons set to Through my server and a server connected. In a private window it is asked only when that window uses the regular library, which is the one connected (`service-worker.ts:siteIconServer`).
* **Icons too big to store are redrawn at 32 pixels.** Chromium cannot draw an SVG in its worker, so those are not kept (`service-worker.ts:shrinkIcon`).

### Recovery and snapshots (`service-worker.ts:takeSnapshot`, `service-worker.ts:evaluateStartup`)

* **Recovery data stays in `chrome.storage.local`.** Its keys are separate from `tablodge.state`, so the large state is never rewritten for them (`service-worker.ts:SNAPSHOTS_KEY`, `service-worker.ts:SNAPSHOT_LIVE_KEY`, `service-worker.ts:SNAPSHOT_META_KEY`).
* **The history is rotated at the interval, newest first,** and the live capture is rewritten on debounced tab events (`service-worker.ts:takeSnapshot`, `service-worker.ts:scheduleSnapshot`).
* **The history is capped by serialized size across all snapshots.** The oldest go first, and the newest always stays (`service-worker.ts:trimHistory`, `service-worker.ts:SNAPSHOT_MAX_CHARS`).
* **A capture is skipped when the live snapshot did not change.** The content hash avoids reading the large record (`service-worker.ts:SnapshotMeta`, `service-worker.ts:takeSnapshot`).
* **A snapshot with no tabs is not written over a good one.** It never overwrites a snapshot with an empty one (`service-worker.ts:takeSnapshot`).
* **If the browser already reopened most of a snapshot's tabs, there is nothing to recover** (`service-worker.ts:ALREADY_OPEN_RATIO`, `service-worker.ts:evaluateStartup`).
* **The debounced capture waits after the last event,** but not longer than `SNAPSHOT_MAX_WAIT_MS` after the first (`service-worker.ts:scheduleSnapshot`).
* **Crash detection runs once per browser start.** Manifest V3 has no shutdown event, so a clean exit is inferred: the last normal window was closed, or windows were being closed down to one and nothing was captured after (`service-worker.ts:evaluateStartup`, `service-worker.ts:handleWindowRemoved`).
* **A run that starts without a window** is not "open" until the first snapshot marks it (`service-worker.ts:evaluateStartup`).
* **Without window information, one window is assumed** (the old behavior) (`service-worker.ts:evaluateStartup`).
* **The last window closing is the clean-exit signal.** The live snapshot, the state before closing, joins the history (`service-worker.ts:handleWindowRemoved`).
* **Snapshot windows may repeat a URL,** so duplicates open, and restores always go to new windows. An empty window created for a restore is dropped (`service-worker.ts:restoreSnapshot`).
* **A stored session holds at most 1,000 tabs,** so a huge window becomes several sessions (`service-worker.ts:saveSnapshotAsSession`).
* **The browser's own session reopen is recognized** (`service-worker.ts:restoreSnapshot`).
* **Private windows show no snapshots** (`service-worker.ts:privateSnapshotsError`).

### Backups (`service-worker.ts:addBackup`, `service-worker.ts:runScheduledBackup`)

* **Automatic and safety backups are full JSON exports** kept in `chrome.storage.local`, with a manual ring, an automatic ring, and a safety ring (`service-worker.ts:BACKUPS_KEY`, `service-worker.ts:SAFETY_BACKUP_KEEP`, `service-worker.ts:MANUAL_BACKUP_KEEP`).
* **A scheduled backup is due by its last run,** including runs that skipped unchanged data, so a quiet profile is not due on every start (`service-worker.ts:backupDue`).
* **Manual backups have their own cap,** so they never push scheduled ones out of the list (`service-worker.ts:trimBackups`).
* **The record is stored first,** so a failed or slow Downloads copy cannot lose it (`service-worker.ts:addBackup`).
* **Automatic runs skip data identical to the newest backup** (`service-worker.ts:addBackup`, `service-worker.ts:dataSignature`).
* **A Downloads copy is written as a data URL,** since a service worker has no Blob URLs (`service-worker.ts:downloadBackupCopy`).
* **A safety backup comes before something destructive,** such as erase, a large import, or a bulk delete. It returns false when it could not be written, so the caller stops before losing data (`service-worker.ts:safetyBackup`).
* **Restoring a backup brings back sessions, folders, bookmarks, and columns.** Settings stay as they are (`service-worker.ts:restoreBackup`).
* **The JSON export has the Back up dialog's shape,** so Import reads it (`service-worker.ts:backupJson`).

### Page copies (`service-worker.ts:capturePage`, `service-worker.ts:keepPageCopy`)

* **Readable page copies are kept by the regular worker only,** on this device, and never synced (`service-worker.ts:pageCopies`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **The copy is taken by running the extractor in the tab** and collecting what it left there (`service-worker.ts:capturePage`).
* **A copy is kept under the address of the link that holds it,** or without tracking parameters. Otherwise it becomes a new bookmark, added only once the copy is stored (`service-worker.ts:keepPageCopy`).
* **The sweep drops copies that no link holds.** It reads the whole library and trash first, and waits while an Undo could still bring links back. A library it cannot read leaves every copy alone (`service-worker.ts:sweepPageCopies`).
* **Only one sweep runs at a time.** Changes that land while one runs get one more after it (`service-worker.ts:scheduleCopySweep`).
* **The sweep runs inside the queues,** so an action's Undo is stored before it is read (`service-worker.ts:copySweep`).

### Full backup and theme (`service-worker.ts:getFullBackup`, `service-worker.ts:restoreFullBackup`)

* **The full backup ZIP is built by the page.** The worker supplies and replaces the stored values (`service-worker.ts:getFullBackup`, [ADR 29](0029-shared-formats-decisions.md)).
* **The page theme and accent are kept in storage by the pages.** They are the only preferences outside the library state (`service-worker.ts:UI_THEME_KEY`, `service-worker.ts:UI_ACCENT_KEY`, [ADR 33](0033-shared-remaining-decisions.md)).
* **A snapshot imported from a backup is rebuilt from known fields only,** and is null when it has no usable tab (`service-worker.ts:normalizeImportedSnapshot`).
* **Trash comes after the library in a restore,** so the copies land with the links that hold them (`service-worker.ts:applyFullBackup`).
* **Same nesting as Undo for these keys,** so the queues never wait on each other (`service-worker.ts:restoreFullBackup`).

### Trash (`service-worker.ts:trashAdd`, `service-worker.ts:capTrashSize`)

* **The trash is kept newest first,** within `TRASH_MAX_CHARS` in total and `TRASH_MAX_ITEMS` items. The newest item always stays (`service-worker.ts:capTrashSize`, `service-worker.ts:pruneTrash`).
* **A deleted item goes to the trash before the main state is written.** A crash in between duplicates rather than loses data (`service-worker.ts:trashAdd`).
* **Several items go in with one read and write** (`service-worker.ts:trashAddMany`).
* **The sync client sees the trash through `applySyncTrash`.** Entries from other devices are added or replaced, and entries they restored or deleted are removed in one update. A delete made on this device meanwhile stays (`service-worker.ts:readSyncTrash`, `service-worker.ts:applySyncTrash`).
* **Entries stored before sizes were tracked get theirs written once** (`service-worker.ts:readTrash`).
* **A tab removal records where each link sat.** A session that disappears with its last link is kept as `groupMeta` (`service-worker.ts:trashTabsEntry`).
* **Addresses in the trash are read for imports,** and expired entries are left out (`service-worker.ts:trashedImportUrls`).
* **A trash item goes back into the store before it is written** (`service-worker.ts:applyTrashRestore`).
* **A source column that a save on its site made again takes its bookmarks back,** since its id is its marker (`service-worker.ts:applyTrashRestore`, [ADR 33](0033-shared-remaining-decisions.md)).
* **Links deleted with a column come back into it,** and links moved elsewhere when the column was deleted go back if they are still where they were put (`service-worker.ts:applyTrashRestore`).
* **Sessions moved to Unfiled when a folder was deleted return to it** (`service-worker.ts:applyTrashRestore`).

### Undo (`service-worker.ts:withUndo`, `service-worker.ts:undoAction`)

* **Actions the trash cannot hold** (erase, empty trash, clear snapshots, restore a backup, imports) have their storage keys copied before the action. UNDO puts them back, but only briefly, and only while nothing else has changed those keys since (`service-worker.ts:withUndo`, `service-worker.ts:UNDO_WINDOW_MS`).
* **Each key's value before the action** is kept, and a key missing there did not exist. A hash of each key's value right after the action notices later changes (`service-worker.ts:UndoRecord`, `service-worker.ts:undoHash`).
* **The library is kept as a delta,** its index plus the records the action replaced, not as a copy of everything. Without the record layout, the whole value is copied (`service-worker.ts:withUndo`).
* **A record the action replaced could not be copied:** no Undo is better than a wrong one (`service-worker.ts:withUndo`).
* **The copy holds user data,** so it is dropped soon after the window closes (`service-worker.ts:purgeUndo`, `service-worker.ts:UNDO_KEEP`).
* **Undo is a convenience.** The action itself succeeded even when Undo cannot be stored (`service-worker.ts:withUndo`).
* **Send to private** keeps its hold and cleanup in storage. Links received from another window are taken in once (`service-worker.ts:sendToPrivate`, `service-worker.ts:receiveSentLinks`, `service-worker.ts:takeInSentLinks`).
