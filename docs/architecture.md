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

* The main storage key, `tablodge.state`, the session and bookmark record keys (`tablodge.session.`, `tablodge.bookmarks.`), and the recovery keys listed below.
* The theme key `uiTheme` and accent key `uiAccent` in extension storage, and their `tablodge.uiTheme` and `tablodge.uiAccent` mirrors in page `localStorage`.
* Export format identifiers such as `tablodge-sessions`, `tablodge`, `tablodge-backup`, and `tablodge-full-backup`.
* Drag MIME types `application/x-tablodge-session`, `application/x-tablodge-column`, and `application/x-tablodge-bookmark`.
* Context menu IDs beginning with `tablodge-page-` or `tablodge-action-`.

An optional locked area was built and removed again before any release shipped it. Its keys (`tablodge.locked`, `tablodge.locked.key`, `tablodge.locked.flag`, `tablodge.locked.attempts`) were never part of a published version, so `initializeExtension` deletes them from local and session storage at every start. A development profile that used the feature therefore keeps no orphaned encrypted entry.

The installation path matters too. An unpacked extension gets its ID from the folder it is loaded from. A different path can mean a different ID and separate storage.

## Data and messages

`src/app/types.ts` defines the data model and typed messages. Pages call `send()` from `src/app/common.tsx`; the worker handles storage and browser operations. Mutations are serialized so concurrent messages don't overwrite one another.

Sessions, folders, bookmarks, columns, and settings live in `chrome.storage.local` under `tablodge.state` and the record keys it points to (see [Library storage](#library-storage)). The current schema is version 10. Older data is normalized on load and moved to the current layout by a resumable migration. Data from a newer schema is refused rather than overwritten. Recovery data has separate keys so a snapshot doesn't rewrite the whole library. Normalization creates the Archived folder when missing. Sessions in that folder stay stored but are left out of active session lists and global search.

The manifest uses split incognito mode so extension pages can open inside private windows. `tablodge.private.config` in local storage holds the global private mode, setup completion, and the private new tab redirect preference, independently of library imports and preference resets. The redirect is enabled by default. Chromium does not allow an extension to statically replace the private new tab page, so the private worker redirects newly created browser new tabs to the dashboard after creation. Private messages and mutations are blocked until setup is complete. Normal windows always use the normal library. Private workers route library and recovery keys through `library`: shared mode keeps the original keys, saved mode prefixes them with `tablodge.private.` in local storage, and temporary mode uses the same prefix in session storage. Session storage survives worker and private window restarts but is cleared by a browser restart. A separate private library migrates to the current layout the same way, under its own prefix, and mode changes do not copy or delete libraries. Mode changes join the worker's mutation queue and invalidate its settings and migration caches. Private pages reload when the mode changes. Changing the redirect preference does not reload open private pages. Light and dark appearance remains shared. `tablodge.private.config` also holds an optional private accent (`teal` by default, `same` to follow the regular accent). Private pages apply it over the regular accent, and mirror it into the private context's own localStorage so `theme-boot.ts` can paint it before React loads. Changing it does not reload open private pages. Private workers do not run automatic recovery, backups, or browser bookmark monitoring, and they refuse the snapshot messages so shared mode never exposes the regular windows' snapshots. Dashboard lookup and new restore windows respect the private context.

## Library storage

`src/shared/library-state.ts` owns how the library is laid out in storage. Its index and commit planning live in `library-index.ts`, the sync shapes in `library-sync.ts`, and hashing in `library-values.ts`. The rest of the worker still sees one logical value under `tablodge.state`, in the shape it always had (`groups`, `folders`, `bookmarkColumns`, `bookmarks`, `settings`, `updatedAt`), through the worker's `library` object. `library.get`, `set`, and `remove` route that key to the module and pass every other key straight through, so `getStore`, `writeStore`, Undo, erase, and backup restore did not change shape. The module takes a plain key and value backend and never touches `chrome.*`, which is how the tests make any storage call fail on purpose. Sync and encryption plug in here.

Before schema 10 the whole library was one value, so saving a single tab rewrote every session. Now a save writes the changed sessions and a small index.

| Key | Contents |
| --- | --- |
| `tablodge.state` | The **index** (`layout: 'records'`, `schemaVersion: 10`): `rev` (a commit counter), folders, bookmark columns, settings, `updatedAt`, one entry per session in display order (`id`, `rev`, `hash`, tab count, name, folder, timestamps), the bookmarks reference, `garbage`, and sync reservations (below) |
| `tablodge.session.<id>.<rev>` | One session with all its tabs. Never edited in place: a changed session is written to a new key |
| `tablodge.bookmarks.<rev>` | `{items}`, all bookmarks. Rewritten only when they change. Per bookmark records can reuse the same module later |
| `tablodge.migration` | Progress marker, present only while a migration is unfinished |
| `tablodge.state.premigration` | An exact copy of the old single entry, kept for seven days after a verified migration |

Private libraries use the same keys under their prefix and area, so shared, saved, and temporary modes need no special case. A saved private library can be encrypted value by value (see [Private library lock](#private-library-lock)).

### Commits

Every write is a copy on write commit with one commit point:

1. Write each changed session (found by comparing a content hash with the index entry) to a new key at `rev + 1`.
2. Remove the keys the previous commit listed as garbage. Nothing reads them any more.
3. Write the index. This single key write is the commit. A crash before it leaves the previous library, after it the new one. It can leave unreferenced keys but never a half applied save.
4. The keys this commit replaced become the index's `garbage`, removed by the next commit, so a reader that fetched the previous index can still finish. A reader that finds a record missing re-reads the index and retries; a record still missing from a stable index is reported as damage and nothing is written over it.

The index is written by every commit, so pages and the context menu code that watch `tablodge.state` keep working. Its session entries carry the name, folder, and timestamps the menus need without reading any tabs. `readSettings` reads only the index.

### Migration from the single entry

`migrateStoreOnce` runs inside `mutate` (so inside the mutation queue and the shared storage lock) at each worker start, and again on a later mutation if it failed. While the library is still in the old layout, reads and writes keep working on the old entry (writes stamp schema 9, so older builds can still open it).

1. Detect the old entry. A newer schema is refused.
2. Take a safety backup through the usual backup list (`Before upgrading how the library is stored`), unless an interrupted attempt already did.
3. Write `tablodge.state.premigration`, read it back, and compare its hash.
4. Normalize the old entry with `normalizeStore`, so the records hold what the app showed before. Check that every session, saved tab, bookmark, folder, and column has a stable id that no sibling shares; any failure leaves the old entry in charge, before anything is written.
5. Write `tablodge.migration`, then the records in batches of about 2 MB or 50 sessions. The marker names a batch's keys before they are written. A resumed attempt skips records that are already correct.
6. Read every record back and compare its hash and tab count with the plan. A mismatch aborts.
7. Write the index with `rev: 1`. This is the switch. Keys the marker names that the index does not reference become garbage.
8. Remove the marker. A crash between 7 and 8 leaves only the marker, which the next run removes.

If the old entry changes between attempts (a write on the old layout), the marker's hash no longer matches and the migration starts over, still cleaning up the first attempt's keys. After a failure the worker waits five minutes (or a restart) before trying again. `pruneRecoveryCopy` removes the recovery copy once its seven days have passed.

### Sync reservations

Record level sync needs a stable id, a revision stamp, a tombstone, and an order key for every record kind. The layout reserves them without any sync code. All of it is invisible to the app, so imports cannot inject it and exports cannot leak it, and every write carries it along.

* **Ids.** Present on every record already and checked at migration. Preferences are addressed by their setting key.
* **Stamp and order key.** `{h, d, o}`: a hybrid logical clock string, the writing device's id, and a fractional index among siblings. Stored in the index (`sessions[i].sync`, `folderSync`, `columnSync`, `preferenceSync`), in a session record's `$sync.tabs` (flagged by `sessions[i].tabSync`), and in the bookmarks record's `$sync.items` (flagged by `bookmarks.sync`). Nothing writes them yet. A missing stamp means never stamped, with the record's `updatedAt` as its implied stamp. A missing order key means its position in the stored array, which stays authoritative until sync assigns keys in one pass, so adding them needs no further migration.
* **Tombstones.** The index's `tombstones` list holds `{kind, id, parentId?, deletedAt, purgeAfter, sync?}` for sessions, tabs, bookmarks, columns, folders, and preferences, and a commit drops the expired ones. The trash and Undo are unchanged and remain the user facing delete.
* **Device id.** The index's `device`, assigned when sync is switched on. It lives only in the index, so restoring a backup elsewhere cannot copy it.
* **Carrying.** A rewritten session or bookmarks record keeps its sidecar minus entries for records that are gone, reading the old record only when the index flags one. Malformed sync data is dropped instead of making the library unreadable.

### Sync protocol

`src/shared/sync/` holds the record level sync protocol: the hybrid logical clock (`clock.ts`), order keys (`order-key.ts`), the change format and last writer wins merge (`changes.ts`), an in memory reference of the server's change log (`change-log.ts`), the split of a library into records (`library-records.ts`), and the device side engine (`engine.ts`), which finds local edits by comparing the library with what it last agreed on with the server. It uses no browser or server APIs. [ADR 1](adr/0001-record-level-sync-protocol.md) explains the rules and why they were chosen.

The worker runs `client.ts` as `syncClient` in `service-worker.ts`, wired to `chrome.storage.local`, `fetch`, `WebSocket`, the mutation queue, `getStore`, and `writeStore`. Records from the server go through `normalizeStore` first, like an import. Settings shows sync in `src/app/sync-settings.tsx`.

* **A round** stamps local edits, pulls every page the server has, applies them in one step, then pushes the outbox. Every library read and write is one step inside the mutation queue, and the network calls happen between steps, so a slow server never blocks the app.
* **Out of order pages.** Pages arrive in the order the server last changed each record, so a tab can come before its session or a bookmark before its column. The engine holds such a change in `held` until the record it belongs in arrives or turns out to be deleted. Without that, the library would drop or move it and the next capture would send that loss to other devices.
* **When it runs.** `writeStore` calls `syncClient.localChanged()`, which starts a round after 1.5 seconds without further writes. A live WebSocket asks for a round when another device pushes, and its pings every 20 seconds keep the Chromium service worker alive while sync is on. The `tablodge-sync` alarm runs a round every five minutes and reopens a closed socket.
* **Safety.** The first sync takes a safety backup before writing anything from the server. The state's `known` is the highest server cursor the device has seen from pulls and its own pushes. A server answering with less was restored from an older backup or replaced, so the device starts over with `restartAfterServerReset`: it pulls everything and queues every record it knows, the stamps decide record by record, and the server gets back what it lost.
* **Storage.** The client keeps its state in `tablodge.sync.config`, `tablodge.sync.state`, and `tablodge.sync.status`.
* **Private windows in shared mode.** A private worker has no client. After it writes the shared library it sets `tablodge.sync.nudge`, and the regular worker treats that as a local change.
* **Private windows with separate saved storage.** The private worker creates `privateSync` once the user turns it on (`PRIVATE_SYNC_ENABLE`; after connecting, a regular window can open Settings in a private window with `OPEN_PRIVATE_SYNC`, which starts it there), and only while that library can be read; it stops when the library locks or the mode changes. It syncs to the regular server's address plus `/private` and follows the regular connection: its config comes from `tablodge.sync.config` and the private flag `sync.private.on`. Its state lives under the private prefix, so the lock seals it.
* **Private encryption.** The private client's `codec` (`src/app/private-sync.ts`) seals each value with a random sync key before pushing and opens it after pulling, with the record key as authenticated data. The server holds that key wrapped with the PIN or password (`/v1/key`, compare and set). A new credential rewraps it, and a plain value pulled into an encrypted library is sent again sealed. [ADR 2](adr/0002-private-window-sync.md) explains the choices.

`server/` is the self hosted sync server, a separate pnpm workspace package. [Self hosting](self-hosting.md) covers running it.

* **API.** `api.ts` is the HTTP API (Hono), independent of the runtime. `/v1/key` stores a library's wrapped key, and `/v1/status` lists the optional `features`.
* **Storage.** `sql-change-log.ts` implements the change log over SQLite through a small synchronous interface, which both `node:sqlite` and Durable Object storage provide. The protocol tests run every log test against it as well as against the in memory reference. It keeps the cursor, purge marks, record count, and wrapped key in a `meta` table and in memory, so a push reads only the stamps of the records it touches and a Durable Object waking from hibernation reads no records at all. A partial index finds old tombstones for the purge.
* **Docker.** `node.ts` is the entry, bundled into one file by `server/vite.config.ts`. It serves `library.db` and, under `/private`, `private.db`. `node-sqlite.ts` tunes SQLite for a small server: WAL with `synchronous = NORMAL`, a capped WAL file and cache, reused statements, and incremental vacuum after a purge. `compose.https.yaml` runs the image behind Caddy for a VPS.
* **Cloudflare.** `worker.ts` is a Worker that checks the token and forwards to a Durable Object, which holds the library and the hibernating WebSockets: the object named `default`, or `private` for paths under `/private`.
* **Live channel.** `live.ts` defines the WebSocket that tells devices to pull. Unauthenticated sockets are closed after 10 seconds (a timer in Node, an alarm in the Durable Object), and the Docker server accepts at most 64.
* **Transfer.** `transfer.ts` copies a library out of a server and into another through the API: JSON lines, with deletes, stamps, and the wrapped key. The Docker image runs it as `node node.js export` and `import`, and `server/scripts/transfer.ts` runs it against any server.

### Undo

`withUndo` keeps the library as a delta. `beginCheckpoint` notes the index, and while the action runs, each commit copies the records it replaces (still present, because garbage is removed one commit later). The undo record stores the old index and only those records. `UNDO` is valid only while the index is the exact commit the action ended on (`fingerprint`), then `restoreCheckpoint` writes the old library back as one more commit that rewrites only what differs. If a copy could not be taken, or the library is still in the old layout, the action gets no delta and falls back to a full copy or no Undo, never a wrong one.

### Private library lock

`src/app/private-lock.ts` holds the optional PIN or password lock for the saved separate private library (schema 10 layout, `library` seam). It reuses `validateCredential` from `passcode.ts` and the envelope from `crypto-envelope.ts` without changing either.

* **Keys.** A random 256 bit data key encrypts each stored value with AES-GCM, so a save costs no key stretching. The storage key name is authenticated data, so a sealed value cannot be moved to another key. A sealed value is stored as `{tlock: 1, iv, ct}` (base64). The data key is wrapped with `encryptBytes` (the credential envelope) and stored in the lock record `tablodge.private.lock` in local storage: `{version, state, kind, wrapped, idleMinutes}`. `tablodge.private.config`, the lock record, and the unprefixed appearance keys are never sealed.
* **Where it plugs in.** The worker seals and opens in `rawLibrary`, below `libraryState`, so the index, session and bookmark records, trash, Undo, safety backups, and the migration marker are all covered and nothing above the seam knows. It applies only to a private worker in saved mode. While the library is locked, every read, write, and removal there throws a `PrivateLockError` ('locked'), and `handleMessage` answers locked messages with `{ok: false, locked: true}` before reading anything, except `GET_PRIVATE_CONFIG`, `GET_PRIVATE_LOCK`, `UNLOCK_PRIVATE`, `LOCK_PRIVATE`, `TOUCH_PRIVATE_LOCK`, and `HANDOFF_NEW_TAB`. Exports, backups, and the full backup are ordinary messages, so they are refused while locked. Storage change events report sealed values as absent, so menus and caches never see ciphertext, and `invalidateSettings` drops the worker's caches whenever the key goes.
* **Key lifetime.** The key lives in `chrome.storage.session` (`tablodge.privatelock.key`), with the last use time in `tablodge.privatelock.active`. They are separate so a late activity write cannot bring back a key that was removed. Session storage survives worker restarts, so a restarted private worker stays unlocked, and it is cleared when the browser closes or the extension reloads. An alarm (`tablodge-private-lock`, every minute while unlocked) and every library read check the idle time, and pages also set a timer from `expiresAt`. A page unmounts its content on lock, so nothing stays in the page. Five wrong entries in a row start a growing wait.
* **Closing the last private window.** The private worker is not woken when the last private window closes, so nothing can lock at that moment. In `vp run test:private` the key was still in session storage after the last close, also when the worker had been active a moment before. The lock judges it later instead. `tablodge.privatelock.windows` holds the ids of the private windows that were open while unlocked. It is written in the same call as the key, and removed with it. Before the key is used, `lockWhenWindowsClosed` lists the private windows (`chrome.windows.getAll`, `incognito` only, extension pages included, no permission needed) and `judgePrivateWindows` decides:
  * Some tracked window still exists: stay unlocked and track every open window, so windows opened while the worker slept join the set. A worker evicted in a window that is still open therefore stays unlocked, and so does closing one of several windows.
  * None exists, or nothing is tracked, or the list cannot be read: lock (remove the key, the activity time, and the ids). That covers windows that opened and closed while the worker slept, and locks when unsure.

  The check runs on every worker start, on `windows.onCreated` and `onRemoved`, and inside `currentKey`, below `gate()` and `status()`, so every library read, every lock status request, and the idle alarm pass through it. It shares one queue with storing and removing the key. A new window that opens as the last one closes is therefore compared with the old set first, so it sees the lock screen whether its page or the window event reaches the worker first, and a read that had already fetched the key finds it gone. Chromium numbers windows from a counter that only goes up while the browser runs, and session storage is empty after a restart, so an id cannot come back for another window. Until the next wake the key stays in `chrome.storage.session`, in memory only, and the status that regular windows show can still say unlocked. Firefox has no private context for this add-on, so none of this applies there. A regular worker has no list of private windows and never locks on windows.
* **Turning it on and off.** Both rewrite every value and run inside the mutation queue, only from a private window (the key and the queue belong to the private worker). Enabling writes the key to session storage, then the lock record in state `encrypting`, then seals each value in batches, then sets `encrypted`. Removing sets `decrypting`, opens each value, then deletes the record last. Each value is either sealed or plain and readers accept both, so a pass cut off anywhere leaves a readable library: writes made meanwhile are sealed (`encrypting`) or plain (`decrypting`) to match the pass, and the next start with the key in memory, or the next unlock, finishes it. A cut off pass without the key shows the lock screen. An old single entry private library is sealed whole and migrated afterwards through the same seam.
* **Changing the credential** wraps the same data key again with one write, so it cannot be cut off halfway. It does not re-encrypt the data: someone who kept an old copy of the profile and the old credential can still open that copy.
* **Storage mode.** `SET_PRIVATE_CONFIG` refuses any mode other than `saved` while a lock record exists, in regular and private workers, and the Settings radios are disabled with the reason. A malformed lock record keeps the library closed rather than being treated as no lock.

Tests: `tests/private-lock.test.ts` covers the crypto, the state machine, and a cut off at every write of enabling and removing. `tests/service-worker.test.ts` covers the worker seam, and `vp run test:private` runs the lock in Chromium with real private windows.

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

For actions the trash cannot represent, the worker's `withUndo` copies affected storage keys before the action and stores hashes of their resulting values afterward. The library is kept as a delta of changed records (see [Library storage](#undo)) instead of a copy of everything. The response includes `undoId`. `UNDO` succeeds only within two minutes and only if all affected keys still match those hashes, or the library is still at the commit the action ended on. Later edits to the same data cause Undo to be refused.

Undo runs through the mutation queue and relevant recovery queues. It resynchronizes alarms, toolbar behavior, and menus after restoring state. At most three records are kept, with expired copies removed by an alarm and on worker startup. Undoing snapshot deletion restores history, not the live capture or crash banner, and is refused if another snapshot was captured in the meantime.

Opening more than 10 saved links or bookmarks, or restoring a snapshot, also offers Undo. That action closes the newly opened tabs that still exist.

## Pages and shared UI

The new tab dashboard contains sessions and bookmark columns. Settings and Help have their own pages. The popup is a compact chooser; its **Open TabLodge** action opens the dashboard. The side panel has bookmarks, sessions, and open tabs, with search and actions suited to its narrow layout.

**Close duplicate tabs** (popup and side panel Tabs section) runs in the page, not the service worker. `findDuplicateTabs` in `src/app/duplicate-tabs.ts` groups web tabs from `chrome.tabs.query` in normal windows by their canonical address (the same exact match saving uses) and protects pinned and active tabs. Without one, the copy with the latest `lastAccessed` stays. The page then calls `chrome.tabs.remove`, and the Undo toast reopens each tab with `chrome.tabs.create` in its old window and index, rejoining its tab group if that still exists. No extra permission is needed and nothing is stored.

The `open-palette` shortcut shows the palette over the page by default (see below) and opens `palette.html` in a small popup window (`openPalette` in the service worker) when the `paletteLocation` setting is `window` or the page cannot be scripted. The window works on every page, restricted ones included, and the page never sees the key. The address carries `?window=<id>`, the window that was in front. Messages from that page go through `paletteSender`, which replaces the sender tab with the active tab of that window, so a restore or save acts on the window the user came from and not on the palette's own window. A second press closes the window, and so does another window taking the focus (`useCloseWhenUnfocused`, which acts only when `chrome.windows.getCurrent()` reports a popup, so the same page opened as a tab stays open). The page reuses `FinderPaletteWindow` from `src/app/finder.tsx`, with the `standalone` option that sends links, searches, and restores to that window. Before a query is typed the finder lists the eight most recently used sessions (`lastOpenedAt`, else `updatedAt`), then open tabs and commands. The right arrow opens a second level of actions for the highlighted result (`itemActions` in `src/app/finder-menu.ts`): the search box stays the combobox, switches `aria-controls` to the actions listbox, and filters it, with a breadcrumb above and `Esc` or `Backspace` to go back. The actions use APIs the extension already has (`chrome.windows.create`, `chrome.tabs.remove`, the clipboard), so no permission changes. The shortcut is a command, so the window needs no permission.

`paletteLocation` is `page` by default, and any stored value other than `window` (missing, unknown) normalizes to `page`, so a profile that never chose gets the overlay while an explicit `window` is kept. The Settings reset button returns it to `page`. With that setting, `openPalette` first calls `openPaletteInPage`: for an `http` or `https` tab it runs `chrome.scripting.executeScript` with `togglePaletteOverlay` (`src/app/palette-overlay.ts`) as the injected function. Pressing the command grants `activeTab` for that tab, which is the only access the injection needs, so there are no host permissions and no content script on any page. `activeTab` and `scripting` produce no install warning in Chrome or Firefox, so an update that adds them is not held for approval. The function builds a closed shadow root holding a dialog with an iframe of `palette.html?overlay=1&window=<id>`, setting every style through the element style object so the page's CSS and CSP cannot reach in and nothing leaks out. The frame is the same `FinderPaletteWindow`, with `overlay` set: it asks the page to close with a `tablodge-palette-close` message instead of `window.close()`, and keeps Tab inside the frame. The injected script closes on `Esc`, an outside click, the message, or a second press, and returns focus to the element that had it. It keeps focus inside the dialog while open. `palette.html` is the only web accessible resource, matching `http` and `https`. If injection throws (browser pages, the Web Store, the PDF viewer, file addresses, no activeTab grant) or the tab is not `http` or `https`, `openPalette` opens the window without any message, so the user only sees the palette appear.

The toolbar icon action is configured in **Settings › Opening TabLodge › Toolbar button action**. The side panel is an action choice alongside the popup and save actions. A shortcut and browser side panel menu can open the panel independently.

The `tl` address bar keyword is handled by the service worker, which needs no permission for it. `onInputChanged` reads the library (cached until storage changes) and the open tabs, builds the finder index, and ranks it with the same scorer as the palette (`src/app/omnibox.ts`). A suggestion's content is the finder item id. `onInputEntered` maps it back: an open tab is focused, a bookmark or saved tab opens by the address bar disposition (a pinned TabLodge tab is never navigated away), a session opens the dashboard with `?group=`, and any other text opens the dashboard with `?q=`. The worker is bundled from its imports at build time, and the worker tests bundle it the same way (`tests/worker-source.ts`).

**Settings › Dashboard › Dashboard width** controls the dashboard container and bookmark grid together. The default keeps the existing 1,440 pixel maximum and three column desktop grid. Wider uses up to 1,920 pixels and four columns on a 1,920 pixel viewport. Full width removes the maximum and fits as many columns as the available space allows, with a 288 pixel minimum column width. Narrower uses a 1,024 pixel maximum and two columns. Small screens still use one column where two would not fit. The worker normalizes invalid values back to the default.

**Settings › Bookmark board › Bookmark view** switches between Board, the column grid, and Focus, a column list next to one open column. The same setting is available from the view button in the bookmarks toolbar. Limit bookmarks shown at a time is on by default, so columns in both views use a capped height and scroll through all of their bookmarks, and a busy column does not make the page taller. With the limit off, columns grow with the page. The worker normalizes invalid values back to Board.

**Settings › Bookmark board** also has three layout settings. **Bookmark column width** (narrow, default, wide, extra wide) sets the minimum column size in Board view to 224, 288, 384, or 512 pixels at the default font size. **Columns per row** caps how many columns share a row, from 1 to 6, and Automatic (0) has no cap. When both are at their defaults, the grid follows Dashboard width as before. Otherwise the grid uses `repeat(auto-fit, minmax(...))` from `src/app/bookmark-layout.ts`, so a narrow window still shows fewer columns than the cap instead of shrinking them below the minimum. Focus view always shows one column beside the list and ignores both. **Bookmark density** (comfortable or compact) applies to Board and Focus: compact uses a smaller grid gap and tighter column header, body, row, and rail spacing, and scales the capped column height to match, so the same number of bookmarks stay visible. The worker normalizes invalid values back to Default, Automatic, and Comfortable, and clamps columns per row to 0 through 6.

**Settings › Dashboard › Remove tracking parameters** is off by default. When enabled, opening saved links, copying a link with **Copy link**, restoring sessions, and restoring snapshots removes common query parameters such as `utm_source`, `fbclid`, and `gclid`. A few generic names are removed only on the sites that use them as share tracking: `s` and `t` on x.com and twitter.com status links, `ref_src`, `ref_url` and `cxt` on those hosts, and `si` on YouTube and Spotify. Saved URLs and exports keep their original values. The page helper and classic service worker maintain matching parameter lists.

**Scrolling while dragging.** `src/app/drag-autoscroll.ts` is the one helper for it. `watchDragAutoscroll` listens on the document from the new tab page and starts on the first `dragover`, so saved tabs, sessions, bookmarks, columns, and links dragged in from other pages all share it. Each animation frame it finds the scroll panes under the pointer (innermost first, then the window) and scrolls the first one whose edge strip holds the pointer and that can still move that way. The strip is 72 pixels wide (at most 30% of a small pane). Speed grows with the square of the depth into the strip, from 120 to 1,000 pixels per second, and drops to 35% for `prefers-reduced-motion`. It ends on `drop`, `dragend` (which also covers Escape), the pointer leaving the window, or any ordinary pointer or key event, and it cancels its frame and listeners on teardown. The pointer based column drag for touch and pen uses `createPageAutoscroller` and recomputes its target after each scroll. The mouse wheel is left alone: a browser either swallows it for the whole native drag or scrolls natively, and a listener that cancelled it would break the second case. Chromium adds its own thin edge scroll for the window and panes, so the speeds stack in the last few pixels. The drop target is read from the pointer and the card rectangles when the browser sends the next `dragover` and again on `drop`, so a drop after scrolling lands where the mark shows. Keyboard users move items with Move up and Move down in the menus.

UI primitives live in `src/components/ui/`, with composed helpers in `src/shared/ui.tsx`. Theme tokens and the accent colors live in `styles/extension-app.css`. `src/shared/accents.ts` lists the preset accents and applies every accent except the default as inline variables. The system accent is read from the CSS `AccentColor` keyword (Chromium's placeholder `rgb(0, 117, 255)` counts as no accent, and the extension cannot read the Chrome theme color) and rechecked on focus, on visibility and color scheme changes, and every two seconds while the page is visible, because the browser sends no event for it. `src/shared/theme.tsx` mirrors the saved theme and accent for the boot script and follows system theme changes. The `@/` alias resolves to `src/` during builds and must not remain in output bundles.

## Saving and restoring sessions

Save scopes include selected tabs, the current window, all windows, a native tab group, the active tab, and tabs to either side. Toolbar actions, context menus, and shortcuts share worker logic. The page menu's **Send this tab to session** submenu lists the ten most recently changed sessions outside the Archived folder, plus **New session**. It adds the tab through the same path as the toolbar's current tab mode, so excluded sites, the duplicate setting, and **Close tabs after saving** apply. The link menu's **Save link to session** submenu lists the same sessions, without the one named Saved links, which has its own entry that creates it when missing. A link is added at the end of the chosen session without opening it, and an address the session already holds is skipped. The menus rebuild when that list of sessions or their names change. The `save-window` shortcut uses `selected-or-window`, so a selection takes precedence over the window.

Only ordinary HTTP and HTTPS URLs are saved. Excluded sites are filtered during capture. Native group metadata is restored where browser APIs allow it.

Pinned tabs are excluded by default. When included, they can be closed only after the session is written and **Close tabs after saving** is enabled. The worker checks each tab's URL and pinned state again before closing it. When that closes every tab in a window, the worker opens a new tab so the window stays, unless **When a save empties a window** is set to close it and another normal window of the same incognito state is open. It then focuses that window and closes the emptied one. The last window is never closed.

A restore of more than 100 tabs opens them in batches of 25. After each batch the worker waits until at most five of its tabs are still loading (at most three seconds, checked every quarter second) before opening the next, so the browser never has hundreds of pages loading at once. With **Unload restored tabs** on, each finished batch is also unloaded then, so memory stays near one batch instead of the whole session. The tab that becomes active, pinned tabs, and split view pairs stay loaded. Smaller restores open every tab straight away as before.

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

**Find duplicate bookmarks** (bookmark toolbar menu) lists addresses saved more than once on the board, across columns. `findDuplicateBookmarks` in `src/app/duplicate-bookmarks.ts` groups bookmarks by canonical web address in one pass and keeps the oldest copy by default; the dialog lets the person pick another. Sessions are not scanned, because the same address in two sessions is normal. `REMOVE_DUPLICATE_BOOKMARKS` takes the bookmark IDs to remove, rejects a request that would remove every copy of an address or that names a missing or repeated ID, and moves each bookmark to the trash as an ordinary bookmark entry with its old neighbors, written with one trash update. It accepts at most 500 IDs, the trash item limit; the dialog sends the first 500 and says how many copies remain. The response lists `trashIds` in deletion order, and the Undo toast restores them in reverse with `RESTORE_TRASH`. Nothing is removed until the person confirms, and there is no schema change.

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

Automatic backup history and Undo records are not included. A backup made while the removed locked area existed may also hold a `locked.json`; import skips that file and restores the rest. Import recognizes the ZIP header and format identifier, shows counts, and sends `RESTORE_FULL_BACKUP`. The worker rejects newer versions, normalizes entries, takes a safety backup, and replaces the affected data inside one undoable action. It then resynchronizes alarms, toolbar behavior, and menus.

Files above 45 MB, or expanding beyond 60 MB, are refused. JSON, HTML, CSV, Markdown, and URL list exports are always unencrypted; see [Privacy](PRIVACY.md) before sharing backups.

#### Protected full backup

The Back up dialog can protect a full backup with a PIN or password. The page builds the ZIP as usual, then `protectFullBackup` encrypts those bytes and the file is saved as `tablodge-full-YYYY-MM-DD.zip.enc`. Import recognizes the envelope magic, asks for the PIN or password, and passes the decrypted ZIP to the same reader as an unprotected backup. The worker never sees the credential or an encrypted file: it receives the same `RESTORE_FULL_BACKUP` message after the page has opened the file, so a wrong entry cannot change the library. Unprotected ZIPs import as before.

Two modules hold the reusable parts, so protected backups and the private library lock share them:

- `src/app/passcode.ts` defines the two credential types and one `validateCredential` check used by the forms and by encryption. A PIN is 0 to 9, 4 to 8 digits. A password is any characters, 8 to 128 (counted as characters, not UTF-16 units). The module also holds the warning text for weak PINs and for lost credentials. `src/app/passcode-fields.tsx` has the matching form pieces.
- `src/app/crypto-envelope.ts` uses Web Crypto only. PBKDF2-SHA-256 (600,000 iterations or more) derives an AES-GCM-256 key. The credential is normalized to NFKC first. Each encryption draws a fresh 16 byte salt and 12 byte nonce.

The envelope is self-describing, so the work factor can rise later without breaking older files. Integers are big-endian:

| Bytes | Field |
| --- | --- |
| 0 to 3 | Magic `TLEN` |
| 4 | Envelope version (1) |
| 5 | KDF id (1 is PBKDF2-SHA-256) |
| 6 to 9 | KDF iterations |
| 10, 11 | Salt length (16), nonce length (12) |
| then | Salt, nonce, and the AES-GCM ciphertext with its 16 byte tag |

The entire header is authenticated as additional data, so changing any header byte fails decryption. Reading refuses an unknown version or KDF, and a work factor above 20 million, before doing any key work. A wrong credential and a changed file both fail the authentication tag and give the same error, with no partial output. No credential, key, or hint is stored.

Automatic backups are JSON records kept in `chrome.storage.local` and optional JSON files in Downloads. They are not encrypted. The credential has nowhere safe to live in a service worker without being stored, so the worker does not encrypt them.

## Testing

The worker harness runs the source in a fresh Node VM with mocked `chrome.*` APIs. Fixtures start in the per-record layout; `legacyLayout: true` starts from the old single entry so the worker has to migrate it. `tests/library-state.test.ts` drives the storage module with a backend that loses or tears any call, including a crash at every step of a commit and of a migration, then resumes. A 10,000 tab test in `tests/service-worker.test.ts` prints the bytes written and the time per edit. Pure helpers also have direct unit tests. These tests cover storage and browser logic, not full browser behavior. Use the unpacked build for a manual smoke test, especially for worker restarts, native groups, split view, and side panel gestures.

`tests/manifest-targets.test.ts` covers the Firefox manifest, and the worker harness has a Firefox mode (`firefox: true`) for the differences above. `vp run browser:firefox` (`scripts/firefox-smoke-check.ts`) goes one level up: it installs `dist/tablodge-firefox/` as a temporary add-on in headless Firefox through Selenium and drives the worker with its own messages. It opens all seven pages, saves a window with a pinned tab and a tab group, restores it into a new window, adds a bookmark, imports browser bookmarks, exports a full backup, and checks that data survives a browser restart. It needs Firefox installed. Selenium downloads a matching geckodriver if there is none on the `PATH`, and `FIREFOX_BIN` overrides the browser binary. Safari has no automated check because it is not supported.
