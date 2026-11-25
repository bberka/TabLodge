# 17. Extension page decisions that were code comments (src/app, part 1)

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/extension/src/app` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. This ADR covers the first part of the folder, from `accent-palette.tsx` to `drag-preview.ts`. The rest of the folder adds its entries here in later parts. The shared logic in `src/shared` and the service worker in `shell/` are other areas. Logic that needs no browser lives in plain modules: [Extension](../agents/extension.md#where-things-are).

## Decisions

### Colors

* **The native picker is debounced.** `accent-palette.tsx:PICKER_DEBOUNCE_MS`: the browser's color picker fires on every drag step, so the page follows the value only after the drag pauses for 300 ms.
* **The system accent is a choice only where the platform has one.** `accent-palette.tsx:systemChoice`: elsewhere it falls back to the default. A column's color has no system accent, and its first choice is none (`accent-palette.tsx:NO_COLOR_CHOICE`).
* **The picker opens after a frame.** `accent-palette.tsx:AccentPalette`: the native picker opens beneath its input, which is laid over the trigger, so `showPicker()` waits for `requestAnimationFrame`.

### Add bookmark prompt

* **The page head is read while the bundle loads.** `shell/add-bookmark-preload.ts` sets `globalThis.__tablodgeBookmarkPrompt` from the page head, and `add-bookmark.tsx:preloaded` reads it, so the prompt does not wait for the bundle.
* **An empty answer is retried quietly.** `add-bookmark.tsx:useBookmarkPrompt`: the service worker may still be waking up.

### Archive links

* **Only a click sends the address.** `archive-link.ts:archiveUrl`: the address goes to archive.org when the menu item is chosen and nowhere else. TabLodge stores nothing about it.
* **Tracking parameters go first.** `archive-link.ts:archiveUrl` with `removeTracking`: they are dropped before the address is built, so they are not sent to archive.org either.

### Bookmark board: drag, selection, layout

* **Drag rules need no component.** `bookmark-drag.ts` (module): the rules are plain functions, so tests run without a browser. The board owns state and persistence.
* **The Focus All item takes no drop.** `bookmark-drag.ts:ALL_BOOKMARKS_ID`: it lists every column's bookmarks, is not a column, and keeps no order of its own, so the browser refuses the drop.
* **Without manual order, a drop goes to the end.** `bookmark-drag.ts:previewBookmarkDrop`: when the column is sorted by something else, the stored order is not shown, so no slot is offered next to a card.
* **The board gap matches the CSS.** `bookmark-layout.ts:BOOKMARK_GAP_REM`: each value matches the grid gap class of its density.
* **Columns per row is a cap.** `bookmark-layout.ts:bookmarkGridTemplate`: a narrow container fits fewer columns than the cap, and no column shrinks below its minimum width. The template is undefined at the defaults, so the Dashboard width grid applies.
* **Alt shows the checkboxes without selection mode.** `bookmark-selection.ts:useBookmarkSelection`: holding Alt shows the checkboxes, and selection mode stays off.

### Bookmark tags

* **The rules are shared with Android.** `bookmark-tags.tsx` (module): the rules live in `src/shared/bookmark-tags.ts`, which the Android app shares. The sync side is [ADR 8](0008-bookmark-tags-sync.md).
* **The menu stays open for several tags.** `bookmark-tags.tsx:TagFilterMenu`: `preventDefault` keeps the menu open, so several tags can be picked in a row.
* **Removing the kind removes the typed tag too.** `bookmark-tags.tsx:TagsField` (`setKindHidden`): otherwise the chip comes straight back.
* **Enter adds a tag and does not submit the editor.** `bookmark-tags.tsx:TagsField`: the key handler prevents the default, so the editor stays open.
* **Focus moves when the button goes away.** `bookmark-tags.tsx:TagsField`: the remove button unmounts, so focus goes to the input, or to the kind's own remove button when the input is full.

### Toasts and status

* **Each status gets a new id.** `common.tsx:Status`: a repeated message shows again after it was dismissed.
* **Escape closes only what no control already handled.** `common.tsx:useCloseOnEscape`: a key that closed a menu inside the window does not also close the window.
* **Tab selection matches the save.** `common.tsx:useTabSelection`: Ctrl and Shift click selection reads the same way as the service worker's "selected-or-window" save. Both halves of a split view count as one slot. `count` is the selected web tabs that would be saved, and pinned ones only with `includePinned`. Without a readable selection the button keeps saving the whole window.
* **A savable-tabs check does not restart on each render.** `common.tsx:useHasSavableTabs`: `excludedOrigins` is joined into a string, so a fresh array on every render does not restart the listeners. Without a readable tab strip the switch stays off.
* **Unchanged items keep their JSON.** `common.tsx:jsonCache`: each reload returns new objects. Reusing the previous JSON for unchanged items lets memoized cards and rows skip rendering after an unrelated edit.
* **A waking worker is not an error.** `common.tsx:useTabLodgeState`: transport failures retry quietly, and only a definitive failure replaces the loading state with an error.
* **The newest load wins.** `common.tsx:useTabLodgeState`: each load gets a number, and only the newest may write state, so a slow older response cannot overwrite a newer one.
* **A burst of storage writes is read once.** `common.tsx:useTabLodgeState`: an import, a bulk move, or the page's own reload after an action produce one read.
* **A toast holds one button.** `common.tsx:reportSessionSave`: a save that closed its tabs offers Undo, and a save with rejected duplicates offers Force add instead.
* **A skipped duplicate is a notice.** `common.tsx:showSaveFailure`: it never reads as success and is not an error either.
* **Toast settings reach open pages.** `common.tsx:useToastPrefs`: the worker is asked when a page opens and again for each toast, so a change in Settings reaches a page that is already open.
* **Toast timing.** `common.tsx:StatusLine`: a success stays 4 s, a toast with an action 6 s, an error 10 s. The Messages setting doubles these, and Until dismissed never hides them. An error passed in directly, such as a failed first load, stays until dismissed. The timer pauses while the pointer or focus is on the toast, so Undo can always be reached. Ctrl or Cmd+Z runs the action from anywhere except text fields, which keep their own undo.

### Shared chrome

* **The filled mark is TabLodge's own.** `common.tsx:MARK_PATH` matches `shell/icons/tablodge.svg`. Actions use the outline Layers2 icon instead.
* **The skip link lands on an empty marker.** `common.tsx:MAIN_CONTENT_ID`: an empty, focusable element right after the header, so the next Tab reaches the page content.
* **Hash links use the page's own handlers.** `common.tsx:AppHeader`: a plain hash jump would also fire the pages' hash handlers (Settings and Help topics), so the header prevents the default.

### Session manager (Dashboard)

* **One empty list.** `dashboard.tsx:NO_SESSIONS`: memoized values and effects do not see a new array on every render.
* **Sessions render in batches.** `dashboard.tsx:SESSION_PAGE`: 40 at first, then more as the list scrolls, because thousands of cards at once are slow.
* **Drag state stays out of React state.** `dashboard.tsx:DragStore`: only the cards a drag touches re-render. Each card subscribes to its own slice.
* **Card callbacks are stable.** `dashboard.tsx:SessionManager` (`cardActions`): one object always calls the latest closures, so memoized cards are not re-rendered by a new handler.
* **Links are saved only by drops on a session.** `dashboard.tsx:SessionManager` (the window drop listener): a stray drop elsewhere is swallowed, so the page does not navigate to the link.
* **Reconcile on each saved state only.** `dashboard.tsx:SessionManager`: changing the folder filter does not re-run the reconcile.
* **The keyboard moves a session.** `dashboard.tsx:moveGroup`: one step up or down in the list as shown, as the alternative to dragging.
* **A drag styles its source after a frame.** `dashboard.tsx:begin` (drag): styling the row at once can cancel the browser's drag.
* **Drag data is read before the first await.** `dashboard.tsx:drop` (drag): it is readable only synchronously.
* **Undo returns a session to where it is now.** `dashboard.tsx:moveGroupToFolder`: the menu may have opened on an older copy of the session.
* **Edit folder keeps the folder it was opened for.** `dashboard.tsx:SessionManager`: Edit folder is also in each folder's right-click menu, so the dialog uses the folder it was opened for, not the selected one.
* **Deletes are immediate, with Undo.** `dashboard.tsx:deleteGroup`: the session goes to the trash at once, and `closeEditor` also closes the details dialog it was asked from.
* **Batches of more than 10 tabs get Undo.** `dashboard.tsx:openAllInNewTabs`: a handful of tabs is routine, and a bigger batch gets an Undo that closes them again.
* **Where a link sat.** `dashboard.tsx:moveTab`: the Undo puts the link back next to the same neighbor.
* **A card's link order is kept.** `dashboard.tsx:resolveDropMark`: dragging a link inside its own session offers no drop, because links keep the order they were saved in. Ctrl copies it.
* **A split pair moves as one.** `dashboard.tsx:resolveDropMark`: dropping beside one half lands outside the pair.
* **Untitled sessions still have a name.** `dashboard.tsx:GroupCard`: screen readers read the names, so a session saved without one reads as "Untitled session".
* **Portal clicks reach the card.** `dashboard.tsx:GroupCard`: a menu is drawn in a portal, but its clicks still reach the card through React, so the card ignores them.
* **The title button is the keyboard control.** `dashboard.tsx:GroupCard`: the preview icons are `aria-hidden` and decorative. The title button is the control for keyboards and screen readers.

### Data transfer dialogs

* **The file formats live in pure modules.** `data-transfer.tsx` (module): `export-formats.ts`, `import-formats.ts`, and `share-formats.ts` hold the formats, so tests need no dialog.
* **A backup share never asks the server.** `data-transfer.tsx:ShareDialog`: a backup-only dialog has nothing to upload, so it does not ask the sync server about shared pages.
* **The backup password stays in dialog state.** `data-transfer.tsx:ShareDialog`: the secret is cleared when the dialog closes.
* **A stale backup stays quiet.** `data-transfer.tsx:ShareDialog` (`dialogRunRef`): a backup that outlives its dialog compares the run number and does nothing.
* **A full backup merges by default.** `data-transfer.tsx:ImportDialog` (`fullMode`): Merge adds to the library. Replace swaps everything, settings included.
* **An encrypted backup stays locked.** `data-transfer.tsx:ImportDialog` (`locked`): nothing is read from it until its password opens it.
* **The form resets on open, not on close.** `data-transfer.tsx:ImportDialog`: the closing animation keeps the last content.
* **Focus follows the step.** `data-transfer.tsx:ImportDialog`: the source button unmounts when the preview appears, so focus moves to Import. The same goes for the credential field.
* **The import merge is additive.** `data-transfer.tsx:runFullImport`: new sessions, bookmarks, and columns are added. Links already saved are skipped. Settings, snapshots, and trash stay as they are.
* **A full backup restores everything.** `data-transfer.tsx:kindSwitch`: choosing Bookmarks or Sessions would only mislead.

### Default column and device name

* **Source columns never count as a default.** `default-column.ts:defaultBookmarkColumnId`: a save on a site does not move the user's default. The default is read from the bookmarks themselves, so nothing is stored, synced, or cleaned up when a column is deleted.
* **Brave is named by its own API.** `device-name.tsx:browserBrands`: Brave's user agent does not say so, so its own API is asked.
* **The device name follows the browser until changed.** `device-name.tsx:DeviceNameField` and `commit`: the name marks the sessions this browser saves. The detected name is not stored, so it keeps following the browser, and only a different name is saved.

### Drag autoscroll

* **The page scrolls the drag itself.** `drag-autoscroll.ts` (module): a native HTML5 drag scrolls on its own only in a thin strip at the window edge, at a fixed speed, and not at every edge of a nested pane. The page runs a `requestAnimationFrame` loop instead, with a wider strip that speeds up toward the edge.
* **The wheel is left alone.** `drag-autoscroll.ts` (module): browsers either swallow the wheel for the whole drag or scroll natively during it, and a listener that cancels it would stop that. The edge scroll keeps the page reachable.
* **The edge speed stays low.** `drag-autoscroll.ts:MAX_SPEED`: Chromium adds its own scroll in the last few pixels of the window, so this stays below what a lone loop would use.
* **Reduced motion scrolls slower.** `drag-autoscroll.ts:REDUCED_MOTION_FACTOR`: the view still scrolls, at 35% of the speed.
* **A stalled tab does not jump.** `drag-autoscroll.ts:MAX_FRAME_MS`: one frame advances at most 50 ms.
* **The window edge wins.** `drag-autoscroll.ts:pick`: a pointer held at the window's edge means scroll the window, so a pane whose far edge lies there must not take the pointer. `elementTarget` gives a pane past the window no bounds, for the same reason.
* **The loop runs until stopped.** `drag-autoscroll.ts:tick`: a list that loads more rows can become scrollable again.
* **Scrolls are instant.** `drag-autoscroll.ts:moveBy`: a page with `scroll-behavior: smooth` would animate every frame.
* **The lifecycle follows the drag.** `drag-autoscroll.ts:watchDragAutoscroll`: it starts on the first `dragover` and ends on a drop, the end of the drag (Escape included), the pointer leaving the window, or any ordinary input, which cannot arrive during a native drag.
* **Only leaving the window ends it.** `drag-autoscroll.ts:watchDragAutoscroll` (`onLeave`): moving between elements also fires `dragleave`.
* **Add and remove use one options object.** `drag-autoscroll.ts:watchDragAutoscroll`: some runtimes ignore a bare `true` when removing a listener.

### Drag previews

* **The preview is built offscreen, then removed.** `drag-preview.ts:setSessionDragImage`: the card goes to `setDragImage`, and is removed right after the browser snapshots it.

### Duplicate bookmarks

* **Removal is capped.** One removal trashes at most 500 copies, the trash bin's item limit (`duplicate-bookmarks-dialog.tsx:REMOVE_AT_ONCE`).

### Duplicate tabs

* **Only exact duplicates close.** Duplicates match exactly on the canonical web address, so a different query or fragment is a different page. Pinned tabs and the tab viewed in each window are never closed; when a group has one, every unprotected copy goes. Otherwise the most recently used copy stays (`duplicate-tabs.ts:findDuplicateTabs`).
* **A tab the browser will not reopen is skipped.** The rest still come back (`duplicate-tabs-action.ts:reopen`).
* **A tab whose window is gone opens in the current window** (`duplicate-tabs-action.ts:reopen`).
* **A tab closed meanwhile is not a failure.** It is skipped and not counted as an error (`duplicate-tabs-action.ts:closeDuplicateTabs`).

### Favicons

* **The icon source depends on the browser.** Chromium serves cached site icons at `_favicon/`. Firefox has no such service, so it shows the tab's own icon where known, else an icon remembered from an earlier tab of the site. With a sync server connected, the server is asked about a site the browser does not know; the extension never asks a site itself (`favicon.tsx:faviconUrl`).
* **Remembered icons load once per page.** The device's icons (remembered tab icons on Firefox, server icons on both) are read once per page and kept current (`favicon.tsx:NO_ICONS`).
* **The default globe counts as no icon.** Chromium answers an unknown site with its default globe, never an error. The globe is read once per page from an address no site can have, and an icon equal to it counts as missing (`favicon.tsx:defaultIcon`).
* **Only links on screen ask.** An icon is asked about when it scrolls into view, so a long list asks only about what is shown (`favicon.tsx:visibleCallbacks`).
* **The server is asked once, and only without a browser icon.** Once the element is on screen the server is asked about the site once, and not at all when the browser already has an icon (`favicon.tsx:useServerIcon`).
* **Unknown is missing on Firefox.** Firefox has no browser icon to look at, so an unknown site counts as missing (`favicon.tsx:useServerIcon`).
* **A stored icon yields to the browser.** On Chromium a stored icon replaces the browser's only when the browser has none (`favicon.tsx:Favicon`).
* **The tab's own icon comes first without a service.** Without an icon service the tab's own icon is the first choice (`favicon.tsx:Favicon`).

### Finder

* **One command list for every finder.** The dashboard, the new tab page, and the palette window or overlay share one list. Each page supplies how to run each command and leaves out only what cannot work there, with the reason next to it (`finder-commands.ts:CommandHandlers`).
* **The empty filter shows eight.** The first eight commands are what the finder lists before anything is typed, so their order is visible to the user (`finder-commands.ts:COMMANDS`).
* **Firefox has no private library.** Firefox keeps the add-on out of private windows, so there is no private library to manage there (`finder-commands.ts:NOT_ON_FIREFOX`).

### Menus and palette

* **Private windows list no copies.** `copies` is empty in a private window (`finder-menu.ts:ItemActionContext`).
* **Firefox cannot open a private window.** `privateWindow` is false there (`finder-menu.ts:ItemActionContext`).
* **Back keeps the caret.** In the actions filter a key goes back to the results only with the caret at the start and nothing selected, so the caret still moves through typed text. Backspace goes back only on an empty filter (`finder-menu.ts:leavesActionMenu`).

### Focus view hint

* **The column limit follows the setting.** `FOCUS_HINT_COLUMNS` matches the largest "Columns per row" setting: past it, a row cannot hold every column (`focus-hint-rule.ts:FOCUS_HINT_COLUMNS`).
* **Dismissal stays on this device.** It is remembered per browser profile and not synced, since another device may have another screen (`focus-hint.tsx:readFocusHintDismissed`).
* **Without storage the hint returns.** It can come back on the next visit (`focus-hint.tsx:readFocusHintDismissed`).

### Help

* **The licences page is written at build time.** `scripts/build.ts` writes the page this link opens into the package (`help.tsx:Help`).

### Drag and clipboard

* **The drag kind comes from the types.** Browsers hide drag data until the drop, so `dragPayloadKind` judges what a drag carries from its types alone (`interaction-actions.ts:dragPayloadKind`).
* **Stray link drops are swallowed.** Only valid drop targets (bookmark columns, Unfiled) call preventDefault. Any other link drag gets the "no drop" cursor, and a stray drop is swallowed so the page does not navigate to the dragged link. Text fields keep native drops (`interaction-actions.ts:shouldBlockDocumentDrop`).
* **A single saved tab keeps its title in the anchor.** Its title is only in the html anchor, beside its url in `text/uri-list` (`interaction-actions.ts:parseDraggedLink`).
* **A group drag carries a list.** A single tab drops as a link. A named group drops as a titled list and also carries `SESSION_DRAG_TYPE`, so TabLodge's own columns add every link (`interaction-actions.ts:buildLinkDragData`).

### Lazy dialogs

* **Big dialogs load on first open.** Backup, import, share, snapshots and trash are loaded when first opened, so a page does not download or parse them just to show its list. Once opened, a dialog stays mounted so it can animate closed (`lazy-dialogs.tsx:lazyDialog`).

### Link opening

* **One rule for opening a saved link.** It is shared by the dashboard, the side panel and the finder. An explicit menu choice wins over the setting, and on the pinned TabLodge tab "current" becomes "new". A bookmark click may resolve to 'menu' and any click to 'none'; a surface without a menu or an idle click says so (`canMenu`, `canIdle`), so 'menu' opens in the current tab and 'none' acts as the default setting. The finder sets both, because Enter on a result must never do nothing (`link-target.ts:resolveLinkTarget`).
* **No private window in Firefox.** Firefox builds set `incognito: 'not_allowed'`, so the option is never offered there (`link-target.ts:canOpenPrivateWindow`).
* **A refused private window reaches the user.** The browser refuses when policy turns private windows off, so the rejection goes to the caller, which tells the user (`link-target.ts:openInPrivateWindow`).
* **The palette's current tab is its own window.** From the palette window, "current" means the active tab of that window, which comes to the front (`link-target.ts:openLink`).
* **Own pages keep the pinned tab.** Settings and Help replace the current tab, except on the pinned TabLodge tab, which must stay put and opens a new tab (`link-target.ts:openOwnPage`).

### Messages

* **A reloaded worker gets a reload message.** The worker is gone when the extension was reloaded or updated while the page stayed open, so the page asks for a reload instead of showing a raw error (`message-client.ts:sendMessage`).

### Session naming

* **The ask resolves three ways.** It resolves a name, or undefined when left empty (the worker then uses its fallback name), or null when cancelled, in which case nothing is saved. Without the `ask` style it resolves at once, and the dialog is rendered once per page (`name-session-dialog.tsx:useSessionNameAsk`).
* **The worker decides whether to ask.** A setting in the page can be stale, so the worker's answer wins (`name-session-dialog.tsx:useSessionNameAsk`).
* **The prompt window renames the sessions.** It opens after a save that started without a page. The sessions already exist with the fallback name; Save renames them, and Cancel, Escape or closing the window keeps that name (`name-session.tsx:NameSessionPrompt`).

### Finder palette

* **One ranking and one way to open results.** The global finder (Ctrl/Cmd+K) has one search box, one ranking in `shared/global-search.ts`, and one way of opening results, so every surface opens a result the same way (`finder.tsx:FinderPalette`).
* **The palette window acts on the window it was opened over.** Links, searches and session restores go to that window, the one in front when the shortcut was pressed, and the palette closes after the action succeeded (`finder.tsx:useFinder`).
* **Typing stays responsive.** The input is not blocked while a big library is searched: results follow the query when React has time (`finder.tsx:useFinder`).
* **Close order depends on the surface.** Over the dashboard the palette closes first; in its own window it closes once the action worked (`finder.tsx:useFinder`).
* **The dashboard may be leaving.** Over the dashboard the page may already be navigating away, but in the palette window the user is still looking (`finder.tsx:useFinder`).
* **Readers open where the palette was opened.** The palette window is not where the reader belongs, so the page opens in the window the palette was opened over (`finder.tsx:useFinder`).
* **Escape is handled once.** Escape goes up one level before it closes the palette, and the window and dialog handlers skip a handled key (`finder.tsx:useFinder`).
* **Focus is brought back only when needed.** The window the palette was opened over comes to the front, except after a restore into a new window, which already has focus (`finder.tsx:useFinder`).
* **A closed window is not a failure.** The window may have closed meanwhile; the restore itself worked, so the error is ignored (`finder.tsx:useFinder`).
* **Focus view needs the rail first.** The Focus view renders one column at a time, so the rail item is opened first (`finder.tsx:revealColumn`).
* **The count is announced once.** Moving through results announces each option, so this live status says only how many a new search found (`finder.tsx:ResultList`).
* **The search box stays the combobox.** The actions menu is a second level: the search box keeps the combobox role and filters the actions, and the breadcrumb names where the user is (`finder.tsx:ActionMenu`).
* **The palette window focuses its input itself.** It has no dialog to move focus into the input (`finder.tsx:PaletteBody`).
* **The list fills the palette window.** The dialog caps the list height. The palette window fills its height instead: the list takes the spare room and scrolls when it overflows, so the shortcut bar stays at the bottom edge (`finder.tsx:PaletteBody`).
* **The key bar shows what fits.** One row at any width: only the keys for the highlighted row show, the least needed hidden first, and `?` lists them all (`finder.tsx:PaletteBody`).
* **Only a popup closes on blur.** The palette window closes when another window takes focus, but only a real popup window does this; the same page opened as a tab by address stays open. A short wait skips the blur the browser sends while the window is still being focused (`finder.tsx:useCloseWhenUnfocused`).
* **The overlay is a frame.** The palette can be a frame over a web page (see `palette-overlay.ts`): closing asks the page to remove the frame (`finder.tsx:FinderPaletteWindow`).
* **Tab stays in the frame.** Tab cycles through the frame's controls and never reaches the page (`finder.tsx:FinderPaletteWindow`).

### Dashboard

* **Tags sync is not overwritten by an unchanged editor.** Tags are sent only when the person changed them, so tags that sync brought in while the editor was open survive a save (`newtab.tsx:NewTab`).
* **`?q=` prefills once.** The search comes from the "Search in TabLodge" menu and fills both searches on first render, then the address bar is cleaned (`newtab.tsx:NewTab`, `page-params.ts:initialSearchQuery`).
* **Dragover does not re-render.** It fires many times a second, so an unchanged drop marker keeps the page still (`newtab.tsx:NewTab`).
* **Empty session names fall back to the default.** The name from the session naming settings comes back when the field is left empty (`newtab.tsx:NewTab`).
* **The save target sticks for the page's life.** The choice for Add bookmark and pasted links stays until the page closes (`newtab.tsx:NewTab`).
* **Deleting a source column can stop its saves.** A column that site saves feed on this device also asks whether to stop those saves (`newtab.tsx:NewTab`).
* **The dialog announces a grown column inside itself.** A site save can fill the column while the dialog is open, and the dialog says so where a screen reader hears it (`newtab.tsx:NewTab`).
* **Grid rows stretch columns.** Columns in a row share the tallest height, unless the setting turns it off (`newtab.tsx:NewTab`).
* **Only stored order can be moved.** A sort is a view of the stored order, so drag and move act on stored order only (`newtab.tsx:NewTab`).
* **A batch moves in the order shown.** It arrives in the order on screen (`newtab.tsx:NewTab`).
* **A capped column scrolls and loads more.** With the Board limit on, the column scrolls to load the next batch instead of growing the page (`newtab.tsx:NewTab`).
* **Row height is estimated per density.** The estimate sizes the list before rows render (`newtab.tsx:NewTab`).
* **Unchanged columns keep their arrays.** Bookmarks are grouped once per change, so a column whose bookmarks did not change keeps its memoized card list (`newtab.tsx:NewTab`).
* **The All item lists columns in order.** Every column's bookmarks come in column order, with Unfiled last (`newtab.tsx:NewTab`).
* **New tabs can be handed to the browser.** With "Use TabLodge for new tabs" off, the worker decides whether this tab was one, and only then is it sent on to the browser's page (`newtab.tsx:NewTab`).
* **Source notices wait for the dashboard to stay.** A tab handed on would drop the toast unseen (`newtab.tsx:NewTab`).
* **A failed hand-off shows the page.** It never leaves the tab blank (`newtab.tsx:NewTab`).
* **Stray link drops are refused.** Bookmarks are added only by drops on a column or Unfiled; elsewhere the drop is swallowed (ADR 0017, shouldBlockDocumentDrop).
* **One autoscroll watcher per page.** Every drag on the page, bookmarks and sessions alike, shares it (`newtab.tsx:NewTab`).
* **Pasting outside a text field opens Add bookmark.** The title comes from the copied text, then an open tab on that page, then the domain; no page is fetched (`newtab.tsx:NewTab`, `newtab.tsx:pastedLinkTitles`).
* **A bookmark left in Unfiled starts in the preferred column.** Unfiled has no column to show (`newtab.tsx:NewTab`).
* **Empty lists clear tags and removed kinds.** A save with no tags or kinds clears what the bookmark had (`newtab.tsx:NewTab`).
* **Column delete with bookmarks asks where they go.** An empty column is deleted at once; Undo restores the column and its bookmarks (`newtab.tsx:requestDeleteColumn`).
* **A site save can fill an empty column during a dialog.** The dialog asks where those bookmarks go (`newtab.tsx:NewTab`).
* **Focus is rescued after a move.** It waits for the Move dialog to close, then moves focus back to the page if it fell to the body (`newtab.tsx:keepFocusAfterMove`).
* **Focus stays on the page after the bar goes.** The selection bar and its dialog are gone, so focus returns to the page (`newtab.tsx:NewTab`).
* **Deletes are undoable from the trash.** Undo restores the bookmark from the trash (`newtab.tsx:deleteBookmark`).
* **Keyboard alternative to dragging a bookmark.** One step earlier or later in its column (`newtab.tsx:moveBookmarkStep`).
* **Keyboard alternative to dragging a column.** One step left or right (`newtab.tsx:moveColumnStep`).
* **Keyboard alternative to dropping on a session.** Bookmarks can be added to a saved session without a drop (`newtab.tsx:addBookmarkToSession`).
* **Session targets exist only while one exists.** The picker shows a session only when at least one is saved (`newtab.tsx:NewTab`).
* **The pasted-links picker can create a session.** It can pick one even when none is saved (`newtab.tsx:NewTab`).
* **Drag data is read before any await.** The browser clears it after the first await (`newtab.tsx:dropOnColumn`).
* **Nothing drops on All.** All is a view of every column (`newtab.tsx:dropOnColumn`).
* **A sorted column drops at its end.** It shows no slots (`newtab.tsx:dropOnColumn`).
* **Sorted columns keep stored positions.** Bookmarks already there keep their stored position (`newtab.tsx:dropOnColumn`).
* **Large batches get an Undo that closes them.** More than ten tabs at once (`newtab.tsx:NewTab`).
* **Command handlers read the latest settings.** The finder's command list stays stable between renders (`newtab.tsx:NewTab`).
* **This tab is no web page.** Its other tabs offer Keep a copy, so this one does not (`newtab.tsx:NewTab`).
* **Private windows have no Sync now command.** The finder's Sync now is disabled there (`newtab.tsx:NewTab`); private sync is managed in Settings.
* **Private windows keep no snapshots.** Recent snapshots are not offered there (`newtab.tsx:NewTab`).
* **Only a private window has a private library to lock.** (`newtab.tsx:NewTab`).
* **`?command=` runs commands here.** The palette window passes a command that needs this page (`newtab.tsx:NewTab`).
* **Commands wait for the page.** While a new tab is handed to the browser, the dashboard and its listeners are not up (`newtab.tsx:NewTab`).
* **Commands run after the sessions area listens.** After this render, so events a command sends are heard (`newtab.tsx:NewTab`).
* **The palette shortcut toggles the palette here.** The "Open the search palette" shortcut, pressed on this page, toggles it (`newtab.tsx:NewTab`).
* **Focus search on a new tab opens the palette once.** Not for `?q=` links, which prefill the page search. A background tab focuses its input once visible (`newtab.tsx:NewTab`).
* **Stable callbacks let memoized rows skip renders.** One set for every column and bookmark (`newtab.tsx:NewTab`).
* **A stable shell while the handoff is blank.** The handoff stays blank; the shell shows while the initial state read is in flight (`newtab.tsx:NewTab`).
* **The item drags, not the button.** Firefox does not drag buttons (`newtab.tsx:NewTab`).
* **Session targets are read at menu open.** Not while rendering (`newtab.tsx:BoardActions`).
* **Header buttons keep their own taps.** The header's clicks ignore the menu (`newtab.tsx:BookmarkColumn`).
* **The scroll region is focusable.** Keyboard users can scroll it on its own (`newtab.tsx:BookmarkColumn`).
* **One list feeds two menus.** The ⋯ menu and the right-click menu cannot drift apart (`newtab.tsx:BookmarkCard`).
* **A passage link stays outside the card link.** A passage link cannot sit inside another link (`newtab.tsx:BookmarkCard`).

### Settings

* **Firefox has no private storage.** It keeps the add-on out of private windows (`options.tsx:Options`).
* **Reset reads the latest group.** Set to the latest resetGroup on each render (`options.tsx:Options`).
* **Reload waits for pending saves.** A reload that lands while saves are in flight may predate them (`options.tsx:Options`).
* **Focus goes to the section after a removal.** The action removes the control that held focus, and Chrome fires no focusout for a removed element, so the focus rescue never sees it (`options.tsx:Options`).
* **A section link waits for the sections.** It arrives before they exist, so the browser cannot jump; the page scrolls there and moves focus after render (`options.tsx:Options`).
* **The downloads permission is asked from the click.** The browser asks for the optional permission from the user's gesture (`options.tsx:Options`).
* **Dialog state resets on open.** The closing animation never shows an emptied form (`options.tsx:Options`).
* **Appearance is stored apart.** Undo puts it back too (`options.tsx:Options`).
* **Erasing takes a safety backup first.** Undo puts the data back (`options.tsx:Options`).
* **Settings hidden by a rule are left out of search.** A row whose `when` fails does not apply at all, and a row whose parent is off is hidden but still found next to its parent, disabled (`options.tsx:Options`).
* **Search keeps a family together.** A matching row brings its parent switch and dependents, so a setting never shows without the control that gates it (`options.tsx:Options`).
* **Arrow keys select as they move.** As native radio buttons do (`options.tsx:Options`).
* **Reset confirms against current values.** The latest resetGroup reads the settings as they are when the user confirms (`options.tsx:Options`).
* **`when` does not make a row dependent.** It only decides whether the row exists (`options.tsx:Options`).
* **Section hiding waits for commit.** A search can hide the whole section once its last match is gone (`options.tsx:Options`).
* **Shortcuts refresh on return.** They change on another page, so the card reads again when the user comes back (`options.tsx:ShortcutsCard`).
* **The control keeps its place in the tree.** Remounting would close an open popover when a change makes the reset button appear (`options.tsx:SettingRow`).

### Page copies

* **Copies live in the worker.** This module reads and opens them; the worker keeps them (`page-copies.ts:readerUrl`).
* **One storage listener for every row.** Always empty in a private window, which keeps no copies (`page-copies.ts:usePageCopyUrls`).
* **Injected functions are source text.** Each is a plain function declaration, since a method shorthand does not survive `chrome.scripting.executeScript` (`page-copy-inject.ts:takeCapturedCopy`).
* **The note's elements are built in a closed shadow root.** Page styles and scripts cannot reach those elements directly, but the page can still hide the `#tablodge-page-note` host with CSS or remove it with script (`page-copy-inject.ts:showPageNote`).

### Address bar

* **The address bar search is pure.** The worker gathers data and opens the result; this module only ranks (`omnibox.ts:omniboxIndex`).
* **Descriptions are omnibox XML.** The dialect's `<match>` and `<dim>` markup is what the address bar shows (`omnibox.ts:omniboxSuggestions`).
* **Few results per kind.** Bookmarks cannot push sessions off the list (`omnibox.ts:omniboxSuggestions`, `MAX_PER_KIND`).

### Palette overlay

* **The overlay runs in the page.** The worker passes this function to `chrome.scripting.executeScript`, so it is serialised like any injected code (`palette-overlay.ts:togglePaletteOverlay`).
* **Focus stays in the palette.** Anything the page focuses behind it goes back to the frame (`palette-overlay.ts:onFocusIn`).

### Palette window

* **The palette window works on restricted pages.** It is a window of its own, not part of the page, so `window` in the address is the browser window that was in front (`palette.tsx:PalettePage`).
* **Dashboard commands run on the dashboard.** They open it and run there (`palette.tsx:PalettePage`).
* **Private windows keep no page copies.** (`palette.tsx:PalettePage`).
* **A private library syncs from its own Settings.** (`palette.tsx:PalettePage`).
* **Private windows keep no snapshots.** (`palette.tsx:PalettePage`).
* **Only a private window has a private library to lock.** (`palette.tsx:PalettePage`).

### Private lock

* **Passcode forms keep the value in the caller.** Both forms keep the typed password in the caller's state, never in storage (`passcode-fields.tsx:PasscodeSetup`).
* **The first problem wins.** The draft shows problems in a fixed order, and the first one is the one reported (`passcode-fields.tsx:passcodeDraftProblem`).
* **The problem line is always in the page.** A screen reader announces what it later says, so it cannot appear and disappear (`passcode-fields.tsx:PasscodeSetup`).
* **Checks wait for typing.** Quiet until something is typed (`passcode-fields.tsx:PasscodeSetup`).
* **Unlock does not check length.** A short password from an older version still opens (`passcode-fields.tsx:PasscodeEntry`).
* **Lock dialogs cover on, change and remove.** Turn the lock on, change its password, or remove it (`private-lock-dialogs.tsx:SetLockForm`).
* **Without a password the library stays shut.** The form shows in place of a private page until one is set (`private-lock-dialogs.tsx:SetLockForm`).
* **Sync can start with the password.** Private sync turns on with the same password (`private-lock-dialogs.tsx:SetLockForm`).
* **A server password becomes the lock.** The sync server's private library password is this library's lock (`private-lock-dialogs.tsx:JoinServerForm`).
* **The lock is a page-side screen.** It replaces a private page until unlocked; the Lock button and the Settings panel live here too (`private-lock-ui.tsx:PrivateLockGate`).
* **State lives in the worker.** The credential only passes through form state (ADR 0013, `shared/private-lock.ts`).
* **The lock state is kept current.** It reloads when the lock record or key changes, and when the idle time runs out (`private-lock-ui.tsx:usePrivateLockInfo`).
* **Other pages move the idle deadline.** Use elsewhere moves it, which the page can work out without asking (`private-lock-ui.tsx:usePrivateLockInfo`).
* **Asking locks the page.** The worker locks when asked after the deadline (`private-lock-ui.tsx:usePrivateLockInfo`).
* **Reading counts as activity.** Reading without saving does not run into the idle timeout (`private-lock-ui.tsx:useActivityTouch`).
* **The first password matches the server's.** When the sync server already holds a private library, its password is the first choice, so every browser ends up with one (`private-lock-ui.tsx:SetLockScreen`).
* **Regular windows pass straight through.** The children unmount on lock and remount on unlock (`private-lock-ui.tsx:PrivateLockGate`).
* **Focus returns after the lock screen.** The set-a-password screen replaces the page the same way (`private-lock-ui.tsx:PrivateLockGate`).
* **Focus waits for the page.** The lock screen's field is gone, so focus would fall to the body; the page mounts its content after, so focus waits for its main area (`private-lock-ui.tsx:PrivateLockGate`).
* **Popup and side panel have no main area.** After a second, focus takes their first control (`private-lock-ui.tsx:PrivateLockGate`).
* **Lock state is shared with the storage form.** The two always agree (`private-lock-ui.tsx:PrivateLockGate`).
* **Mode changes wait for the lock.** `modeLockedReason` says why the storage mode cannot change right now (`private-lock-ui.tsx:modeLockedReason`).
* **A lock blocks the storage mode.** While a lock protects the library the mode cannot change, and the reason is shown (`private-storage.tsx:PrivateStorage`).

### Popup

* **The column picker loads late.** Its icon registry loads right after the popup paints, before anyone can click Bookmark (`popup.tsx:loadColumnPicker`).
* **Stable fallback.** Memoized values do not see a new array on every render (`popup.tsx:NO_SESSIONS`).
* **Firefox opens its sidebar instead.** Older Chromium builds and some forks lack the side panel API (`popup.tsx:hasSidePanel`).
* **Tabs always have ids here.** `chrome.tabs.query` carries an id for tabs in normal windows (`popup.tsx:WebTab`).
* **Columns are read as the popup opens.** The dialog never waits for the library (`popup.tsx:Popup`).
* **The side panel opens inside the gesture.** `sidePanel.open` must run inside the user gesture, so its window id is read ahead of the click (`popup.tsx:Popup`).
* **Unsavable pages start as unknown-safe.** False on pages that cannot be saved (new tab, browser pages); it stays true until the active tab is read (`popup.tsx:Popup`).
* **A split view is one tab-strip slot.** Its two halves can both be highlighted, but they are one slot, not a selection (`popup.tsx:Popup`).
* **The tab list reloads on two inputs only.** `ShowStatus` is recreated every render, so the list reloads only when its two inputs change (`popup.tsx:Popup`).
* **Quick buttons ask for no title.** The Choose tabs and title dialog already has a title field (`popup.tsx:Popup`).
* **Bookmark falls back to the full library.** When the columns have not loaded, the click opens the full library (`popup.tsx:Popup`).
* **A column that claims the site takes the page.** A click before either read lands asks for the columns itself (`popup.tsx:Popup`).
* **Modifier keys set the restore target.** Ctrl/Cmd keeps the saved tabs, Shift opens a new window, as on the dashboard (`popup.tsx:restoreSession`).
* **Info reuses the Help tab.** It switches to it when it is already open (`popup.tsx:openHelp`).
* **Help opens fresh when switching fails.** When the Help tab cannot be switched to, a new one opens instead; the error is not shown (`popup.tsx:openHelp`).
* **Firefox needs no window id.** It opens the sidebar in the current window (`popup.tsx:Popup`).
* **The popup has a fixed size.** Chrome sizes a popup to its content (max 800x600), and 100vh is circular there, so the header and footer are stable and the body scrolls (`popup.tsx:Popup`).
* **The private banner shortens the frame.** It uses part of the height limit (`popup.tsx:Popup`).
* **The frame holds while the state loads.** (`popup.tsx:Popup`).

### Private library

* **Only a mode or setup change reloads.** The redirect and accent apply live (`private-config.ts:privateConfigNeedsReload`).
* **Snapshots never run in private windows.** Their entry points are hidden there (`private-config.ts:inPrivateWindow`).

### Private sync

* **Private sync is a Settings choice.** Whether the separate private library syncs too (`private-sync-settings.tsx:PrivateSyncSettings`).
* **The server's password is asked too.** A library kept on this device can have its own password, so the server's is asked for as well (`private-sync-settings.tsx:PrivateSyncSettings`).
* **Private status has its own prefix.** The private client keeps its status under the private library's prefix (`private-sync-settings.tsx:PrivateSyncSettings`).
* **A regular window can start private sync.** It opens this page to turn private sync on, and the switch is treated as turned on so a password is asked here (`private-sync-settings.tsx:PrivateSyncSettings`).
* **The start flag leaves the address.** It is removed so a reload does not start it again (`private-sync-settings.tsx:PrivateSyncSettings`).
* **Each dialog is fresh.** Nothing typed before is kept (`private-sync-settings.tsx:PrivateSyncSettings`).
* **The credential dialog is open while asked.** It shows while the worker needs a password to turn private sync on (`private-sync-settings.tsx:CredentialDialog`).
* **A wrong entry returns focus.** Focus goes back to the field for the next try (`private-sync-settings.tsx:CredentialDialog`).
* **Read only, not disabled, while checking.** Focus stays on the field for a wrong entry (`private-sync-settings.tsx:CredentialDialog`).

### Project metadata

* **Name and repository come from the manifest and package.** The repository URL comes from `package.json`, the single source of truth, and the build copies `homepage` into the manifest (`project.ts:PROJECT`, scripts/vite-shared.ts).
* **The name and version come from the manifest.** `shell/manifest.json` supplies `short_name` and `version`, which is also what the browser shows; the service worker reads the same field (`project.ts:PROJECT`).

### Page toast

* **Toasts are injected by the worker.** The worker passes `showQuoteToast` to `chrome.scripting.executeScript`, which serializes it. It must stay self-contained: it cannot reference imports or helpers outside the function, so extracting one would break the injected toast (`quote-toast.ts:showQuoteToast`).
* **Edges and timing are sent as values.** `chrome.scripting` drops null and undefined arguments, so an absent duration means never (`quote-toast.ts:showQuoteToast`).
* **Messages stay until dismissed.** A toast with no timeout has a button that closes it (`quote-toast.ts:showQuoteToast`).
* **Live regions announce late.** Text that changes after it is on the page is announced when it is set a moment later (`quote-toast.ts:showQuoteToast`).

### Reader

* **The reader renders text only.** Blocks are React text nodes, so nothing from the page can run (`reader.tsx:Reader`).
* **A kept copy has stable keys.** It never changes, so its position is a stable key (`reader.tsx:renderBlocks`).
* **One copy per page.** It is named in its own address (`reader.tsx:Reader`).

### Recovery

* **Recovery helpers are light.** Heavy dialogs live in `recovery.tsx` and load only when opened (`recovery.tsx`).
* **The restore toast reports skipped tabs.** With Remove restored tabs on, what was removed goes to the trash and Undo brings it back, failures and skipped tabs included (`recovery-core.ts:reportSessionRestore`).
* **`undo` can replace the trash Undo.** A delete that also changed something the trash does not hold passes its own undo; `trashId` still decides the trash path (`recovery-core.ts:offerTrashUndo`).
* **Closed tabs are closed one by one.** Some were already closed, so the rest are closed one at a time (`recovery-core.ts:offerCloseTabsUndo`).
* **Recovery UI sends messages only.** Every action is a message to the service worker, which keeps the data in local extension storage (`recovery.tsx:SnapshotsDialog`).
* **Badge text is short.** The full explanation shows on hover (`recovery.tsx:REASON_LABELS`).
* **Destructive confirms are per page.** The Settings page asks before deleting a snapshot; other pages use Undo alone (`recovery.tsx:SnapshotsDialog`).
* **Edge lines mark scroll edges.** Dialogs whose list scrolls between a fixed title and fixed buttons (`recovery.tsx:SCROLL_HEADER`).
* **Destructive confirms are per page.** The Settings page asks before deleting or emptying the trash; other pages use Undo alone (`recovery.tsx:TrashDialog`).
* **Deleting keeps the item while fading.** The text does not change on Cancel (`recovery.tsx:TrashDialog`).
* **Only the list scrolls.** The title and buttons stay in view (`recovery.tsx:TrashDialog`).
* **Recovery keys trigger refreshes.** Storage keys that change the usage line or backup list, for regular and private libraries (`recovery.tsx:RECOVERY_KEY`).
* **Backup help sits behind a button.** The dialog shows no standing paragraph about Add versus Restore (`recovery.tsx:BackupsHelpButton`).
* **Escape closes the help only.** It does not close the dialog around it (`recovery.tsx:BackupsHelpButton`).
* **Backups feedback shows inside the modal.** The page toast sits behind it (`recovery.tsx:RecoveryTools`).
* **Undo survives closing.** A still-offered Undo stays as a page toast (`recovery.tsx:RecoveryTools`).
* **A running action is not replaced.** A newer one would replace its notice (`recovery.tsx:RecoveryTools`).
* **Focus moves to Undo after a delete.** A deleted row takes focus with it (`recovery.tsx:RecoveryTools`).
* **Undo waits for the delete.** Undo is disabled until the delete finishes (`recovery.tsx:RecoveryTools`).
* **The confirmation keeps its text.** It stays set while the dialog fades out (`recovery.tsx:RecoveryTools`).
* **Confirmed deletes wait for focus.** They cannot take focus from Undo afterwards (`recovery.tsx:RecoveryTools`).
* **Overlapping reads keep the newest.** An older read must not undo a newer one (`recovery.tsx:RecoveryTools`).
* **Storage is watched, not each action.** The trash and snapshot dialogs change these lists too (`recovery.tsx:RecoveryTools`).
* **Restores merge.** A backup's sessions and bookmarks are added to what is there, as importing its file does, not replaced (`recovery.tsx:RecoveryTools`).
* **Ctrl/Cmd+Z runs the notice's Undo.** Unless a confirmation is on top (`recovery.tsx:RecoveryTools`).
* **The status region adds no gap.** An empty region adds no space above the list (`recovery.tsx:RecoveryTools`).
* **A short window keeps a row in view.** The floor keeps the list visible where the dialog itself scrolls (`recovery.tsx:RecoveryTools`).

### Reorder

* **Keyboard reorder uses menu items.** Move up and Move down are the keyboard path (`reorder.ts:neighborId`).
* **Focus is restored after a move.** A DOM move drops focus to the body, so focus goes back to the moved element, found by selector after the redraw (`reorder.ts:focusAfterMove`).

### Save target

* **"New session" is a fixed value.** It is the session picker's create-new choice, like the new column choice (`save-target.tsx:NEW_SESSION`).
* **No switch without sessions, unless it can create one.** With no saved session, `SaveTargetChoice` renders nothing unless `allowNewSession` is true, so the dialog keeps its plain column field (`save-target.tsx:SaveTargetChoice`).
* **The session choice can create one.** With `allowNewSession` set, it is offered even with no saved session (`save-target.tsx:SaveTargetChoice`).

### Saved URLs

* **"Already saved" is exact.** Matching is exact, the same rule saving uses to detect duplicates (`saved-urls.ts:savedUrlSet`).

### Search tips

* **Escape closes the tips only.** It does not close the palette around them (`search-tips.tsx:SearchTips`).
* **The tips list scrolls.** Operators and keys can be taller than a short palette window (`search-tips.tsx:SearchTips`).

### Session folders

* **Folder list layout is a rule.** When folders no longer fit as a row of chips, the Sessions page lists them vertically; the rule lives here so tests run without a browser (`session-folder-list-rule.ts:isFolderListShown`).
* **Auto turns the list on past a minimum.** `folderCount` counts folders in the selector, not All (`session-folder-list-rule.ts:isFolderListShown`).
* **The list is suggested near its size.** When there are nearly as many folders as the list would take over the chips (`session-folder-list-rule.ts:suggestsFolderList`).

### Session naming

* **Naming helpers are pure.** The empty-means-default rule and the prompt window's handling of several sessions live here, apart from React (`session-name.ts:typedSessionName`).
* **An empty name is left to the worker.** `undefined` when left empty, so the worker uses the setting's fallback name (`session-name.ts:typedSessionName`).
* **Several sessions are numbered.** A single session keeps its name; several become "Name (1/3)", "Name (2/3)" in save order (`session-name.ts:numberedSessionNames`).
* **The numbering is stripped for the base.** (`session-name.ts:baseSessionName`).
* **The prompt window takes the session ids from its address.** (`session-name.ts:promptGroupIds`).

### Settings sections

* **The finder's section list is checked.** The a11y check fails when a rendered section is missing or an entry points at none, so a new section must be added here (`settings-sections.ts:settingsSections`, scripts/a11y/settings.ts).
* **The file imports nothing.** The a11y check imports it in Node, so it imports no browser APIs (`settings-sections.ts:settingsSections`).
* **Firefox has no private library section.** It keeps the add-on out of private windows (`settings-sections.ts:settingsSections`).
* **Anchors come from the target.** The Settings page scrolls to `target ?? id` (`settings-sections.ts:settingsSections`).

### Shared pages

* **Shared pages are asked on open.** The server answer is asked each time the dialog opens, and is always `none` in a private window, which has no library on the server (`shared-pages.tsx:useSharedPages`).
* **Delete asks first.** The server cannot bring a shared page back (`shared-pages.tsx:SharedPagesList`).

### Side panel

* **The panel never navigates.** "This tab" means the active tab of the panel's window, not the page navigation `openLink` does (`sidepanel.tsx:openSavedLink`).
* **Reading the tab needs a grant.** Opening the panel grants nothing; access comes from the toolbar button, the right-click menu, or a shortcut used on that tab (`sidepanel.tsx:useReadableTab`).
* **One row, two ways to open its menu.** The same actions open on the ⋯ button and on right-click (`sidepanel.tsx:ActionRow`).
* **The row passes its menu opener.** A function child receives `openMenu` (`sidepanel.tsx:ActionRow`).
* **Large libraries load on demand.** A library can hold thousands of rows, so the first 30 per section are drawn and the rest load later (`sidepanel.tsx:ROW_PAGE`).
* **Rows draw by limit.** The first `limit` rows draw (`sidepanel.tsx:ROW_PAGE`).
* **Modified clicks keep browser behavior.** New tab or new window (`sidepanel.tsx:openSavedLink`).
* **Only the open tab can be read.** And only while TabLodge may read it (`sidepanel.tsx:useReadableTab`).

### Site sources

* **One prompt asks for every site.** The sites' permissions are requested together, before any await so the prompt comes from the click (`site-source-access.ts:turnOnSiteSources`).
* **Removing gives the permission back.** The site is switched off in every browser and this browser's site permission is returned (`site-source-access.ts:removeSiteSource`).
* **Other browsers' sites are pointed to once.** When sites are on in another browser but not here, the dashboard says so once, with one Turn on (`site-source-pointer.ts:useSourcesElsewherePointer`).
* **The latest show function is used.** It is recreated every render (`site-source-pointer.ts:useSourcesElsewherePointer`).
* **Choices can arrive while open.** From another browser, while the dashboard is open (`site-source-pointer.ts:useSourcesElsewherePointer`).
* **The own column has a non-empty value.** Radix Select needs a non-empty value (`site-sources-settings.tsx:SITE_COLUMN`).
* **A site stays listed while it is on or was taken away.** So the notice can say so (`site-sources-settings.tsx:isListed`).
* **What Save to TabLodge does and does not do.** It sits behind a help button so the row shows no standing tip (`site-sources-settings.tsx:KeepOffHelpButton`).
* **The worker writes the notices.** It says when the browser revokes access or a page cannot be read (`site-sources-settings.tsx:useSiteSources`).
* **The request comes from the click.** Before any await, so the permission prompt is not blocked (`site-sources-settings.tsx:useSiteSources`).
* **The Add a site button takes focus.** The removed row held focus and the button is the nearest control that stays (`site-sources-settings.tsx:useSiteSources`).
* **Add a site is a searchable popover.** Arrow keys move through the list, Enter adds the highlighted site (`site-sources-settings.tsx:AddSiteSource`).
* **The highlighted site stays in view.** (`site-sources-settings.tsx:AddSiteSource`).
* **The row says two things at a glance.** Whether the site is on, and whether this browser has its access (`site-sources-settings.tsx:siteState`).
* **One site's options are shown inline or in its dialog.** (`site-sources-settings.tsx:SiteOptions`).
* **Saves go to the site's source column.** With no choice, or a chosen column that was deleted, the column is made on the first save (`site-sources-settings.tsx:SiteOptions`).
* **The site stays set while the dialog fades.** Its text does not change on Cancel (`site-sources-settings.tsx:useSiteSources`).
* **One row is open at a time.** The list stays short however many sites are added (`site-sources-settings.tsx:useSiteSources`).

### Private lock settings

* **Regular windows only point to the lock.** The lock settings panel in a regular window shows the status and sends the user to a private window, because the key lives with the private worker (`private-lock-dialogs.tsx:JoinServerForm`).

### Site sources

* **Each site is a save hook.** The user saves a link on the site and it lands in that site's bookmark column. Each site is off until added in Settings, which asks for one optional host permission for that site only; its content script runs only while that permission is granted (`site-sources.ts:SITES`).
* **A new site is three edits.** Add it to `SITES` here, add its adapter in `shell/site-source.ts`, and add its origins to `optional_host_permissions` in `shell/manifest.json`. Settings then lists it in Add a site by itself (`site-sources.ts:SITES`).
* **The manifest matches this list.** `optional_host_permissions` must list exactly the origins here, and `tests/site-sources.test.ts` checks it (`site-sources.ts:SITES`).
* **Some items link to a discussion page.** It is kept in the bookmark's note as `<name>: <address>` (`site-sources.ts:SiteSource`).
* **A save that loads another page is kept for the next page.** Hacker News' favorite link loads a page, so the result is shown there (`site-sources.ts:SiteSource`).
* **Save to TabLodge only is offered where the adapter can tell a save early.** The content script stops the site's own click for that site only (`site-sources.ts:SiteSource`; the listener is in source-keep-off.ts).
* **Playlist, index and time parameters are dropped.** So the same video saved from anywhere matches (`site-sources.ts:youtubeVideoUrl`).
* **Old and new Reddit match.** `old.reddit.com` and `www.reddit.com` saves give the same address (`site-sources.ts:redditPermalinkUrl`).
* **Reels and posts share one address.** Instagram opens a reel at either address, and the saved page lists reels at `/p/` (`site-sources.ts:instagramPostUrl`).
* **Medium posts match across hosts.** Medium redirects `/p/<id>` to the post wherever it is published, so a publication's own domain gives the same address (`site-sources.ts:mediumPostUrl`).
* **Site choices are stored outside the library.** The permission and the registered script belong to the browser, not to a library; the choices sync (`site-sources.ts:SITE_SOURCES_KEY`).
* **The dashboard remembers a site is on elsewhere.** It was shown once (`site-sources.ts:SiteSourcesState`).
* **Keys are computed.** An id such as `__proto__` stays an ordinary key (`site-sources.ts:putChoice`).
* **Synced choices from other devices only apply if unchanged.** A site whose stored value no longer equals what the sync round read is left alone (`site-sources.ts:applySyncedChoices`).
* **Built with fromEntries.** So `__proto__` stays an ordinary key (`site-sources.ts:parseSiteSourcesState`).
* **Old stored choices are kept.** A site that was on, or went off when its access was revoked, keeps them (`site-sources.ts:parseSiteSourcesState`).
* **Only these Undo steps are allowed.** Labels of the Undo steps that source saves create; the page may undo only those (`site-sources.ts:siteSourceUndoLabel`).
* **A column delete can stop its source saves.** The site saving into a column, here or in another synced browser, is asked about (`site-sources.ts:sourceSavingInto`).

### Bluesky

* **Bluesky saves are read from its markup.** The bookmark button in the post's action row, or the item in its "..." menu. The save state is in the label only, and only the English label counts (`source-bluesky.ts:createBlueskyReader`).
* **A menu is matched to the post clicked last.** It opens away from the post (`source-reader.ts:rememberLast`).
* **A reply's own link is the first in the header.** A reply in a thread links to itself before its text; a later link to another post is not the item (`source-bluesky.ts:postUrl`).
* **Document order decides.** Links before the post's text come first, and the text ends the header (`source-bluesky.ts:postIn`).

### Catch-up

* **Catch-up reads the saved page and only reads.** It asks the worker how many items TabLodge lacks, and a toast reports it. It clicks nothing and sends no request beyond that; one page load shows at most one message (`source-catch-up-page.ts:watchSavedPage`).
* **Sites load saved pages in place.** So the page is watched, not read once (`source-catch-up-page.ts:watchSavedPage`).
* **The page is read at most once a second.** Reddit's pages change all the time (`source-catch-up-page.ts:READ_EVERY_MS`).
* **A count the worker could not answer is retried.** An update can restart the worker; retries are three in a row (`source-catch-up-page.ts:RETRIES`).
* **Addresses asked about are remembered.** The toast's own insertion and unrelated page changes do not ask again (`source-catch-up-page.ts:watchSavedPage`).
* **Only the newest answer shows.** Answers can come back out of order (`source-catch-up-page.ts:watchSavedPage`).
* **Leaving the saved page drops an answer on its way.** Sites like YouTube and X change pages in place; coming back asks again (`source-catch-up-page.ts:watchSavedPage`).
* **Settings changes re-count.** A site removed and added again forgets its Not now answers, so the page is counted again (`source-catch-up-page.ts:watchSavedPage`).
* **Catch-up follows click-save rules.** Reading the saved page and adding the missing items use the same rules as a click-save, so an address in the library or the trash never counts as missing (`source-catch-up.ts:missingSourceLinks`).
* **The per-page limit is high on purpose.** Old Reddit lists 25 to 100 per page, and new Reddit keeps adding while scrolling (`source-catch-up.ts:CATCH_UP_MAX_LINKS`).
* **Not now is per device.** The dismissed addresses stay outside the library and never sync, so the toast returns only for an address the user did not answer (`source-catch-up.ts:SOURCE_CATCH_UP_KEY`).
* **Not now keeps the longest page.** The dismissed list is at least a whole page (`source-catch-up.ts:DISMISSED_MAX`).

### Dev.to

* **Dev.to saves come from two controls.** The article's reading list button in the reactions bar, or a feed card's Save button. Both are found by markup, so every interface language works (`source-devto.ts:createDevtoReader`).
* **Saved state is read from attributes.** `aria-pressed` or the `selected` class; a click on a saved article un-saves, which saves nothing (`source-devto.ts:createDevtoReader`).
* **The article is the card's title link.** On the article's own page it is the page's address (`source-devto.ts:createDevtoReader`).
* **The canonical link can name another site.** The article was first published there (`source-devto.ts:createDevtoReader`).

### GitHub

* **GitHub stars come from two markups.** A Star button in a form posting to `/<owner>/<repo>/star` (the Unstar form posts to `/unstar`), or a React-drawn repository page with one `star-button` reading Star or Starred (`source-github.ts:createGithubReader`).
* **The form names the repository in every language.** (`source-github.ts:STAR_FORM`).
* **The title is the repository.** `<owner>/<repo>`, with the description from the About box or the list row (`source-github.ts:description`).
* **Only the user's own stars are saves.** Stars pages are read for catch-up; another person's public stars are not the user's saves, so a page whose user is not the signed-in login reads as nothing (`source-github.ts:starsOwner`).
* **A Star button is found by label too.** For a page that no longer wraps it in the form (`source-github.ts:STAR_LABEL`).
* **A Star button outside its form.** On a repository's own page the page is the repository; anywhere else it cannot be told (`source-github.ts:starWithoutForm`).
* **An unstarred row stays listed.** It shows with its star control turned off (`source-github.ts:readGithubSavedPage`).
* **An Unstar or a topic star saves nothing.** Only a repository star counts (`source-github.ts:readGithubSavedPage`).

### Goodreads

* **Want to Read saves come from two controls.** The book page's Want to Read button, or the form on older list pages posting to `/shelf/add_to_shelf` with `name=to-read` (`source-goodreads.ts:createGoodreadsReader`).
* **A Button--wtr click is always an add.** Once on a shelf the button edits the shelf instead, so the class is only on add (`source-goodreads.ts:PAGE_SAVE`).
* **The shelf arrow saves nothing.** It only opens the shelf list (`source-goodreads.ts:CHOOSE_SHELF`).
* **The book is the page or the row's title.** On a book's page the page is the book; in a list it is the title link (`source-goodreads.ts:createGoodreadsReader`).

### Hacker News

* **Favorites come from the story's subtext row.** The `fave?id=` link; once favorited it reads un-favorite and carries `un=t` (`source-hackernews.ts:FAVE`).
* **A favorite on a comment saves nothing.** Only story rows count (`source-hackernews.ts:createHackerNewsReader`).

### IMDb

* **Watchlist saves come from the poster ribbon or the title page button.** `aria-pressed="true"` means on the list, and a click then removes it, which saves nothing; the attribute is the same in every language (`source-imdb.ts:createImdbReader`).
* **A ribbon outside a card is the page's title.** (`source-imdb.ts:createImdbReader`).

### Instagram

* **Instagram saves are found by the English Save label.** The icon button reads Remove once saved. A feed post is an article whose timestamp links to it; a post or reel on its own page is at the page's address (`source-instagram.ts:createInstagramReader`).
* **The saved page is read for catch-up.** Only its owner can open it; it lists saved posts and reels, each with its caption as the image's alt (`source-instagram.ts:readInstagramSavedPage`).
* **The caption is the longest non-link line.** The author's name is a link, so it is skipped (`source-instagram.ts:caption`).
* **The grid marks reels.** A reel links at `/p/` and carries a Clip icon (`source-instagram.ts:readInstagramSavedPage`).
* **A post page holds one post.** The post at the page's address, not a feed of them (`source-instagram.ts:createInstagramReader`).

### Save to TabLodge only

* **A save can be kept from the site (#296).** When the user chose it for the site, a click the adapter reads as a save is stopped before the site's own handlers see it, and the link goes to TabLodge alone (`source-keep-off.ts:listenForSaves`).
* **Every doubt lets the click through.** A broken adapter costs a normal site save, never a lost one (`source-keep-off.ts:listenForSaves`).
* **Unreadable clicks, unloaded choices and Shift all reach the site.** (`source-keep-off.ts:listenForSaves`).
* **A kept save can be replayed.** `replay` clicks the control again, and the listener lets that click through (`source-keep-off.ts:KeptSave`).
* **Replays use the clickable element.** An icon inside a button has no click method, and the browser marks a script's click untrusted, so the replay goes to the nearest one (`source-keep-off.ts:replayClick`).
* **Listening is in the capture phase.** The adapter reads a control before the site changes it, so a save can be stopped before the site acts (`source-keep-off.ts:listenForSaves`).
* **A failed save is replayed.** When the save failed or the source is off here, the click is replayed so the site saves it after all (`source-keep-off.ts:settleKeptSave`). If the control is no longer connected, `replayClick` cannot click it, so the user must save the item again (`source-keep-off.ts:replayClick`).

### Letterboxd

* **Watchlist saves come from the film page or a poster's menu.** Removing reads "This film is in your watchlist" or "Remove from watchlist" and saves nothing. Letterboxd is English only (`source-letterboxd.ts:createLetterboxdReader`).
* **A poster's menu is matched to the last poster clicked.** The menu opens away from the poster, which names its film in `data-item-link` (`source-letterboxd.ts:createLetterboxdReader`).

### Lobsters

* **Lobsters saves come from the save form.** The submit input in `form.saver` inside the story; its value turns to "unsave" once saved. The site sends the form with a script, so the page stays (`source-lobsters.ts:createLobstersReader`).
* **A text post's link is its own page.** The title link can point to the story's page instead of the article (`source-lobsters.ts:createLobstersReader`).
* **A story page holds merged stories.** Each has its own details block and its own save (`source-lobsters.ts:createLobstersReader`).

### Medium

* **Medium saves are reading list clicks.** The bookmark button on a story, on its page or on a card. Every click counts as a save, since it never removes one; the label is fixed English (`source-medium.ts:createMediumReader`).
* **A click on a saved story is a duplicate.** The worker skips it (`source-medium.ts:createMediumReader`).
* **The label is on the icon.** A click on the button around it is found by the icon inside (`source-medium.ts:SAVE_ICON`).
* **The story page has its own bookmark.** It is told apart by its test id, since the story is in an article too (`source-medium.ts:PAGE_SAVE`).
* **The canonical link can name a publication's domain.** The address rule does not take it, so the canonical link is checked (`source-medium.ts:createMediumReader`).

### Source readers

* **Adapters only read the DOM.** Each looks at a click before the site handles it, and says whether it was a save and which link (`source-reader.ts:SourceRead`).
* **Unreadable is not a failure.** The user saved something but the page did not give what the adapter needs, so nothing is saved (`source-reader.ts:SourceRead`).
* **A menu's click is only matched for a minute.** An older click is too unsure to say which item the menu belongs to (`source-reader.ts:CONTEXT_TTL_MS`).
* **Shadow roots are searched.** The click path includes elements inside open shadow roots (`source-reader.ts:eventElements`).

### Reddit

* **Reddit saves come from two interfaces.** New Reddit's Save in a post's or comment's overflow menu (found by the English label); old Reddit's "save" link, which turns to "unsave" once saved (`source-reddit.ts:createRedditReader`).
* **The saved page is read for catch-up.** New Reddit's loaded cards and old Reddit's rows, posts and comments (`source-reddit.ts:readRedditSavedPage`).
* **New Reddit's saved comments are not read.** Their card was not available on a real page to check that it gives the address a click-save stores (`source-reddit.ts:readRedditSavedPage`).
* **New Reddit's Save sits in two places.** An item's overflow menu or action row, or a menu opened from one (`source-reddit.ts:NEW_MENU`).
* **A menu Reddit draws outside the item is matched to the last item.** (`source-reddit.ts:createRedditReader`).

### SoundCloud

* **Likes come from the Like button.** A liked item carries `.sc-button-selected`, and a click on it unlikes, which saves nothing; both are classes, so every interface language works (`source-soundcloud.ts:createSoundcloudReader`).
* **The item is the row's or player bar's title link.** On a track's or playlist's own page it is the page (`source-soundcloud.ts:createSoundcloudReader`).
* **The page header is the page's own title.** List rows above it have titles of their own (`source-soundcloud.ts:PAGE_TITLE`).

### Spotify

* **Spotify saves come from Your Library's save button.** `aria-checked="true"` means saved; a click then removes it or opens a playlist picker, which saves nothing. The label is the same in every language (`source-spotify.ts:cardItem`).
* **The item comes from the nearest place that names one.** A track row's song link, the now-playing song, or the one item a small card links to; else the page (`source-spotify.ts:cardItem`).
* **A card is named by one link.** The closest ancestor linking to exactly one item; one that links to several is a list or the page itself (`source-spotify.ts:cardItem`).
* **The title can sit further out.** Its title may be outside the artwork link, so the search goes on for it (`source-spotify.ts:cardItem`).
* **The row names the song.** The page may be another album or playlist, so the row's own container is checked first (`source-spotify.ts:createSpotifyReader`).

### Stack Overflow

* **Stack Overflow saves come from the bookmark button.** Found by `.js-saves-btn` (`.js-bookmark-btn` on older pages), carrying the post's id and type; `aria-pressed="true"` once saved. A save on an answer (post type 2) is not a question and saves nothing (`source-stackoverflow.ts:createStackOverflowReader`).
* **The title comes from the page heading.** The heading link carries the same id, so it gives the question's address and title (`source-stackoverflow.ts:HEADING_LINK`).

### Substack

* **Substack saves are the Save button.** It reads `aria-pressed="true"` (and "Unsave") once saved; a click then un-saves. It is found by its English label, so another language saves nothing (`source-substack.ts:createSubstackReader`).
* **The post is the card's link in a feed.** Elsewhere it is the page, when the page is a post (`source-substack.ts:card`).
* **The card search stops early.** A card is small, so the nearest few ancestors are checked and no further (`source-substack.ts:card`).
* **Relative links keep the publication's host.** The links are read against the page; a link that reads as this page's own comment anchor is about the page, not the card (`source-substack.ts:createSubstackReader`).

### X

* **X bookmarks come from two controls.** The post's action-row Bookmark button (`data-testid="bookmark"`, `removeBookmark` once bookmarked) or the Share menu's Bookmark item, which X draws outside the post (`source-x.ts:createTwitterReader`).
* **Buttons are found by test id; the menu item by English label.** The test id is the same in every language (`source-x.ts:BOOKMARK`).
* **The bookmarks page is read for catch-up.** X sends `/i/bookmarks` to `/i/history`, its Bookmarks tab; Likes is `/i/history/likes` (`source-x.ts:readTwitterSavedPage`).
* **Only posts on screen are read.** X keeps only the posts near the screen in the page (`source-x.ts:readTwitterSavedPage`).
* **A media view's actions sit outside the post.** A photo or video opened from a post shows them at the post's own address (`source-x.ts:MEDIA_VIEW`).
* **Quoted posts are not part of the post's text.** A quoted post sits in a link card inside the post (`source-x.ts:postText`).
* **The post's own timestamp comes first.** It precedes the timestamp of a post it quotes (`source-x.ts:postLink`).
* **A quoted post is not a bookmark.** It belongs to the post that quotes it (`source-x.ts:readTwitterSavedPage`).
* **The last clicked post is the menu's post.** The Share menu is drawn outside the post (`source-x.ts:createTwitterReader`).

### YouTube

* **Watch later comes from four controls.** A thumbnail's button (label turns "Added"), the clock in the hover player, the "Save to Watch later" menu item, and the checkbox in the Save dialog. All are found by English label, so another language saves nothing (`source-youtube.ts:createYoutubeReader`).
* **The Watch later playlist is read for catch-up.** Only its owner can open it (`source-youtube.ts:readYoutubeSavedPage`).
* **The hover player is outside the card.** Its clock is in no card, so the card is found by the video address (`source-youtube.ts:previewedCard`).
* **The player area acts on the video being watched.** Its menu and Save button (`source-youtube.ts:watchedVideo`).
* **The option name is in its title.** Its aria-label includes the privacy line, so the name is read from the title (`source-youtube.ts:OPTION_NAME`).
* **Hidden pages are not read.** YouTube keeps the pages it navigated away from; only the shown playlist page counts (`source-youtube.ts:WATCH_LATER_ROW`).
* **The preview is matched by video.** The hover preview has no title; its link carries the length too (`source-youtube.ts:previewedCard`).
* **An unreadable tick is not a save.** Undefined when the state cannot be read (`source-youtube.ts:optionTicks`).
* **The last clicked video is the menu's video.** Set by the click that opened the menu (`source-youtube.ts:createYoutubeReader`).

### Window state

* **Window globals are declared in an interface.** TypeScript augments the `Window` global only through an interface, so the declaration uses one (`state-preload.ts:StateRequest`).

### Sync indicator

* **Quick syncs stay visible.** A sync that finishes faster than 900 ms would flash by unseen, so the button keeps the syncing look that long (`sync-indicator.tsx:MIN_SYNCING_MS`).
* **An error message brings its own full stop.** The label does not add a second one (`sync-indicator.tsx:describe`).

### Sync now

* **Sync now reports failures.** The worker answers ok even when no server is set up or the round failed, so the outcome reads the result itself (`sync-now.ts:syncNowOutcome`).

### Sync settings

* **Sync is on until the setting says otherwise.** A missing stored value means on (`sync-settings.tsx:SyncSettings`).
* **The private library is offered once.** After connecting, the user is asked whether the separate private library syncs too (`sync-settings.tsx:PrivateSyncPrompt`).
* **Focus moves after an action.** Once the action ends and its view is on screen (`sync-settings.tsx:SyncSettings`).
* **Disabled buttons drop focus.** The action goes to `focus.done`, or `focus.failed` when it failed (`sync-settings.tsx:run`).
* **Errors clear as soon as they are fixed.** A field with an error is checked again while typed (`sync-settings.tsx:recheck`).
* **Empty fields wait for Connect.** A filled field is checked on leaving; an empty one is flagged only on Connect (`sync-settings.tsx:leave`).
* **Syncing covers worker syncs.** A sync the worker started alone counts as well as one started here (`sync-settings.tsx:SyncSettings`).
* **Private sync is offered in a private window only.** It can only be turned on there, which reads the library (`sync-settings.tsx:PrivateSyncPrompt`).
* **Server setup is a guided dialog.** For someone without a server: the steps to make a token, deploy to Cloudflare, and come back with the address (`sync-settings.tsx:ServerSetupDialog`).
* **Sync now stays focusable.** It is aria-disabled, not disabled, while a sync runs, so focus is not dropped (`sync-settings.tsx:SyncNowButton`).

### Tab statistics

* **Statistics only read.** The dialog reads data and changes or sends nothing (`tab-stats-dialog.tsx:TabStatsDialog`).
* **Only existing data and the tabs permission.** Everything is derived from data TabLodge holds or from `chrome.tabs.query`, so no new permission is needed (`tab-stats.ts:savedStats`).
* **Memory is a guess.** Chrome gives extensions no per-tab memory without the `processes` API, so the dialog shows a figure built from the constants (`tab-stats.ts:LOADED_TAB_MB`).
* **A discarded tab keeps little.** Its title and icon only (`tab-stats.ts:DISCARDED_TAB_MB`).
* **The current tab and no-time tabs are left out.** Tabs with no access time, and the tab being looked at, are not in the least-used list (`tab-stats.ts:leastRecentlyUsedTabs`).

### Target picker

* **The first choosable row is active.** Until arrows or the pointer pick a row (`target-picker-dialog.tsx:TargetPickerDialog`).
* **The current target is skipped.** Arrow movement passes over it (`target-picker-dialog.tsx:step`).

### Source toasts

* **Notices stack in a closed shadow root.** The newest sits nearest the corner, at most `MAX_TOASTS` show (a fourth closes the oldest), and each has its own timer and Undo (`source-toast.ts:showSourceToast`).
* **An answer replaces its notice.** A notice that answers another is that notice's next text, so it replaces it in place (`source-toast.ts:showSourceToast`).
* **Styles go on the element, not in CSS.** The page's stylesheets do not select the toast's contents, because they sit in a closed shadow root. The page's Content Security Policy and Trusted Types rules still apply to the page. Every style is set through the element style object, not a style-attribute string that `style-src` would restrict, as `palette-overlay.ts` does (`source-toast.ts:showSourceToast`).
* **The toast never takes focus.** Tab reaches its buttons at the end of the page. It stays while the pointer or focus is on it, and Escape closes it from there (`source-toast.ts:showSourceToast`).
* **Closing with focus returns it.** It goes back to where it came from, never to the page body (`source-toast.ts:showSourceToast`).
* **Buttons become the next step.** Once one runs, the others go and the button becomes Close or the next step's button (`source-toast.ts:run`).
* **The toast looks like TabLodge's own.** It matches the status region of the extension pages (`source-toast.ts:TOAST_TOKENS`).
* **Tokens are copied.** A shadow root on another site cannot read the stylesheet's tokens, so the values are copied into `TOAST_TOKENS` (`source-toast.ts:TOAST_TOKENS`).
* **Messages stay follows the setting.** "Longer" doubles these times, and "Until dismissed" never closes a notice by itself (`source-toast.ts:showSourceToast`).
* **A question stays longer.** So there is time to read it and decide (`source-toast.ts:ASKING_VISIBLE_MS`).
* **The token values match the stylesheet.** `tests/site-sources.test.ts` keeps them equal; `primary` is the default indigo accent (`source-toast.ts:TOAST_TOKENS`).
* **Pixels, not rem.** Rem would follow the site's root font size, not the extension's 16px (`source-toast.ts:TOAST_TOKENS`).
* **Appearance matches the extension pages.** Anything unexpected in storage counts as the default, as on those pages (`source-toast.ts:toastAppearance`).
* **Private windows use the private default.** With no private accent stored, a private window shows the private default, as its pages do (`source-toast.ts:toastAppearance`).
* **The accent is adjusted for the toast background.** It is darkened or lightened until it reads, as `applyAccent` does (`source-toast.ts:toastColors`).
* **A stale script uses the defaults.** A script left behind by an extension update or removal can no longer read storage (`source-toast.ts:readPrefs`).
* **The page cannot read settings.** The worker's answer gives the place and times; without one, the defaults apply (`source-toast.ts:readPrefs`).
* **Placement reverses the list.** The newest notice sits nearest the edge, so a stack at the top lists them in reverse (`source-toast.ts:place`).
* **Notices render in the order asked.** Each reads the theme asynchronously, so a queue keeps the order (`source-toast.ts:showSourceToast`).
* **A leftover host is removed.** One left by an earlier copy of the script, after an update, is not in the stack (`source-toast.ts:showSourceToast`).
* **A notice press is not a page press.** The site's bubbling listeners, such as one that closes a menu on an outside press, do not act on it (`source-toast.ts:showSourceToast`).
* **Newest last in the flex row.** It sits nearest the edge, and `place` sets the direction (`source-toast.ts:place`).
* **Asking notices stay longer.** `error` marks a failed save in the destructive color; `asking` marks a question, which stays longer (`source-toast.ts:showSourceToast`).
* **A removed host is replaced.** When the page removed it, or a later copy of the script did, a new one starts (`source-toast.ts:showSourceToast`).
* **Until dismissed still has a button.** A notice with no button of its own gets one, since a button that answers with nothing closes it (`source-toast.ts:showSourceToast`).
* **The region exists before its text.** Screen readers announce the text when it arrives (`source-toast.ts:showSourceToast`).
* **One line, so no label wraps.** A label wider than the row runs over the text, such as "Also save on Stack Overflow" (`source-toast.ts:showSourceToast`).
* **The ring shows for keyboard focus only.** As on the extension's pages (`source-toast.ts:showSourceToast`).
* **The focus ring is an outline.** Not a shadow, so forced-colors mode still shows it (`source-toast.ts:showSourceToast`).
* **A closed notice stays closed.** Its Undo can finish later, and it must not arm a timer again (`source-toast.ts:showSourceToast`).
* **Only page focus counts.** Moving between the notice's own buttons keeps the page target (`source-toast.ts:showSourceToast`).
* **Focus stays on the notice.** After an action the button that remains keeps focus instead of falling to the page body (`source-toast.ts:run`).
