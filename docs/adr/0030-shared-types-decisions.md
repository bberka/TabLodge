# 30. Shared data model and message protocol decisions that were code comments (src/shared/types.ts)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/src/shared/types.ts` is the data model and the message protocol that the service worker (`shell/service-worker.ts`) and the extension pages (`src/app`) share. Its comments mostly described a setting or a field. Default values are in `DEFAULT_SETTINGS` (`library-normalize.ts:DEFAULT_SETTINGS`), and the code states them, so comments that only repeated a default were deleted as duplicates. The decisions below are the ones the code does not state: what a field means when it is missing, what a message does to data it touches, and why. Comments are banned ([Code comments](../agents/comments.md)). Sync-facing fields are covered by [ADR 5](0005-bookmark-notes-sync.md), [ADR 8](0008-bookmark-tags-sync.md), [ADR 10](0010-settings-sync.md), [ADR 11](0011-setting-sync-scopes.md), and [ADR 27](0027-shared-sync-decisions.md).

## Decisions

### Module shape

* **Types only.** `types.ts` imports nothing at runtime, so the classic service-worker bundle stays import-free (`types.ts` module).

### Settings (`types.ts:Settings`)

* **Private window accent.** An accent id, `#rrggbb`, or `same` to use the regular accent (`types.ts:PrivateConfig`).
* **Restored tabs unload only past a threshold.** Background restored tabs are unloaded only when a restore opened more tabs than the threshold, so a small restore loads everything (`types.ts:Settings`).
* **Session cards start collapsed,** and each can be toggled during a visit (`types.ts:Settings`).
* **Automatic backups to Downloads need the optional `downloads` permission.** The permission is only used for that setting ([Privacy](../PRIVACY.md#permissions)) (`types.ts:Settings`).
* **Idle archive is a whole number of days from 1 to 3650, or 0 for off.** A session without use for that long moves to the Archived folder (`types.ts:Settings`).
* **Session names:** `ask` opens a dialog each time, and `sessionNameFallback` names the session when the answer is empty (`types.ts:Settings`).
* **Shown addresses and the lock marker are display only.** Removing `https://` and `www.` and the amber lock next to plain http change how an address is shown, never the saved URL (`types.ts:Settings`).
* **Tracking parameters are removed on open and copy, not in storage.** Saved URLs are unchanged (`types.ts:Settings`).
* **Automatic bookmarks go to the first column when the chosen one is gone.** A browser-bookmark setting names a column, and the fallback keeps it from failing (`types.ts:Settings`).
* **Context menus are off as a whole when the master switch is off.** Per-context groups only show while the master switch is on (`types.ts:Settings`).
* **Snapshots skip an identical window set.** A hash of the windows decides, and the serialized length caps the history's total size (`types.ts:Snapshot`).
* **Backup and trash lifetime are fixed choices.** A snapshot history keeps 10, 25, or 50 entries; automatic backups keep 7 or 30; deleted items stay 7, 30, or 90 days (`types.ts:Settings`).
* **Synced preferences of the Android app are plain values.** The extension never reads them. It keeps them so they sync between phones (`types.ts:Settings.mobileApp`, [ADR 10](0010-settings-sync.md)).
* **Unknown synced settings are kept as they arrived.** A key this version does not know goes back unchanged, and once the version knows it, the value is read from there (`types.ts:Settings.heldSettings`, [ADR 10](0010-settings-sync.md)).

### Split views (`types.ts:SplitInfo`, `types.ts:SavedTab`)

* **A split pair key is stable within its session.** It is not the browser's split view id, which changes between sessions. Positions are 0 for the left tab and 1 for the right (`types.ts:SplitInfo`).
* **Both halves are stored together.** A split is kept only when both tabs were saved together (`types.ts:SavedTab`).

### Sessions, folders, columns, bookmarks (`types.ts:Session`, `types.ts:Folder`, `types.ts:BookmarkColumn`, `types.ts:Bookmark`)

* **A missing last-restored time means the session was never restored.** A missing device name means the session was saved before devices had names (`types.ts:Session`).
* **Colors are never `default` or `system`.** A preset accent id or `#rrggbb` is stored, and a missing field means no color (`types.ts:Session`, `types.ts:Folder`, `types.ts:BookmarkColumn`).
* **A folder can pass its color on.** When the option is on and the folder has a color, a session moved in takes that color (`types.ts:Folder`).
* **Column sites match a host and its subdomains,** or a host with a path prefix such as `github.com/bberka`. Bookmarking such a page saves it to that column without asking (`types.ts:BookmarkColumn`).
* **A bookmark's note is its own record.** It syncs as a `note` record (`types.ts:Bookmark`, [ADR 5](0005-bookmark-notes-sync.md)).
* **Tags and removed automatic kinds sync as one `tag` record.** Removed kinds stay removed on every device (`types.ts:Bookmark`, [ADR 8](0008-bookmark-tags-sync.md)).
* **Imported bookmarks have no device.** The device field is missing on imported bookmarks and on those saved before bookmarks recorded it (`types.ts:Bookmark`).

### Snapshots, backups, trash (`types.ts:Snapshot`, `types.ts:Store`, `types.ts:TrashKind`)

* **A safety backup says why it was taken,** such as "Before erasing data", and where it came from (`types.ts:BackupSummary`, `types.ts:TrashSummary`).
* **Trash summaries count the links in the item,** and 0 means not applicable (`types.ts:TrashSummary`).
* **A bookmark import can put everything into one existing column,** instead of making columns from the file's folders (`types.ts:ImportOptions`).

### Messages (`types.ts:TabLodgeMessages`)

* **Keys name the message.** Each key is the `type` the pages send to the service worker (`types.ts:TabLodgeMessages`).
* **Save scopes.** The `-tab` scopes are relative to the sender or the active tab (`types.ts:SaveScope`).
* **Setting a private password also turns private sync on,** so the private library reaches the sync server with that password (`types.ts:ENABLE_PRIVATE_LOCK`).
* **Duplicates.** Saving a tab whose address is already saved is refused by the duplicate setting, except when the message asks for it to be stored anyway (`types.ts:SAVE_TABS`).
* **Previews change nothing.** A preview of a save or of a session name shows what would be captured, without a write (`types.ts:PREVIEW_SESSION_NAME`).
* **Custom session order keeps the slots.** `SET_GROUP_ORDER` gives the visible sessions their new order in the slots they held, and switches the sort to custom. Hidden sessions stay where they were (`types.ts:SET_GROUP_ORDER`).
* **Folder icon and color.** Omitted keeps the current value. An empty string resets the icon to the default and removes the color (`types.ts:UPDATE_FOLDER`).
* **Moving a link drops its split.** The moved link and its partner lose split info (`types.ts:MOVE_TAB`).
* **Undo of a move that emptied its source** names the trash entry that holds the source session. The link comes back with it (`types.ts:MOVE_TAB`, `types.ts:MERGE_GROUPS`).
* **Adding links skips addresses the session already holds** (`types.ts:ADD_LINKS_TO_SESSION`).
* **A new session from pasted links** uses the default folder, and an empty name gets the default from the naming settings. A repeated address is kept once (`types.ts:CREATE_SESSION_FROM_LINKS`).
* **Changing a session from its window** keeps the notes of links the session still holds. Excluded sites, pinned tabs, and the duplicate setting apply as for a save (`types.ts:UPDATE_GROUP_FROM_WINDOW`).
* **Splitting a session keeps the pair together only when both halves move.** The source keeps at least one link (`types.ts:SPLIT_GROUP`).
* **A quote goes to the note of the page's bookmark or saved tab.** A page with neither gets a new bookmark titled with the page title (`types.ts:SAVE_QUOTE`).
* **Adding bookmarks can return an undo id** that removes them again (`types.ts:ADD_BOOKMARKS`).
* **Removing duplicate bookmarks keeps one copy of each address outside the list,** and fails otherwise. At most 500 per message, which is the trash limit (`types.ts:REMOVE_DUPLICATE_BOOKMARKS`, `shell/service-worker.ts:TRASH_MAX_ITEMS`).
* **Column update.** Omitted icon, color, or sites keep their value. An empty array clears the sites (`types.ts:UPDATE_BOOKMARK_COLUMN`).
* **Deleting a column moves its bookmarks** to another column or to Unfiled, or deletes them when asked (`types.ts:DELETE_BOOKMARK_COLUMN`).
* **Erasing data never touches settings or excluded sites** (`types.ts:ERASE_DATA`).
* **Restoring a snapshot opens windows.** It opens every window, or only `windowIndex`, in new windows (`types.ts:RESTORE_SNAPSHOT`).
* **Dismissing recovery keeps the snapshot** in the history (`types.ts:DISMISS_RECOVERY`).
* **Restoring a backup keeps settings.** It replaces sessions and bookmarks, and a safety backup of the current data comes first (`types.ts:RESTORE_BACKUP`).
* **Regular windows only show the private lock.** `manageHere` is false there, so they show the status and leave the lock to the private window (`types.ts:PrivateLockInfo`).
* **Private library lock state.** `encrypting` or `decrypting` means a pass is unfinished, and the pass finishes after the next unlock. `expiresAt` is when the idle timeout locks the library, or null (`types.ts:PrivateLockInfo`, [ADR 28](0028-shared-library-storage-decisions.md)).
* **The regular sync server's view of the private library** says whether the server is connected and whether it already holds a private library with a password (`types.ts:PrivateServerInfo`).
