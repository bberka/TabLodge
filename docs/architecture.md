# Architecture

This guide explains how TabLodge is built, where data lives, and which behavior needs care when changing the code. For installation and commands, see the [README](README.md). For data handling, see [Privacy](PRIVACY.md).

## Build and startup

`scripts/build.ts` runs several Vite+ builds for each browser target: `dist/tablodge/` for Chromium and `dist/tablodge-firefox/` for Firefox. Both come from the same sources. Pass `--target chrome` or `--target firefox` to build one, which is also how `--watch` works (Chromium by default).

* **Pages:** `vite.pages.config.ts` builds the HTML shells in `extension/` with their React entries in `src/app/`. It replaces `%APP_NAME%` in page titles, bundles assets locally, writes the manifest, and copies icons. The manifest source is `extension/manifest.json`, written for Chromium. `scripts/manifest-targets.ts` derives the Firefox manifest from it.
* **Service worker:** `extension/service-worker.ts` becomes a single classic IIFE script. The Chromium manifest does not declare it as a module, and the Firefox manifest lists it under `background.scripts`, which makes it an event page.
* **Theme boot:** `extension/theme-boot.ts` becomes a small classic script loaded synchronously in each page's head. It applies the saved theme and accent color before the first paint. The new-tab head also loads `extension/newtab-preload.ts`, starting the state request while the page bundle loads. Its React hook adopts that request, and the page stays blank until the state arrives.

`scripts/verify-build.ts` verifies every target. It checks that manifest files exist, HTML references only local bundles, classic scripts parse correctly and contain no `process.env`, the theme script runs before page modules, and package metadata matches the manifest. It also checks that each manifest holds only what its browser knows: the Firefox manifest has no `service_worker`, `side_panel`, `favicon`, or `sidePanel`, and the Chromium manifest has no Firefox keys. After building, `scripts/package.ts` writes a versioned ZIP and SHA256 checksum per target under `release/`: `tablodge-<version>.zip` for Chromium, which the Chrome Web Store workflow downloads, and `tablodge-<version>-firefox.zip`. The release workflow uses the same task.

Load only `dist/tablodge/` (Chromium) or `dist/tablodge-firefox/` (Firefox) in the browser. `extension/` and the repository root are source directories. Each build recreates the output directory, so don't run two builds at once.

## Browser support

TabLodge targets Chromium browsers (Chrome 116 or newer) and desktop Firefox 140 or newer. Firefox 140 is the first ESR release with tab groups, `tabs.group`, and the data collection permissions key. Safari and mobile browsers are not supported. Safari needs an Apple developer account and an app wrapper, and Firefox for Android lacks the bookmarks, windows, and new tab override APIs.

One codebase serves both. Differences the code can find by looking for an API (`chrome.tabGroups`, `chrome.sidePanel`, `chrome.tabs.createSplit`) stay feature checks. The few that it cannot are keyed off `IS_FIREFOX` in the service worker and `isFirefox` in `src/shared/browser.ts`, both derived from the `moz-extension:` address of the extension's own pages. Page code should call the helpers in `src/shared/browser.ts` instead of testing the browser itself.

| Capability | Chromium | Firefox 140 or newer |
| --- | --- | --- |
| Sessions: save, restore, folders, notes, archive, trash | Yes | Yes |
| Bookmark board, imports, exports, full backup, recovery snapshots | Yes | Yes |
| Native tab groups | Saved and recreated | Saved and recreated |
| Split view | Restored as a split on Chromium 155 or newer | Reopens as neighboring tabs; the setting is hidden |
| New tab page | Replaced; can be switched off in Settings | Replaced while enabled; the switch is hidden |
| Side panel | Chromium Side Panel; can open from the toolbar button | Sidebar (`sidebar_action`); opens from the popup, the toolbar menu, or a shortcut |
| Site icons | Browser favicon cache | Letter tile; the side panel's open tabs use the tab's own icon |
| Private windows | Optional, with shared or separate storage | Not available; the manifest sets `incognito` to `not_allowed` |
| Shortcuts and context menus | Yes | Yes |
| Downloads copy of backups | Optional `downloads` permission | Optional `downloads` permission |
| Snapshots and automatic backups (`alarms`) | Yes | Yes |
| Updates | Chrome Web Store, or reload a manual copy | Reload the add-on; no signed listing yet |

Why Firefox differs:

* **Worker lifecycle.** Firefox has no extension service workers, so the same script runs as an event page. Both are non persistent and restart on events, and the code already keeps durable state in storage, so one script serves both.
* **Starting windows.** Chromium maps `chrome://newtab/` to the new tab page. Firefox refuses `chrome:` and `about:newtab` in `tabs.create` and `windows.create`, so a restore starts its window on `about:blank` (removed once the tabs are open), and an emptied window gets a tab with no address.
* **New tab hand off.** Chromium reports `chrome://newtab/` as a new tab's pending address, which lets the worker tell a real new tab from the dashboard opened on purpose and send it elsewhere. Firefox opens every tab as `about:blank` before the add-on's page loads, so the worker cannot tell them apart, and Firefox gives add-ons no way to open its own new tab page. The worker reports **Use TabLodge for new tabs** as on in Firefox.
* **Sidebar.** `sidebarAction.open()` works only inside a user action, so it runs straight from the click, command, or menu handler. A toolbar button that opens the panel would need the settings read first, which loses the user action, so Firefox keeps the popup for that mode.
* **Private windows.** Chromium offers a `split` mode with a separate extension context. Firefox has only `spanning`, where private and normal windows would share one context and one storage area, so the Firefox build opts out.
* **Favicons.** Firefox has no `_favicon/` service. TabLodge does not request icons from sites or a third party, so it uses the tab's own icon where one is known and a letter tile otherwise.

## Names, versions, and persistent identifiers

The manifest's `short_name` supplies `PROJECT.name` in pages and `APP_NAME` in the worker. The full store title and toolbar tooltip also live in `extension/manifest.json`.

The manifest version must match `package.json`; build verification checks this. Repository links come from `package.json` through `src/app/project.ts`. The build adds the manifest's `homepage_url` from the package's `homepage`.

These identifiers are part of stored data or external formats. Changing them requires a migration:

* The main storage key, `tablodge.state`, and recovery keys listed below.
* The theme key `uiTheme` and accent key `uiAccent` in extension storage, and their `tablodge.uiTheme` and `tablodge.uiAccent` mirrors in page `localStorage`.
* Export format identifiers such as `tablodge-sessions`, `tablodge`, `tablodge-backup`, and `tablodge-full-backup`.
* Drag MIME types `application/x-tablodge-session`, `application/x-tablodge-column`, and `application/x-tablodge-bookmark`.
* Context menu IDs beginning with `tablodge-page-` or `tablodge-action-`.

The installation path matters too. An unpacked extension gets its ID from the folder it is loaded from. A different path can mean a different ID and separate storage.

## Data and messages

`src/app/types.ts` defines the data model and typed messages. Pages call `send()` from `src/app/common.tsx`; the worker handles storage and browser operations. Mutations are serialized so concurrent messages don't overwrite one another.

Sessions, folders, bookmarks, columns, and settings live in `chrome.storage.local` under `tablodge.state`. The current schema is version 9. Older data is normalized on load. Data from a newer schema is refused rather than overwritten. Recovery data has separate keys so a snapshot doesn't rewrite the whole library. Normalization creates the Archived folder when missing. Sessions in that folder stay stored but are left out of active session lists and global search.

The manifest uses split incognito mode so extension pages can open inside private windows. `tablodge.private.config` in local storage holds the global private mode, setup completion, and the private new tab redirect preference, independently of library imports and preference resets. The redirect is enabled by default. Chromium does not allow an extension to statically replace the private new tab page, so the private worker redirects newly created browser new tabs to the dashboard after creation. Private messages and mutations are blocked until setup is complete. Normal windows always use the normal library. Private workers route library and recovery keys through `library`: shared mode keeps the original keys, saved mode prefixes them with `tablodge.private.` in local storage, and temporary mode uses the same prefix in session storage. Session storage survives worker and private window restarts but is cleared by a browser restart. Existing data needs no migration and mode changes do not copy or delete libraries. Mode changes join the worker's mutation queue and invalidate its settings and migration caches. Private pages reload when the mode changes. Changing the redirect preference does not reload open private pages. Appearance remains shared. Private workers do not run automatic recovery, backups, or browser bookmark monitoring, and they refuse the snapshot messages so shared mode never exposes the regular windows' snapshots. Dashboard lookup and new restore windows respect the private context.

## Recovery

Normal and private workers have separate JavaScript queues. A two participant bakery lock also coordinates shared library writes through `tablodge.lock.normal` and `tablodge.lock.private` in browser session storage. Web Locks cannot coordinate these workers because Chrome partitions them by private context. Library mutations and recovery queues hold the storage lock, with nested queues in one worker sharing its acquisition. Normal writes always participate so a mode change cannot race a private write started in shared mode. Separate private libraries need no cross context lock. A worker clears its own old slot when starting. A blocked writer times out without changing library data rather than taking another worker's lock. Reopening a private window clears its slot if that worker stopped during a save; a browser restart clears both slots.

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

The dashboard's **Archive session** action moves one session to the folder named Archived immediately, regardless of its age or the automatic archive setting. It changes `updatedAt` and deletes nothing. Move the session to another folder to take it out of Archived. The folder is available by default and cannot be renamed or deleted.

The `autoArchiveDays` setting is 0 (off, the default), 30, 90, 180, or 365. When it is on, a daily alarm and worker startup move every session whose newest of `lastOpenedAt`, `updatedAt`, and `createdAt` is older than that into Archived. The automatic move runs in the mutation queue and does not change `updatedAt`. Moving a session back out updates `updatedAt`, so it is not archived automatically again until it has been idle for the full period.

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

**Close duplicate tabs** (popup and side panel Tabs section) runs in the page, not the service worker. `findDuplicateTabs` in `src/app/duplicate-tabs.ts` groups web tabs from `chrome.tabs.query` in normal windows by their canonical address (the same exact match saving uses) and protects pinned and active tabs. Without one, the copy with the latest `lastAccessed` stays. The page then calls `chrome.tabs.remove`, and the Undo toast reopens each tab with `chrome.tabs.create` in its old window and index, rejoining its tab group if that still exists. No extra permission is needed and nothing is stored.

The `open-palette` shortcut opens `palette.html` in a small popup window (`openPalette` in the service worker), so it works on every page, restricted ones included, and the page never sees the key. The address carries `?window=<id>`, the window that was in front. Messages from that page go through `paletteSender`, which replaces the sender tab with the active tab of that window, so a restore or save acts on the window the user came from and not on the palette's own window. A second press closes the window, and so does another window taking the focus (`useCloseWhenUnfocused`, which acts only when `chrome.windows.getCurrent()` reports a popup, so the same page opened as a tab stays open). The page reuses `FinderPaletteWindow` from `src/app/finder.tsx`, with the `standalone` option that sends links, searches, and restores to that window. Before a query is typed the finder lists the eight most recently used sessions (`lastOpenedAt`, else `updatedAt`), then open tabs and commands. The right arrow opens a second level of actions for the highlighted result (`itemActions` in `src/app/finder-menu.ts`): the search box stays the combobox, switches `aria-controls` to the actions listbox, and filters it, with a breadcrumb above and `Esc` or `Backspace` to go back. The actions use APIs the extension already has (`chrome.windows.create`, `chrome.tabs.remove`, the clipboard), so no permission changes. The shortcut is a command, so the window needs no permission.

With the `paletteLocation` setting at `page`, `openPalette` first calls `openPaletteInPage`: for an `http` or `https` tab it runs `chrome.scripting.executeScript` with `togglePaletteOverlay` (`src/app/palette-overlay.ts`) as the injected function. Pressing the command grants `activeTab` for that tab, which is the only access the injection needs, so there are no host permissions and no content script on any page. `activeTab` and `scripting` produce no install warning in Chrome or Firefox, so an update that adds them is not held for approval. The function builds a closed shadow root holding a dialog with an iframe of `palette.html?overlay=1&window=<id>`, setting every style through the element style object so the page's CSS and CSP cannot reach in and nothing leaks out. The frame is the same `FinderPaletteWindow`, with `overlay` set: it asks the page to close with a `tablodge-palette-close` message instead of `window.close()`, and keeps Tab inside the frame. The injected script closes on `Esc`, an outside click, the message, or a second press, and returns focus to the element that had it. It keeps focus inside the dialog while open. `palette.html` is the only web accessible resource, matching `http` and `https`. If injection throws (browser pages, the Web Store, the PDF viewer, file addresses, no activeTab grant) or the tab is not `http` or `https`, `openPalette` opens the window as usual.

The toolbar icon action is configured in **Settings › Opening TabLodge › Toolbar button action**. The side panel is an action choice alongside the popup and save actions. A shortcut and browser side panel menu can open the panel independently.

The `tl` address bar keyword is handled by the service worker, which needs no permission for it. `onInputChanged` reads the library (cached until storage changes) and the open tabs, builds the finder index, and ranks it with the same scorer as the palette (`src/app/omnibox.ts`). A suggestion's content is the finder item id. `onInputEntered` maps it back: an open tab is focused, a bookmark or saved tab opens by the address bar disposition (a pinned TabLodge tab is never navigated away), a session opens the dashboard with `?group=`, and any other text opens the dashboard with `?q=`. The worker is bundled from its imports at build time, and the worker tests bundle it the same way (`tests/worker-source.ts`).

**Settings › Dashboard › Dashboard width** controls the dashboard container and bookmark grid together. The default keeps the existing 1,440 pixel maximum and three column desktop grid. Wider uses up to 1,920 pixels and four columns on a 1,920 pixel viewport. Full width removes the maximum and fits as many columns as the available space allows, with a 288 pixel minimum column width. Narrower uses a 1,024 pixel maximum and two columns. Small screens still use one column where two would not fit. The worker normalizes invalid values back to the default.

**Settings › Bookmark board › Bookmark view** switches between Board, the column grid, and Focus, a column list next to one open column. The same setting is available from the view button in the bookmarks toolbar. Limit bookmarks shown at a time is on by default, so columns in both views use a capped height and scroll through all of their bookmarks, and a busy column does not make the page taller. With the limit off, columns grow with the page. The worker normalizes invalid values back to Board.

**Settings › Bookmark board** also has three layout settings. **Bookmark column width** (narrow, default, wide, extra wide) sets the minimum column size in Board view to 224, 288, 384, or 512 pixels at the default font size. **Columns per row** caps how many columns share a row, from 1 to 6, and Automatic (0) has no cap. When both are at their defaults, the grid follows Dashboard width as before. Otherwise the grid uses `repeat(auto-fit, minmax(...))` from `src/app/bookmark-layout.ts`, so a narrow window still shows fewer columns than the cap instead of shrinking them below the minimum. Focus view always shows one column beside the list and ignores both. **Bookmark density** (comfortable or compact) applies to Board and Focus: compact uses a smaller grid gap and tighter column header, body, row, and rail spacing, and scales the capped column height to match, so the same number of bookmarks stay visible. The worker normalizes invalid values back to Default, Automatic, and Comfortable, and clamps columns per row to 0 through 6.

**Settings › Dashboard › Remove tracking parameters** is off by default. When enabled, opening saved links, copying a link with **Copy link**, restoring sessions, and restoring snapshots removes common query parameters such as `utm_source`, `fbclid`, and `gclid`. A few generic names are removed only on the sites that use them as share tracking: `s` and `t` on x.com and twitter.com status links, `ref_src`, `ref_url` and `cxt` on those hosts, and `si` on YouTube and Spotify. Saved URLs and exports keep their original values. The page helper and classic service worker maintain matching parameter lists.

UI primitives live in `src/components/ui/`, with composed helpers in `src/shared/ui.tsx`. Theme tokens and the accent colors live in `styles/extension-app.css`. `src/shared/accents.ts` lists the preset accents and applies every accent except the default as inline variables. The system accent is read from the CSS `AccentColor` keyword (Chromium's placeholder `rgb(0, 117, 255)` counts as no accent, and the extension cannot read the Chrome theme color) and rechecked on focus, on visibility and color scheme changes, and every two seconds while the page is visible, because the browser sends no event for it. `src/shared/theme.tsx` mirrors the saved theme and accent for the boot script and follows system theme changes. The `@/` alias resolves to `src/` during builds and must not remain in output bundles.

## Saving and restoring sessions

Save scopes include selected tabs, the current window, all windows, a native tab group, the active tab, and tabs to either side. Toolbar actions, context menus, and shortcuts share worker logic. The page menu's **Send this tab to session** submenu lists the ten most recently changed sessions outside the Archived folder, plus **New session**. It adds the tab through the same path as the toolbar's current tab mode, so excluded sites, the duplicate setting, and **Close tabs after saving** apply. The menus rebuild when that list of sessions or their names change. The `save-window` shortcut uses `selected-or-window`, so a selection takes precedence over the window.

Only ordinary HTTP and HTTPS URLs are saved. Excluded sites are filtered during capture. Native group metadata is restored where browser APIs allow it.

Pinned tabs are excluded by default. When included, they can be closed only after the session is written and **Close tabs after saving** is enabled. The worker checks each tab's URL and pinned state again before closing it. When that closes every tab in a window, the worker opens a new tab so the window stays, unless **When a save empties a window** is set to close it and another normal window of the same incognito state is open. It then focuses that window and closes the emptied one. The last window is never closed.

The default restore destination is a new window unless the current window contains only the current tab. Settings also offers current window and always new window policies. Saving a whole window records its size and position with the session. **Restore saved window size and position** is off by default; when enabled, it applies those bounds only when a session opens in a new window. The browser or window manager may override saved bounds, especially with tiling window managers. Ctrl/Cmd clicks keep saved links; Shift clicks force a new window. A failed restore never removes its saved link. Duplicate handling, activation, and unloading of restored background tabs are separate preferences. When **Remove tracking parameters** is enabled, restore duplicate checks compare the cleaned destination while the saved URL remains unchanged.

### Switching workspaces

`SWITCH_WORKSPACE` saves the window's web tabs (unless a saved session already has exactly those pages, in which case that session is reused and nothing new is saved), opens another session in the same window, and then closes the saved tabs. The save uses the normal naming and duplicate rules but leaves the tabs open and skips **Open dashboard after saving**. The restore ignores the restore target and duplicate preferences, so a URL that is already open still opens, and it follows the keep or remove preference as usual. The old tabs are closed only after the other session opened at least one tab, and only if their URL still matches what was saved. If the restore fails, the window keeps its tabs and the new session stays saved. Pinned tabs (unless saved), excluded sites, and pages that are not web pages are left alone, so the dashboard stays open. The dashboard menu item and the popup and side panel buttons are disabled while the window has no such tab (`useHasSavableTabs`, which follows tab events).

### Updating and splitting sessions

`UPDATE_GROUP_FROM_WINDOW` changes a session from the sender's window without touching any tab. `replace` swaps the session's links for the window's, and `append` adds the ones the session does not hold yet at the end. It captures with the same helper as a save (`captureEntriesOf`), so only web pages, no excluded sites, pinned tabs only when allowed, and split pairs recorded the same way. Duplicate handling follows **When a saved URL is saved again**: with rejection, a tab already saved in another session (or repeated in the window) is skipped, and the replaced session's own links never count as duplicates. Appending never adds an address the session already holds. A link the session already had keeps its notes, and its title unless **Title when a URL is already saved** is set to the latest. The name, folder, description, and timestamps other than `updatedAt` stay. A result over 1,000 links is refused rather than split across sessions.

`SPLIT_GROUP` moves the chosen links into a new session placed right after the source in the same folder, named `<source> (split)` unless a name is given. Link IDs and notes move with them. Split pairs survive only when both halves move, and the source must keep at least one link. Both actions run in `withUndo` over the main storage key, so they follow the Undo rules above. Neither changes the stored schema, so backups and imports are unaffected.

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

The setting can ask or add automatically to a chosen column, falling back to the first column. Removing the browser bookmark does not remove the TabLodge copy. Explicit bookmark imports turn each containing folder into a column, merge folders with the same name, and place links without a folder in the first column. Imports offer duplicate choices.

Columns and bookmarks are reordered by dragging. Any column, including the last, can be deleted. For a populated column, the dialog offers to move its bookmarks or delete them too; the last column has no move destination. The result offers Undo and stores the column in trash.

Bookmark selection stays in the dashboard page, not in storage. A toolbar toggle enables selection mode; Alt reveals selection controls temporarily. Shift selects a range in rendered board order, across columns, without including hidden search results or bookmarks not yet loaded. Ctrl and Command clicks retain native link behavior.

Moving or deleting a bookmark selection sends the existing mutation messages in sequence and stops on the first failure. A partial failure leaves completed changes in place and reloads the board. Group moves preserve board order, and deletion offers one Undo that restores the individual trash entries in reverse deletion order. Multi-bookmark drags keep the dragged bookmark ID for board reordering and include the selected links for drops into sessions. Selected saved tabs carry the same link list when dropped onto bookmark columns. Selection state stays in the page and is not stored.

## New tab behavior

Firefox is the exception: its hand off cannot work (see [Browser support](#browser-support)), so the switch is hidden and the override stays on.

Chromium declares the new tab override statically. Turning off **Use TabLodge for new tabs** cannot remove that declaration. Instead, the worker redirects newly created tabs to the browser's own page, a blank page, or a custom HTTP or HTTPS URL.

`newtab.html` also asks `HANDOFF_NEW_TAB` whether a redirect is needed before rendering. A counter prevents redirect loops: after one retry, the tab goes to `about:blank`. Opening the dashboard deliberately still works. Address bar focus depends on the destination and browser.

## Imports and exports

Session and bookmark menus provide their own import and export actions. A session menu can export only that session in any supported format; Settings also provides data tools. Parsing and conversion live in `src/app/import-formats.ts`. Imports accept native backups and formats from other tab managers. Unsupported URLs are ignored. Duplicate choices appear only when needed and are separate from restore preferences.

Session JSON includes sessions and folders. Bookmark JSON includes columns and bookmarks. A split pair uses `split: {id, position}`, where position is 0 for left and 1 for right. Import keeps only complete adjacent pairs with matching pinned and group state. Invalid pair metadata is dropped without losing the links.

A session has one description, capped at 10,502 characters. Older separate `notes` fields are merged into the description with a blank line when both differ. Editing a saved tab title preserves its notes.

### Full backup ZIP

`src/app/full-backup.ts` builds `tablodge-full-YYYY-MM-DD.zip` on the page using bundled `fflate`. The worker supplies data through `GET_FULL_BACKUP`.

| File | Contents |
| --- | --- |
| `manifest.json` | Format `tablodge-full-backup`, versions, creation time, and counts |
| `data.json` | Normalized state, including settings and excluded sites |
| `preferences.json` | Theme and accent color choice |
| `snapshots.json` | Snapshot history |
| `trash.json` | Trash entries |

Automatic backup history and Undo records are not included. Import recognizes the ZIP header and format identifier, shows counts, and sends `RESTORE_FULL_BACKUP`. The worker rejects newer versions, normalizes entries, takes a safety backup, and replaces the affected data inside one undoable action. It then resynchronizes alarms, toolbar behavior, and menus.

Files above 45 MB, or expanding beyond 60 MB, are refused. All export formats are unencrypted; see [Privacy](PRIVACY.md) before sharing backups.

## Testing

The worker harness runs the source in a fresh Node VM with mocked `chrome.*` APIs. Pure helpers also have direct unit tests. These tests cover storage and browser logic, not full browser behavior. Use the unpacked build for a manual smoke test, especially for worker restarts, native groups, split view, and side panel gestures.

`tests/manifest-targets.test.ts` covers the Firefox manifest, and the worker harness has a Firefox mode (`firefox: true`) for the differences above. `vp run browser:firefox` (`scripts/firefox-smoke-check.ts`) goes one level up: it installs `dist/tablodge-firefox/` as a temporary add-on in headless Firefox through Selenium and drives the worker with its own messages. It opens all seven pages, saves a window with a pinned tab and a tab group, restores it into a new window, adds a bookmark, imports browser bookmarks, exports a full backup, and checks that data survives a browser restart. It needs Firefox installed. Selenium downloads a matching geckodriver if there is none on the `PATH`, and `FIREFOX_BIN` overrides the browser binary. Safari has no automated check because it is not supported.
