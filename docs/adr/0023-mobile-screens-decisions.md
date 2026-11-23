# 23. Android screen decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/src/screens` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the file that carries it. Each screen's behaviour for a person is in [Android app](../android.md). The area's other decisions are in [ADR 20](0020-mobile-decisions.md) (shell and platform), [ADR 21](0021-mobile-ui-decisions.md) (interface), [ADR 22](0022-mobile-library-decisions.md) (library) and [ADR 18](0018-mobile-private-decisions.md), [ADR 19](0019-mobile-settings-decisions.md) (private library and settings). Symbol references name the component or function that holds the decision.

## Decisions

### Bookmarks

* **The All column is first and is the default, unless it is turned off.** `src/screens/bookmarks/bookmarks.tsx`. A column that no longer exists falls back to All, or to the first column when All is off.
* **A search result that points at a column opens that column.** `bookmarks.tsx`, the pending jump. A search on Sessions can point here.
* **Only a new jump or search request matters.** `bookmarks.tsx`. The effect reacts to the jump or the request, not to each render's new search object. Its lint directive states this reason.
* **The Search tile in Quick Settings opens the search even out of a selection or reordering.** `bookmarks.tsx`, the search request.
* **The list view starts on the list of columns.** `bookmarks.tsx:atList`. A search shows its results instead.
* **The Unfiled bucket is not a column of its own and cannot be changed.** `bookmarks.tsx:isEditableColumn`.
* **Holding a row offers what the swipes and the menu offer, for that one bookmark.** `bookmarks.tsx:rowActions`.
* **The three-dot menu offers only what the screen can act on.** `bookmarks.tsx:menuActions`. An empty column has nothing to open, select, or order.
* **A row redraws only when its own bookmark or selection changes.** `bookmarks.tsx:toggleRow`, which is stable across renders.
* **Long columns draw only what is on screen, and a little around it.** `bookmarks.tsx`, the list.
* **A column made from the screen is shown, so the new link or move lands where the person can see it.** `bookmarks.tsx`, the column that was just made.
* **Three fingers dragged over rows select them.** `src/screens/bookmarks/use-drag-select.tsx`. The rows run from the one the drag started on, and what was already selected stays selected. The list scrolls itself when the fingers are near its top or bottom edge. The responder reads everything through refs, so it is made once.
* **Near an edge the list moves under the fingers, so a drag reaches rows that are off screen.** `use-drag-select.tsx:to`.
* **Each row's place is kept by its place in the data.** `use-drag-select.tsx:layoutsRef`.
* **The bar shown while selecting has the actions of the selection, and Move opens a column choice.** `bookmark-parts.tsx`, the selection bar and its move drawer.
* **Reordering works with buttons, not only drag.** `src/screens/bookmarks/reorder-row.tsx`. A long column can be ordered with a screen reader or a switch.
* **A column is deleted at once, with Undo.** `src/screens/bookmarks/column-sheet.tsx:remove`. Its bookmarks move to another column; with none, they stay unfiled.
* **A name problem is reported only once something has been typed.** `column-sheet.tsx:nameProblem`. An empty new form does not start in error. A typed site that cannot be added says why under the field (`siteCheck`).
* **A column filled by Sources says where it came from, and the phone does not fill it.** `src/screens/bookmarks/columns-sheet.tsx`. The browser fills it, and the phone only shows the site.
* **Tags are the extension's rules.** `src/screens/bookmarks/tags.tsx`. The rules are in `apps/extension/src/shared/bookmark-tags.ts`.
* **Tapping a tag adds `tag:` to the search, or takes it out, so the field says what is filtered.** `tags.tsx`.
* **A row's tags are hidden from TalkBack.** `tags.tsx`. The row's accessibility label reads them.
* **Removing the automatic kind keeps it removed for this link, and a typed tag of the same name goes too.** `tags.tsx:setKindHidden`. Otherwise the chip returns at once.
* **Typed tags are added with the enter key or a comma.** `tags.tsx`, the Tags field.

### Save

* **A new link goes to a session or a column, as in the extension's Add bookmark dialog.** `src/screens/save/save-link.tsx:SaveLinkForm`. A new session is the first choice in the selector.
* **A link being edited stays in the library it is in.** `save-link.tsx`, the library on screen.
* **A title the person has typed is never replaced by the page's own.** `save-link.tsx`.
* **Only a change made in the sheet is saved, so tags that sync brought in while it was open are kept.** `save-link.tsx`.
* **A skipped duplicate is a plain notice, not an error.** `save-link.tsx`.
* **A save that stored nothing is not a success: the drawer stays open and says why.** `save-link.tsx:finish`, and `save-links.tsx:finish`.
* **A site in the excluded list is not saved, as in the extension, but a link already saved can still be changed.** `save-link.tsx:isExcluded`. `save-links.tsx:allowed` leaves excluded sites out of a list.
* **An empty tag list clears what the link had, and text typed but not yet added is added on save.** `save-link.tsx`.
* **Taking a tag away is done at once, with Undo, as every removal is.** `save-link.tsx`.
* **A full disk or a storage fault is reported, and the person can try again.** `save-link.tsx`, and `save-links.tsx:save`. A button does not spin forever.
* **Several links pasted at once go to the drawer made for them.** `save-link.tsx`.
* **The sheet grows with its content up to its own maximum height, then the body scrolls.** `save-link.tsx:styles`.
* **Several links from one share are saved as bookmarks, a new session, or into a session that exists.** `src/screens/save/save-links.tsx`.
* **A quote goes into the note of the page's bookmark, with a link to the passage, as the extension's Save quote does.** `src/screens/save/save-quote.tsx:SavedQuote`. Without a page link, the person pastes one or picks a bookmark.
* **Words typed in the link field search the bookmarks, so a quote can go on a page saved before.** `save-quote.tsx:matches`.
* **Shared text can be turned into a link instead, with Save link.** `save-quote.tsx:SaveQuoteForm`.

### Copies, reader, sharing

* **Copies are never kept for the private library.** `src/screens/copy/copy-actions.ts`. The menu does not offer Keep a copy or Open copy there.
* **The copy actions sit just above a link menu's first destructive action.** `copy-actions.ts`.
* **A kept copy is drawn as text only, so nothing from the page can run.** `src/screens/copy/reader.tsx`. Blocks are drawn as `Text`.
* **A kept copy never changes, so its position is a stable key.** `reader.tsx`, the body.
* **Open in lists the browsers when the drawer opens, so one installed meanwhile shows up.** `src/screens/open-in.tsx`.
* **Open all asks before opening many links, even for a column or session with one link.** `open-in.tsx:Request`.
* **Locking the private library drops a request made in it, so its links cannot be opened after the lock.** `open-in.tsx:Request`. The request names the library it came from, and the regular one returns on lock.
* **Open in and Copy link sit after Open in a link's menu.** `open-in.tsx`.

### Search

* **The Development section of search shows only in development builds.** `src/screens/search-elsewhere.tsx:Place`.
* **Settings results appear under a screen's own results.** `search-elsewhere.tsx:SETTINGS_RESULTS`. The same query runs over the other places. With no results of its own, the screen shows them straight away; otherwise a button asks for them.
* **The intro carries the count and speaks it once typing pauses, shown the same way it is read.** `search-elsewhere.tsx`.
* **The search operators leave out `in:open`, because the phone has no open tabs.** `src/screens/search-tips.tsx`.

### Folders and sessions

* **A folder's name is reported only once typed, and a library at its folder limit says so at once.** `src/screens/sessions/folder-sheet.tsx`.
* **Chips of folders hold a menu: sharing, and for a folder that can change, renaming and deleting it.** `src/screens/sessions/folder-chips.tsx`. Sessions of a deleted folder move to Unfiled.
* **A session keeps at least one tab, so removing the last link is refused.** `src/screens/sessions/session-actions.ts`.
* **A link action with no case does nothing, so its switch has no default.** `session-actions.ts:runTabAction`. The `none` action is the one without a case. The rule that checks switches honours a `// no default` comment, so the reason now sits in its lint directive instead.
* **Edit details and Move hand the session to the drawers that edit them.** `session-actions.ts`, the rename and move hand-offs.
* **Archive takes a session out of the Archived folder when it is already there.** `session-card.tsx:SessionCardView`.
* **A selection that is all archived turns Archive into Unarchive.** `src/screens/sessions/session-changes.ts:next`. The button is off while nothing is picked.
* **Undo of archiving puts each session back in the folder it had.** `session-changes.ts:archiveSessions`.
* **A colour chosen in the same save wins over the folder's colour.** `session-changes.ts:moved`. The folder move comes first.
* **Cards redraw only when their own session, folder, or expanded state changes.** `session-card.tsx:SessionCard`. Not on each keystroke in the search.
* **The folder's name and colour are worked out once per library change.** `src/screens/sessions/sessions.tsx:folderInfo`.
* **A phone cannot list its own tabs, so sessions come from the extension or from a shared list.** `sessions.tsx:BookmarkLinks`.
* **The list view starts on the list of folders, and a search looks through every session.** `sessions.tsx:atList`.
* **A session list that is long draws only what is on screen.** `sessions.tsx`.
* **A read-only library allows only opening and sharing a session.** `session-card.tsx:SessionCardView`. Other actions are missing there.
* **The Sessions screen with nothing in it names why, and offers the button that fixes it.** `src/screens/sessions/sessions-empty.tsx`. Sync now once connected, or Connect to your server before.
* **The tab bar steps aside for the selection's action bar.** `sessions.tsx:SessionsScreen`, which tells the bar when selecting starts or stops.
* **Picking a folder for several sessions is a separate drawer.** `src/screens/sessions/session-sheets.tsx`.
* **A rename drawer can carry a description, a colour and a folder, when the caller gives them.** `session-sheets.tsx:RenameSheet`.
* **The selection bar acts on the chosen sessions, ends the selection, and offers Undo.** `src/screens/sessions/session-selection-bar.tsx`.
* **Saved tabs can be edited and turned into bookmarks.** `src/screens/sessions/session-link-sheets.tsx`.

### Settings

* **Resetting without sync resets everything; with sync, the choice is this phone's own settings or also the shared ones.** `src/screens/settings/settings.tsx`. Shared settings reset on every synced device.
* **The name and hint of each setting are in one place.** `src/screens/settings/settings-index.ts`. Rows and search read the same text, so they cannot drift.
* **A card hides when the search matches nothing in it, and a row hides when the card matched only through its neighbours.** `src/screens/settings/settings-card.tsx`.
* **A card with no rows of its own is shown in full when found.** `settings-card.tsx:whole`.
* **Each setting's default is named from the choices the row offers, so the reset drawer cannot drift from the row.** `src/screens/settings/row-defaults.ts:wanted`.
* **The Spacing switch is on for compact spacing, which is how the library stores it.** `row-defaults.ts:RESETS`.
* **A setting that cannot be reset is never changed.** `row-defaults.ts:valuesOf`.
* **Holding a setting opens a one-action drawer; TalkBack and switch users get the same action on the row.** `src/screens/settings/row-reset.tsx`.
* **Resetting a section asks first.** `row-reset.tsx`.
* **A setting that differs from its default shows a small dot in the same place on every row.** `src/screens/settings/select-row.tsx:reset`. The dot is not read out.
* **A choice list is drawn in a drawer, so the keyboard lifts it.** `src/screens/settings/connect-sheet.tsx`. On Android the screen no longer resizes for the keyboard, and fields low in a scrolling list were hidden behind it.
* **The excluded websites list is the extension's setting, so a site added here is excluded in the browser too.** `src/screens/settings/excluded-settings.tsx:editExcluded`. An entry covers its subdomains.
* **An edit to the excluded list works on the list as it is now, so a site added by sync meanwhile stays.** `excluded-settings.tsx:add`.
* **Private and regular links can open in different browsers.** `src/screens/settings/open-links-settings.tsx:HOW_CHOICES`. Chrome ignores a request for a private tab from another app, so private links get a browser of their own.
* **A browser is picked as soon as the choice is made, so the row never reads blank.** `open-links-settings.tsx:first`.
* **An empty device name goes back to the phone's make and model.** `src/screens/settings/device-name-field.tsx`.
* **Some settings are the extension's and sync between devices, so changing one here changes it in the browser too.** `src/screens/settings/behaviour-settings.tsx`.
* **Session card appearance: the tab icons and expanded-by-default are the extension's, and the other two are this app's.** `behaviour-settings.tsx`.
* **The private library's trash shows only while the private library is open.** `src/screens/settings/trash-settings.tsx`.
* **The shared pages list asks before a delete, because the server cannot bring a page back.** `src/screens/settings/shared-pages-settings.tsx`.
* **The shared pages list loads while the server's features are unknown, so an unreachable server ends in an error, not a wait.** `shared-pages-settings.tsx:load`.
* **The server report names the update a stopped sync needs, or the features the server lacks.** `src/screens/settings/server-report.tsx`.
* **The end of Settings says what the app keeps and where.** `src/screens/settings/settings-footer.tsx`.
* **The licences list is the one the build generates.** `src/screens/settings/about-settings.tsx`. Tapping a package shows its licence text.
* **Import reads with the extension's own code, so a file reads the same on both.** `src/screens/settings/data-settings.tsx`.

### Transfer

* **Restoring a backup takes a copy of what it replaces first, and if the copy cannot be kept, nothing is replaced.** `src/screens/transfer/restore-sheet.tsx:restoreAll`.
* **Read puts back what the last restore replaced, and forgets the copy.** `restore-sheet.tsx:Read`.
* **A backup from the phone or the extension restores; a password-protected one asks for its password first.** `restore-sheet.tsx:plural`.
* **Statistics show only what is saved, because the phone cannot list a browser's open tabs.** `src/screens/transfer/statistics-sheet.tsx`.
* **The private library is never uploaded.** `src/screens/transfer/transfer-sheets.tsx:capabilities`.
* **A share or export of one thing (a session, a folder, a column, some bookmarks) opens the same drawer as a whole export.** `transfer-sheets.tsx:exportData`.
* **The busy state is drawn before a ZIP is made, since making one holds the one JavaScript thread for a while.** `transfer-sheets.tsx:run`.
* **A share holds the lists of links the text formats take: a session each, or a column each.** `transfer-sheets.tsx:WAYS`.

## Excuses

None found in this folder. The three lint directives that lacked a reason now carry one inside the directive; their reason is recorded above.
