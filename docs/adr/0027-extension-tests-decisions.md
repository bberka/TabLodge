# 27. Extension worker test decisions that were code comments (tests/service-worker.test.ts)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/tests/service-worker.test.ts` ran the service worker in a VM against a mocked `chrome.*` API. The reasons behind its harness options and its browser-specific cases were comments. Comments are banned ([Code comments](../agents/comments.md)), so each reason lives here with the test or harness symbol that carries it. Narration of what a test step does is gone: the test name and the assertion say it.

## Decisions

### Harness

* **The worker runs as a classic script.** It has no exports, so each harness runs its type-stripped source in a fresh VM context against a mocked `chrome.*` (`service-worker.test.ts:createWorkerHarness`).
* **`splitApi` has three modes.** "missing" mirrors a browser before Chrome 155, so the fallback for that build is tested (`service-worker.test.ts:HarnessOptions`).
* **Legacy layout is a migration test.** The library starts in the old single entry, so the worker has to migrate it (`service-worker.test.ts:legacyLayout`).
* **Tab events are opt-in.** Off by default so other tests stay quiet (`service-worker.test.ts:HarnessOptions`).
* **Writes can be interleaved.** A callback runs after each local write lands, so a test can change things between two writes of one operation (`service-worker.test.ts:afterLocalSet`).
* **Timers are manual.** They never run on their own; the snapshot debounce is run by `runTimers()` (`service-worker.test.ts:runTimers`).
* **New tabs start with only a pending URL.** That is how they look before their first navigation commits (`service-worker.test.ts:pendingNavigation`).
* **Off-screen bounds are refused.** Chromium rejects explicit bounds for off-screen geometry (`service-worker.test.ts:rejectWindowBounds`).
* **Firefox has its own rules.** `moz-extension:` addresses, a sidebar instead of the Side Panel API, and `chrome:` addresses refused (`service-worker.test.ts:firefox`).
* **Scripting can be refused.** Chrome rejects `executeScript` on pages without a script grant or an activeTab grant (`service-worker.test.ts:scriptingFails`).
* **Listeners get realistic arguments.** Tests call them with what the real event would carry (`service-worker.test.ts:addListener`).
* **Tests read the normalized store back.** The worker writes its normalized store, so reads are checked after it has written (`service-worker.test.ts:StoredSession`).
* **Response checks are runtime.** `ok` and `error` are checked at runtime by each test's assertions (`service-worker.test.ts:TestResponse`).
* **Storage holds the old entry until a write.** The worker migrates it to the per-record layout on its first mutation; `state` is the library as the app sees it (`service-worker.test.ts:state`).
* **`state` mirrors storage.** It is synced whenever the worker touches storage, so a test can edit it in place (`service-worker.test.ts:state`).
* **Tab index is contiguous.** It is kept per window, like Chromium's tab strip (`service-worker.test.ts:tabsForWindow`).
* **Every listener runs.** Several worker modules can listen to one event; all run, and the last result is returned (`service-worker.test.ts:addListener`).
* **Firefox refuses browser addresses.** `chrome:` and `about:newtab` are refused in tabs and windows create (`service-worker.test.ts:refuseBrowserUrls`).
* **`null` reads every key.** As chrome.storage does; the private lock lists its keys that way (`service-worker.test.ts:wanted`).
* **New pinned tabs go last.** They join the end of the pinned area (`service-worker.test.ts:MockTab`).
* **Closing one split half unsplits the other.** (`service-worker.test.ts:MockTab`).
* **Grouping moves tabs together.** As Chromium does, at the first tab's position (`service-worker.test.ts:group`).
* **Chrome has no `onShown`.** Tests can drop it to mirror that browser (`service-worker.test.ts:createWorkerHarness`).
* **Closed while stopped is found by listing.** `fire: false` means the worker finds the window only by listing windows (`service-worker.test.ts:closeWindow`).
* **Web Crypto runs on a thread pool.** `settle()` does not cover that work, so this waits for it (`service-worker.test.ts:eventually`).
* **A restart keeps the session store.** It stays unless the browser restarted (`service-worker.test.ts:restartPrivate`).

### Private lock

* **Startup locks too.** The worker's own startup locks the library before any page asks (`service-worker.test.ts:restartPrivate`).
* **Idle is checked on read.** Without the alarm, the next library read finds the library idle and locked (`service-worker.test.ts:ageLock`).
* **Storage drops `undefined`.** JSON keeps no undefined fields, so comparisons use plain values (`service-worker.test.ts:createWorkerHarness`).
* **An older version wrote a PIN.** The same record says it is a PIN, so the check reads it that way (`service-worker.test.ts:first`).

### Firefox

* **Firefox runs the worker as an event page.** These tests cover where its browser differs from Chromium (`service-worker.test.ts:createWorkerHarness`).

### Drag

* **A column's own drop is left alone.** The column has already called preventDefault (`service-worker.test.ts:buildLinkDragData`).
* **Text fields keep native drops.** Unrelated drags are not touched (`service-worker.test.ts:buildLinkDragData`).

### Clipboard

* **Node has no DOMParser.** The stand-in reads the one anchor `buildLinkDragData` writes (`service-worker.test.ts:globals`).

### Bookmarks

* **Discarding the last column unfiles bookmarks.** That is why the test covers the last column too (`service-worker.test.ts:harness`).
* **Unfiled is a target; an unknown column falls back.** The file's columns are used (`service-worker.test.ts:harness`).
* **A bookmark whose column was deleted goes to the first column.** (`service-worker.test.ts:second`).

### Split view

* **Both halves highlighted is one slot.** So "selected or window" saves the window (`service-worker.test.ts:slot`).
* **Other split views are saved in full.** Only the highlighted pair counts as one slot (`service-worker.test.ts:deepEqual`).
* **Whole-window saves keep both halves.** (`service-worker.test.ts:windowSave`).
* **A refused split is ordinary tabs.** The pair are background tabs again and may be unloaded (`service-worker.test.ts:refused`).

### Settings

* **Booleans fall back unless exactly opposite.** Only the opposite boolean overrides the default (`service-worker.test.ts:fallback`).
* **Wrong types point away from the default.** So loose truthiness checks fail (`service-worker.test.ts:readStored`).

### Pinned tab

* **A restore gets its own pinned tab.** The restored session never contains one (`service-worker.test.ts:restored`).

### Columns

* **A path beats a bare host.** A path entry matches that path and below (`service-worker.test.ts:repo`).
* **An explicit column wins over the domain.** (`service-worker.test.ts:explicit`).
* **A color in the same save wins over the folder's.** (`service-worker.test.ts:other`).

### Snapshots

* **A session moved back is not archived again until it goes stale.** (`service-worker.test.ts:recoveryHarness`).
* **A clean exit clears `sessionOpen`.** The last window closing does that, so the run is not a crash (`service-worker.test.ts:recoveryHarness`).
* **Closing windows down to one is a shutdown.** Nothing captured afterwards means a shutdown, not a crash (`service-worker.test.ts:recoveryHarness`).
* **A capture after the close is a crash.** It means the session went on (`service-worker.test.ts:recoveryHarness`).
* **Tiny sessions get no banner.** They are too small to be worth one (`service-worker.test.ts:recoveryHarness`).
* **Disabled snapshots never judge a run.** (`service-worker.test.ts:recoveryHarness`).
* **Empty captures never replace the state.** (`service-worker.test.ts:recoveryHarness`).

### Trash

* **Undo restores in reverse order.** As the page does (`service-worker.test.ts:removed`).
* **A move that leaves the source non-empty adds no trash entry.** (`service-worker.test.ts:plain`).

### Backups

* **Oversized backups get a longer timeout.** Slow machines need more than the 5 s default (`service-worker.test.ts:createWorkerHarness`).

### Sessions

* **The default target is the most recently updated session.** So the test makes the full one that (`service-worker.test.ts:state`).

### Limits

* **Repeats in a long list do not count against 500.** (`service-worker.test.ts:repeated`).
* **A foreign list shape still obeys the setting.** (`service-worker.test.ts:plain`).

### Migration

* **Archive and lock were removed.** Older data is migrated on read (`service-worker.test.ts:LegacyState`).

### Session name

* **The clock is local.** The worker formats in local time, so the fixed date is a local one (`service-worker.test.ts:NAME_NOW`).
* **The fallback cannot be "ask".** (`service-worker.test.ts:nameHarness`).

### Palette

* **The palette works on restricted pages.** It is a window of its own, so the page does not matter (`service-worker.test.ts:nameHarness`).
* **Browser pages are never injected.** (`service-worker.test.ts:nameHarness`).
* **A refused script falls back.** Web Store, PDF viewer and no-activeTab pages (`service-worker.test.ts:nameHarness`).

### Browser bookmarks

* **The worker offers the page just bookmarked with the browser's star.** (`service-worker.test.ts:browserBookmarkHarness`).
* **The import flag survives in session storage.** When only the in-memory state is lost (`service-worker.test.ts:browserBookmarkHarness`).

### Sync

* **Only `Date` is faked.** Each round gets a later timestamp without a real sleep (`service-worker.test.ts:vi`).
* **Normalizing later does not make a folder new.** The added folder keeps its time (`service-worker.test.ts:vi`).
* **An older version can leave a key and switch behind.** No sync server means no client (`service-worker.test.ts:harness`).
* **Four code points can normalize to two.** A key an older version wrapped with them still works (`service-worker.test.ts:createSyncKey`).

### Page copies

* **Injected functions are text.** Chrome sends them as text, which a method shorthand does not survive (`service-worker.test.ts:executeScriptCalls`).
* **The startup sweep keeps a saved copy.** A copy filling the budget belongs to a saved bookmark (`service-worker.test.ts:state`).

### Sources

* **Access is per browser.** The site stays on here, so other browsers keep it (`service-worker.test.ts:deepEqual`).
* **Turning on again needs a new grant.** After access went back (`service-worker.test.ts:again`).
* **A page on one site never speaks for another.** (`service-worker.test.ts:wrongSite`).
* **A text post needs no note.** It links to its own page (`service-worker.test.ts:harness`).
* **A page-save shows its result there.** So it keeps nothing for the next page (`service-worker.test.ts:harness`).
* **Answers come from the worker's VM realm.** `deepEqual` needs plain objects of this realm (`service-worker.test.ts:counted`).
* **Keep off is for supported sites only.** Off until the site is added, and only where the adapter supports it (`service-worker.test.ts:keepOff`).
* **Removing gives access back.** Adding the site again asks for it again (`service-worker.test.ts:harness`).

### Catch-up

* **A Not now after the site went off stores nothing.** (`service-worker.test.ts:harness`).
