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
