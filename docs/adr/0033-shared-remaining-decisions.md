# 33. Remaining shared helper decisions that were code comments (src/shared)

Status: accepted, 2026-11-25. Issue #442.

## Context

This record covers the last comments in `apps/extension/src/shared/`: source columns (`source-columns.ts`), session folders (`session-folders.ts`), setting sync scopes (`setting-scopes.ts`, [ADR 11](0011-setting-sync-scopes.md)), device names (`device.ts`), the browser check (`browser.ts`), UI controls and the theme (`ui.tsx`, `theme.tsx`), focus handling (`focus-rescue.ts`), and small helpers (`motion.ts`, `download.ts`, `use-stable.ts`, `radio-keys.ts`, `escape-html.ts`, `load-more.tsx`, `dev-fixture.ts`). Their non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Other areas are in [ADR 27](0027-shared-sync-decisions.md) through [ADR 32](0032-shared-menus-links-bookmarks-decisions.md).

## Decisions

### Source columns (`source-columns.ts`)

* **A source column's id is the marker.** `source-<site>` identifies the column, and the record keeps the shape every released app knows. Devices keep the id through sync, backups, and edits, and two devices that create it write the same record. The Android app shows the site's name (`source-columns.ts:sourceColumnId`, `source-columns.ts:isSourceColumnId`).
* **An id for a site this version does not know is still a source column.** Imports keep it, so the marker survives an export from a newer version. It behaves as a plain column here (`source-columns.ts:isSourceColumnId`, `source-columns.ts:sourceColumnSite`).
* **A new source column gets a preset look,** which the user can change later. Its color is a preset accent id or a lowercase `#rrggbb`, as a column color takes (`source-columns.ts:SOURCE_COLUMNS`).

### Session folders (`session-folders.ts`)

* **Folder rules are shared** by the service worker and the Android app, with no browser APIs (`session-folders.ts` module).
* **A folder name is cut to 60 characters,** with control characters turned into spaces and the ends trimmed (`session-folders.ts:normalizeFolderName`).
* **Folder names are unique ignoring case,** except for the folder being renamed (`session-folders.ts:folderNameExists`, `session-folders.ts:folderNameProblem`).
* **There are at most 200 folders besides Archived,** which does not count. A new folder must fit under that limit, and a rename does not (`session-folders.ts:folderLimitReached`, `session-folders.ts:FOLDER_LIMIT_MESSAGE`).

### Setting sync scopes (`setting-scopes.ts`, [ADR 11](0011-setting-sync-scopes.md))

* **Each setting has one of three scopes:** `all` syncs everywhere, `platform` syncs to one kind of device, and `device` never syncs. A `device` setting is one that cannot mean anything on another device: its name, its connection, a permission only it can grant, its installed apps, its private library, dismissals, and remembered state (`setting-scopes.ts:SettingScope`).
* **Library settings** are listed under `LIBRARY_SETTINGS`, except `heldSettings`, which only carries a newer version's settings (`setting-scopes.ts:LIBRARY_SETTINGS`).
* **Extension settings kept outside the library** have their own storage keys, and the ids the platform ones sync under (`setting-scopes.ts:EXTENSION_STORAGE`).
* **Android preferences never reach a browser,** so none is `all`. A setting both apps share belongs in the library's settings instead (`setting-scopes.ts:ANDROID_PREFERENCES`).
* **Tests enforce the scopes.** `keysScoped` lists the keys of one scope (`setting-scopes.ts:keysScoped`).

### Device names (`device.ts`)

* **The device name is the person's own** and belongs to one device, not to a platform. It is kept on the device, defaults to something read from the system, and is stamped onto each session and bookmark saved from it (`device.ts` module, `device.ts:deviceStamp`).
* **A rename does not rewrite what was saved.** Saved items keep the name they were saved under (`device.ts` module).
* **The name is never synced.** Each device has its own, and the key is device-scoped (`device.ts:DEVICE_KEY`, [ADR 11](0011-setting-sync-scopes.md)).
* **A name is one trimmed line, no longer than a label can hold** (`device.ts:cleanDeviceName`).
* **Some browsers send a stock Chrome or Firefox user agent** while naming themselves elsewhere. The brand list and the user agent tokens are checked in order, with the specific names first (`device.ts:BRANDS`, `device.ts:TOKENS`).
* **The browser's name comes from the brand list first,** because Brave and others send Chrome's user agent string. Forks that copy Firefox's user agent exactly, such as Zen, show as Firefox (`device.ts:browserName`).
* **Default names:** a desktop browser is named after itself and its system, and a phone after its maker and model without saying the maker twice (`device.ts:defaultBrowserDeviceName`, `device.ts:defaultPhoneDeviceName`).

### Browser checks (`browser.ts`)

* **Pages ask here which browser they run in.** The extension builds for Chromium and Firefox from one source, so a page branches on this module instead of testing the browser itself. Anything a page can learn by looking for the API keeps doing that ([Browser support](../architecture.md#browser-support)) (`browser.ts` module).
* **Firefox addresses are `moz-extension://`,** and Chromium's are `chrome-extension://` (`browser.ts:isFirefox`).
* **Chromium opens its side panel** from the toolbar button, a shortcut, or a menu. Firefox has a sidebar, which a page can open from a click but the toolbar button cannot be set to open (`browser.ts:canOpenSidePanel`, `browser.ts:toolbarOpensSidePanel`).
* **Opening the side panel or sidebar only works from a user action.** Call it from the click handler before awaiting anything else (`browser.ts:openSidePanel`).
* **The shortcuts page is opened through the API,** because plain links to browser pages are blocked. Firefox uses `commands.openShortcutSettings`, and Chromium uses `tabs.create` (`browser.ts:openShortcutsPage`).

### UI controls and theme (`ui.tsx`, `theme.tsx`)

* **Search stays one icon until needed,** and stays open while it holds a query. Escape closes it from inside, so focus goes back to the icon button that opens it (`ui.tsx:ExpandingSearch`).
* **The result region stays mounted in both states,** so a screen reader treats later text as an update (`ui.tsx:ExpandingSearch`).
* **The search announcement says the count,** such as "3 bookmarks found," and says nothing when the query is empty (`ui.tsx:ExpandingSearchProps`).
* **Destructive confirmations are for the Settings page.** Dashboard, new-tab, and side-panel actions run at once with an Undo toast instead. The exception is an action the server cannot undo, such as deleting a shared page: it asks first wherever it runs ([UI rules](../agents/ui.md#destructive-actions)) (`ui.tsx:ConfirmationDialog`).
* **A dialog's close callback runs before focus returns** to what opened it (`ui.tsx:ConfirmationDialog`).
* **The theme mirrors the stored theme and accent into localStorage,** so pages with a pre-paint boot script can apply them before React loads (`theme.tsx:applyDocumentTheme`, `shell/theme-boot.ts`).
* **The provider starts from what the boot script applied,** so the first render does not reset it (`theme.tsx:ThemeProvider`).
* **The system accent is kept current while the accent is `system`** (`theme.tsx:ThemeProvider`, [ADR 32](0032-shared-menus-links-bookmarks-decisions.md)).
* **Only a private window has its own accent.** Regular windows ignore it (`theme.tsx:PRIVATE_CONFIG_KEY`).
* **Every page mounts the provider,** so it also keeps focus from falling to `<body>` when an item is removed (`theme.tsx:ThemeProvider`).

### Focus rescue (`focus-rescue.ts`)

* **Focus stays near where the user was when the focused element disappears.** For example, a session deleted from its menu comes with an Undo toast instead of a confirmation (`focus-rescue.ts` module).
* **The last focused element outside menus and dialogs is remembered with its neighbors.** When focus falls back to the body and that element is gone, focus moves to the nearest surviving neighbor, then to the heading of its section (`focus-rescue.ts:rescue`, `focus-rescue.ts:REGION`).
* **Each remembered element records the siblings it had,** up to the enclosing region (`focus-rescue.ts:Anchor`).
* **Dialogs trap focus and hand it back when they close.** The rescue waits for that, and lets React commit the removal first (`focus-rescue.ts:installFocusRescue`).
* **A dialog's return target is the control that opened it,** or null when that is gone, and the rescue then picks a neighbor. Radix has no trigger to hand focus back to here, because dialogs are controlled by page state (`focus-rescue.ts:focusReturnTarget`).

### Small helpers

* **Script scrolling is smooth** unless the user asks for reduced motion (`motion.ts:scrollBehavior`). An explicit `smooth` ignores the CSS `scroll-behavior` rule. Under reduced motion `scrollBehavior()` returns `auto`, and then `scrollIntoView` uses the computed CSS `scroll-behavior` of each scrolling container, and for the viewport the root element. The target's own value does not count, so a `smooth` rule on a container still makes that scroll smooth.
* **Generated files download through one helper** (`download.ts:downloadFile`).
* **Callbacks keep their identity** and always call the newest functions, so a long list does not re-render (`use-stable.ts:useStableCallbacks`).
* **Radio arrow keys wrap around,** as in the WAI-ARIA radio group pattern. Home and End jump to the ends (`radio-keys.ts:radioTargetIndex`).
* **Text is escaped for HTML content and quoted attributes** (`escape-html.ts:escapeHtml`).
* **A long list shows one page at a time,** grows by a page on each request, and starts over when its filter, search, or sort changes. `showUpTo` reveals an item further down (`load-more.tsx:usePagedLimit`).
* **The end of a long list is a real button,** so keyboard and screen reader users can load more without scrolling. It asks for the next batch as it nears the viewport (`load-more.tsx:LoadMore`).
* **Dev fixture data is for local UI work only.** It is built from the worker's default store and is synthetic. Its notes and tags sit in short columns, so the board keeps the height the accessibility checks' drags rely on (`dev-fixture.ts:createDevFixture`).
