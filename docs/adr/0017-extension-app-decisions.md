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
