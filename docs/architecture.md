# Architecture

This guide explains how TabLodge is built, where data lives, and which behavior needs care when changing the code. For installation and commands, see the [README](README.md). For data handling, see [Privacy](PRIVACY.md).

## Build and startup

`scripts/build.ts` runs several Vite+ builds into `dist/tablodge/`:

* **Pages:** `vite.pages.config.ts` builds the HTML shells in `extension/` with their React entries in `src/app/`. It replaces `%APP_NAME%` in page titles, bundles assets locally, writes the manifest, and copies icons.
* **Service worker:** `extension/service-worker.ts` becomes a single classic IIFE script. The manifest does not declare it as a module.
* **Theme boot:** `extension/theme-boot.ts` becomes a small classic script loaded synchronously in each page's head. It applies the saved theme before the first paint. React renders into `#root` after the saved state arrives.

`scripts/verify-build.ts` checks that manifest files exist, HTML references only local bundles, classic scripts parse correctly and contain no `process.env`, the theme script runs before page modules, and package metadata matches the manifest. After building, `scripts/package.ts` writes a versioned ZIP and SHA256 checksum under `release/`. The release workflow uses the same task.

Load only `dist/tablodge/` in the browser. `extension/` and the repository root are source directories. Each build recreates the output directory, so don't run two builds at once.

## Names, versions, and persistent identifiers

The manifest's `short_name` supplies `PROJECT.name` in pages and `APP_NAME` in the worker. The full store title and toolbar tooltip also live in `extension/manifest.json`.

The manifest version must match `package.json`; build verification checks this. Repository links come from `package.json` through `src/app/project.ts`. The build adds the manifest's `homepage_url` from the package's `homepage`.

These identifiers are part of stored data or external formats. Changing them requires a migration:

* The main storage key, `tablodge.state`, and recovery keys listed below.
* The theme key `uiTheme` in extension storage and its `tablodge.uiTheme` mirror in page `localStorage`.
* Export format identifiers such as `tablodge-sessions`, `tablodge`, `tablodge-backup`, and `tablodge-full-backup`.
* Drag MIME types `application/x-tablodge-session`, `application/x-tablodge-column`, and `application/x-tablodge-bookmark`.
* Context menu IDs beginning with `tablodge-page-` or `tablodge-action-`.

The installation path matters too. An unpacked extension gets its ID from the folder it is loaded from. A different path can mean a different ID and separate storage.

## Data and messages

`src/app/types.ts` defines the data model and typed messages. Pages call `send()` from `src/app/common.tsx`; the worker handles storage and browser operations. Mutations are serialized so concurrent messages don't overwrite one another.

Sessions, folders, bookmarks, columns, and settings live in `chrome.storage.local` under `tablodge.state`. The current schema is version 8. Older data is normalized on load. Data from a newer schema is refused rather than overwritten. Recovery data has separate keys so a snapshot doesn't rewrite the whole library.

Sessions and bookmarks can be disabled separately without deleting data. Both the UI and worker reject mutations for a disabled system. At least one must stay enabled.

## Recovery

Worker recovery code lives in `extension/service-worker.ts`; the UI lives in `src/app/recovery.tsx`.

| Key | Contents |
| --- | --- |
| `tablodge.snapshots` | Snapshot history, newest first |
| `tablodge.snapshots.live` | Latest capture of open windows |
| `tablodge.snapshots.meta` | Browser session flags, latest capture signature, and pending recovery |
| `tablodge.backups` | Automatic and safety backup lists, plus download errors |
| `tablodge.trash` | Deleted items with their original positions and deletion times |
| `tablodge.undo` | Up to three recent undo records |

### Auto-archive

The `autoArchiveDays` setting is 0 (off, the default), 30, 90, 180, or 365. When it is on, a daily alarm and worker startup move every session whose newest of `lastOpenedAt`, `updatedAt`, and `createdAt` is older than that into the folder named Archived, creating it if missing. The move runs in the mutation queue, does not change `updatedAt`, and deletes nothing. Moving a session back out through the editor updates `updatedAt`, so it is not archived again until it has been idle for the full period.

### Snapshots

Snapshots are enabled by default. Captures include normal windows, ordinary HTTP and HTTPS tabs, active and pinned state, tab groups, split view pairs, and window focus and state. Incognito windows and excluded sites are omitted.

Tab and window events trigger a capture after about five seconds, with a maximum wait of 30 seconds. The live capture is written only when its content changes. An interval alarm also adds history entries at the chosen interval of 5, 15, or 30 minutes, unless the latest entry is identical. Empty captures never replace saved snapshots.

History keeps 10, 25, or 50 entries, subject to a cap of about 24 million serialized characters. Oldest entries are removed first.

### Crash detection

Manifest V3 has no reliable browser shutdown event. TabLodge therefore treats crash detection as a best guess:

1. The first capture marks the browser session as open.
2. Closing the last normal window marks a clean exit and adds the last live capture to history. Closing another window records when it closed and how many windows remained.
3. On browser startup, a session still marked open is treated as crashed unless the flags suggest shutdown was already in progress. Its live capture moves to history. A capture with at least two tabs becomes a recovery offer.
4. `GET_SNAPSHOTS` hides the offer when at least 80% of its URLs are already open, since the browser probably restored them itself.

A normal quit can look like a crash if the worker stops before handling the last window event. Changes within roughly five seconds of a crash may be missing. Reloading or updating the extension is not a browser startup and does not produce a crash banner.

`RESTORE_SNAPSHOT` creates a window for each saved window, reuses normal restore logic, allows duplicate URLs, and restores active tabs, maximized state, and focus. `SAVE_SNAPSHOT_AS_SESSION` converts a window to a saved session, splitting it into several sessions above 1,000 tabs.

### Backups

Automatic backups are off by default. When enabled, they run daily or weekly and keep 7 or 30 entries. A missed run is caught up at browser startup. A run is skipped if sessions and bookmarks match the newest backup.

JSON backups use the `tablodge-backup` format and contain folders, sessions (`groups`), bookmark columns, bookmarks, and settings. Restoring one replaces the saved library but keeps the current settings. It takes a safety backup first.

A separate list keeps five safety backups. They are taken before erasing data, restoring a backup, imports above 50 items, browser bookmark imports above 50 links, and deletion of a column containing at least 10 bookmarks. Erasing data stops if its safety backup cannot be written.

The optional Downloads copy uses `chrome.downloads.download` with a base64 data URL and a filename under `Downloads/TabLodge/`. The worker cannot create Blob URLs. The current download path rejects URLs above 2 MB and records an error; downloading from a page avoids that limit. The Settings toggle requests or releases the optional `downloads` permission.

### Trash

Deleting a session, saved link, bookmark, or column writes a `TrashEntry` before updating the library. If execution stops between those writes, the result is a duplicate rather than lost data. Links removed after a restore also go to the trash.

Restore uses the original position and neighboring items where possible. If the parent no longer exists, sessions return to Unfiled and bookmarks to the first column. Restoring a link can recreate its missing session.

Retention is 7, 30, or 90 days. Cleanup runs daily and when adding an entry. Limits are 500 entries and about 8 million serialized characters; oldest entries are removed first, but the newest entry stays.

Deleting a session folder moves its sessions to Unfiled rather than trashing them. Generic Undo restores the folder. Erasing all data also uses a safety backup and generic Undo, not trash.

### Undo and confirmations

On the dashboard, actions that can be undone run immediately and show an Undo toast. Settings still asks before erasing data, resetting preferences, clearing snapshots, emptying trash, or restoring a backup. These actions also offer Undo afterward. Deleting one backup does not ask first.

`showStatus(message, false, {action: {label, onClick}})` displays an action toast for six seconds. Delete responses include `trashId`; Undo sends `RESTORE_TRASH`. Undoing removal after a restore brings saved links back but leaves the opened tabs alone. Undoing a move sends a reverse `MOVE_TAB`. Undo after saving and closing tabs restores the saved session into the current window.

For actions the trash cannot represent, the worker's `withUndo` copies affected storage keys before the action and stores hashes of their resulting values afterward. The response includes `undoId`. `UNDO` succeeds only within two minutes and only if all affected keys still match those hashes. Later edits to the same data cause Undo to be refused.

Undo runs through the mutation queue and relevant recovery queues. It resynchronizes alarms, toolbar behavior, and menus after restoring state. At most three records are kept, with expired copies removed by an alarm and on worker startup. Undoing snapshot deletion restores history, not the live capture or crash banner, and is refused if another snapshot was captured in the meantime.

Opening more than 10 saved links or bookmarks, or restoring a snapshot, also offers Undo. That action closes the newly opened tabs that still exist.

## Pages and shared UI

The new tab dashboard contains sessions and bookmark columns. Settings and Help have their own pages. The popup is a compact chooser; its **Open TabLodge** action opens the dashboard. The side panel has bookmarks, sessions, and open tabs, with search and actions suited to its narrow layout.

The toolbar icon normally opens the popup. **Settings › Side panel › Toolbar icon opens** can make it open the side panel instead. A shortcut and context menu can open the panel without changing that preference.

**Settings › Dashboard › Dashboard width** controls the dashboard container and bookmark grid together. The default keeps the existing 1,440 pixel maximum and three column desktop grid. Wider uses up to 1,920 pixels and four columns on a 1,920 pixel viewport. Full width removes the maximum and fits as many columns as the available space allows, with a 288 pixel minimum column width. Narrower uses a 1,024 pixel maximum and two columns. Small screens still use one column where two would not fit. The worker normalizes invalid values back to the default.

**Settings › Dashboard › Remove tracking parameters** is off by default. When enabled, opening saved links, restoring sessions, and restoring snapshots removes common query parameters such as `utm_source`, `fbclid`, and `gclid`. Saved URLs, copied links, and exports keep their original values. The page helper and classic service worker maintain matching parameter lists.

UI primitives live in `src/components/ui/`, with composed helpers in `src/shared/ui.tsx`. Theme tokens live in `styles/extension-app.css`. `src/shared/theme.tsx` mirrors the saved theme for the boot script and follows system theme changes. The `@/` alias resolves to `src/` during builds and must not remain in output bundles.

## Saving and restoring sessions

Save scopes include selected tabs, the current window, all windows, a native tab group, the active tab, and tabs to either side. Toolbar actions, context menus, and shortcuts share worker logic. The `save-window` shortcut uses `selected-or-window`, so a selection takes precedence over the window.

Only ordinary HTTP and HTTPS URLs are saved. Excluded sites are filtered during capture. Native group metadata is restored where browser APIs allow it.

Pinned tabs are excluded by default. When included, they can be closed only after the session is written and **Close tabs after saving** is enabled. The worker checks each tab's URL and pinned state again before closing it. When that closes every tab in a window, the worker opens a new tab so the window stays, unless **When a save empties a window** is set to close it and another normal window of the same incognito state is open. It then focuses that window and closes the emptied one. The last window is never closed.

The default restore destination is a new window unless the current window contains only the current tab. Settings also offers current window and always new window policies. Ctrl/Cmd clicks keep saved links; Shift clicks force a new window. A failed restore never removes its saved link. Duplicate handling, activation, and unloading of restored background tabs are separate preferences. When **Remove tracking parameters** is enabled, restore duplicate checks compare the cleaned destination while the saved URL remains unchanged.

### Switching workspaces

`SWITCH_WORKSPACE` saves the window's web tabs, opens another session in the same window, and then closes the saved tabs. The save uses the normal naming and duplicate rules but leaves the tabs open and skips **Open dashboard after saving**. The restore ignores the restore target and duplicate preferences, so a URL that is already open still opens, and it follows the keep or remove preference as usual. The old tabs are closed only after the other session opened at least one tab, and only if their URL still matches what was saved. If the restore fails, the window keeps its tabs and the new session stays saved. Pinned tabs (unless saved), excluded sites, and pages that are not web pages are left alone, so the dashboard stays open. The dashboard menu item and the popup and side panel buttons are disabled while the window has no such tab (`useHasSavableTabs`, which follows tab events).

### Titles and names

`cleanTitles`, enabled by default, removes leading notification counters and unread markers from captured page titles. It leaves manually entered titles and existing data alone. A title made only of counters is kept.

`formatSessionName` builds names from the save time and browser locale. Styles are first tab title, date and time, date and title (the default), a custom template, or a prompt each time. Names are capped at 120 characters, before any chunk suffix. Templates are capped at 200 characters and accept `{date}`, `{time}`, `{weekday}`, `{title}`, `{domain}`, `{count}`, and `{window}`. Unknown placeholders stay as typed.

An explicit name or the title of a native group takes precedence. Imports, saved links, merges, and snapshot conversions keep their own naming rules. Existing sessions are never renamed by a preference change.

Pages use `useSessionNameAsk` to prompt before saving. Cancel aborts the save. An empty answer uses the fallback style. Saves started without a page must save first, then open `name-session.html` to offer a rename; cancelling keeps the fallback name. `PREVIEW_SESSION_NAME` uses the same formatter for Settings and dialogs. Pure naming helpers live in `src/app/session-name.ts`.

`ignoreTabGroups` omits native group metadata from new captures and snapshots without changing existing sessions. Saving the current group still saves its tabs, just without the metadata.

### Split view

Split view support needs the Chromium 155 APIs. Captures record a stable pair key and left or right position only when both tabs survive selection, exclusions, pinned filtering, and duplicate handling.

The save preference can keep both halves of the active split view or only the focused tab during selection saves. Whole window saves always keep both; the popup chooser saves exactly what was selected.

On restore, both tabs open next to each other with matching pinned state. Native groups are created before the pair is split, with group appearance applied afterward. If one half is missing or the API is unavailable, tabs open normally. A rejected split is reported as a pair opened separately, not as failed tabs. Split pairs stay loaded even when background unloading is enabled because either half can be visible.

## Bookmarks

Bookmarks can come from the active page, manual entry, pasted links, dragging, a file, or an explicit browser bookmark import. Supplied titles take priority, then a matching open tab title, then a readable URL label. TabLodge does not fetch page contents. Favicons come from the browser's local cache with a text fallback.

The optional browser bookmark setting uses `chrome.bookmarks.onCreated`, not a hook on the star button. It waits 1.5 seconds and acts only on a single new web bookmark matching the active tab of the last focused normal window. Bursts, imports, folders, and URLs already saved in TabLodge are ignored. An import flag also lives in `chrome.storage.session` so it survives worker restarts.

The setting can ask or add automatically to a chosen column, falling back to the first column. Removing the browser bookmark does not remove the TabLodge copy. Explicit browser imports turn folders into ordered columns and offer duplicate choices.

Columns and bookmarks are reordered by dragging. Any column, including the last, can be deleted. For a populated column, the dialog offers to move its bookmarks or delete them too; the last column has no move destination. The result offers Undo and stores the column in trash.

## New tab behavior

Chromium declares the new tab override statically. Turning off **Use TabLodge for new tabs** cannot remove that declaration. Instead, the worker redirects newly created tabs to the browser's own page, a blank page, or a custom HTTP or HTTPS URL.

`newtab.html` also asks `HANDOFF_NEW_TAB` whether a redirect is needed before rendering. A counter prevents redirect loops: after one retry, the tab goes to `about:blank`. Opening the dashboard deliberately still works. Address bar focus depends on the destination and browser.

## Imports and exports

Session and bookmark menus provide their own import and export actions; Settings also provides data tools. Parsing and conversion live in `src/app/import-formats.ts`. Imports accept native backups and formats from other tab managers. Unsupported URLs are ignored. Duplicate choices appear only when needed and are separate from restore preferences.

Session JSON includes sessions and folders. Bookmark JSON includes columns and bookmarks. A split pair uses `split: {id, position}`, where position is 0 for left and 1 for right. Import keeps only complete adjacent pairs with matching pinned and group state. Invalid pair metadata is dropped without losing the links.

A session has one description, capped at 10,502 characters. Older separate `notes` fields are merged into the description with a blank line when both differ. Editing a saved tab title preserves its notes.

### Full backup ZIP

`src/app/full-backup.ts` builds `tablodge-full-YYYY-MM-DD.zip` on the page using bundled `fflate`. The worker supplies data through `GET_FULL_BACKUP`.

| File | Contents |
| --- | --- |
| `manifest.json` | Format `tablodge-full-backup`, versions, creation time, and counts |
| `data.json` | Normalized state, including settings and excluded sites |
| `preferences.json` | Theme choice |
| `snapshots.json` | Snapshot history |
| `trash.json` | Trash entries |

Automatic backup history and Undo records are not included. Import recognizes the ZIP header and format identifier, shows counts, and sends `RESTORE_FULL_BACKUP`. The worker rejects newer versions, normalizes entries, takes a safety backup, and replaces the affected data inside one undoable action. It then resynchronizes alarms, toolbar behavior, and menus.

Files above 45 MB, or expanding beyond 60 MB, are refused. All export formats are unencrypted; see [Privacy](PRIVACY.md) before sharing backups.

## Testing

The worker harness runs the source in a fresh Node VM with mocked `chrome.*` APIs. Pure helpers also have direct unit tests. These tests cover storage and browser logic, not full browser behavior. Use the unpacked build for a manual smoke test, especially for worker restarts, native groups, split view, and side panel gestures.
