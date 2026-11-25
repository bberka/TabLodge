# 27. Sync protocol, client, and engine decisions that were code comments (src/shared/sync)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/src/shared/sync/` holds the sync protocol (`change-log.ts`, `changes.ts`, `clock.ts`, `shared-pages.ts`), the device side of sync (`engine.ts`, `order-key.ts`, `library-records.ts`), the client the service worker runs (`client.ts`), and the server checks (`compat.ts`, `shared-pages-client.ts`). Its non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The record format and the settings split are in [ADR 1](0001-record-level-sync-protocol.md), [ADR 5](0005-bookmark-notes-sync.md), [ADR 8](0008-bookmark-tags-sync.md), [ADR 9](0009-sources-settings-sync.md), [ADR 10](0010-settings-sync.md), and [ADR 11](0011-setting-sync-scopes.md). Shared pages are in [ADR 12](0012-shared-page-import.md) and [ADR 13](0013-live-shared-pages-and-passwords.md). Those are referenced, not repeated.

## Decisions

### Server change log (`change-log.ts`)

* **Only the newest change per record is kept.** A device back online after a long time gets one change per record, not a replay (`change-log.ts:ChangeLog`). Tombstones are kept for a retention window, then purged (`change-log.ts:SyncLog.purge`).
* **Each pull carries the purge marker.** `purged` is the highest sequence number among purged tombstones. The device sends back the value it last saw (`seen`). If a purge since then removed tombstones after the device's cursor, the device missed deletes it cannot be told about, so it pulls from cursor 0 again (`change-log.ts:mustResync`).
* **A device paging through a fresh pull is not sent back to the start.** Purges older than its first page took nothing it had (`change-log.ts:mustResync`).
* **Four push outcomes.** `applied`: the change is the record's current version. `superseded`: the server has a newer one, which the device gets on its next pull. `stale`: the server has no trace of the record and the change is older than the purge horizon, so the record may have been deleted and purged; accepting could bring it back. `clock`: the stamp is too far in the future (`change-log.ts:PushResult`, `pushResult`).
* **The protocol version moves rarely.** Bump `PROTOCOL_VERSION` only for a change older devices cannot follow. A server and a device on different versions do not sync (`change-log.ts:PROTOCOL_VERSION`).
* **The server's cursor can be behind the device's.** That is how a device notices a server restored from an older backup (`change-log.ts:ChangeLog`, `engine.ts:receive`).
* **The wrapped library key is stored, not read.** The server keeps it for the devices and never reads it. `replaceKey` swaps it only while the expected key is still there, so two devices cannot overwrite each other's key (`change-log.ts:SyncLog.replaceKey`).

### Change and merge rules (`changes.ts`)

* **Last writer wins by stamp alone.** Replicas that see the same changes end with the same library whatever order the changes arrive in (`changes.ts:supersedes`, `changes.ts:mergeInto`).
* **Equal stamps are one write.** A change with the same stamp as the current one is not applied twice (`changes.ts:supersedes`).
* **Deletes stay as tombstones.** A later, older edit cannot bring a deleted record back (`changes.ts:mergeInto`).
* **Tabs are keyed under their session.** A tab's id is unique only inside its session, so moving a tab to another session is a delete in one and a create in the other (`changes.ts:recordKey`).
* **Network changes are checked field by field.** A malformed change is dropped here. Its value is checked later, by the code that applies it to the library (`changes.ts:parseChange`).

### Clock (`clock.ts`)

* **Stamps sort as strings.** `h` is the wall time in milliseconds and a counter, both fixed-width base 36, so string order is causal order. Equal `h` is ordered by device id (`clock.ts:WALL_WIDTH`, `clock.ts:compareStamps`).
* **Wall time never goes back, and a received stamp moves the clock past it.** A device with a slow system clock still writes stamps that win over what it has seen (`clock.ts:tick`, `clock.ts:observe`).
* **A stamp far in the future is refused.** More than `MAX_CLOCK_DRIFT_MS` ahead of the receiver, so one device with a wrong clock cannot win every later edit (`clock.ts:MAX_CLOCK_DRIFT_MS`, `clock.ts:observe`).
* **`stampAt` gives the smallest stamp at a wall time,** so a time can be compared with stamps as strings (`clock.ts:stampAt`).

### Client and sync rounds (`client.ts`)

* **Storage, network, and library come in through `SyncHost`.** The tests drive the client against the reference server in memory (`client.ts:SyncHost`).
* **A round stamps local edits, pulls the server's changes page by page, applies the complete pull, then pushes the outbox.** Library reads and writes run inside the worker's mutation queue (`host.mutate`). Network calls run between them, so a slow server does not hold up the app. Rounds never overlap: a request made during a round runs one more round after it (`client.ts:syncNow`, `client.ts:round`).
* **Sync is on unless `false` is stored.** Only an explicit `false` turns settings sync off (`client.ts:SYNC_SETTINGS_KEY`).
* **A private window's worker nudges the regular worker.** Split workers cannot message each other but share local storage, so the nudge key tells the regular worker, which runs sync, to send the change now (`client.ts:SYNC_NUDGE_KEY`).
* **A fallback alarm every five minutes** reopens a closed live socket and catches up (`client.ts:SYNC_ALARM_MINUTES`).
* **Chrome ends an idle extension worker after 30 seconds.** A WebSocket that exchanges messages keeps it alive, so the client pings every 20 seconds (`client.ts:PING_MS`).
* **A server's answer about itself is trusted for ten minutes** before it is asked again (`client.ts:FEATURE_CHECK_MS`).
* **A new server token is 32 random bytes as 64 hex characters,** which paste cleanly into any form (`client.ts:createSyncToken`).
* **Optional record kinds sync only when both sides support them.** The kinds are trash, notes, tags, Sources, and settings (`client.ts:OPTIONAL_KINDS`). The round checks each one against the server's feature list (`client.ts:round`).
* **An old server refuses an unknown kind, which would stop every round.** So optional kinds wait until the server lists them. A server speaking another protocol stops the round, and that answer is not kept, so the round after the server's update goes ahead (`client.ts:serverFeatures`).
* **A failed status request ends the round.** Taken as "no features", it would make the pull skip the optional kinds while the cursor moves past them, and this device would never receive them (`client.ts:serverFeatures`).
* **A round that cannot hold a kind leaves its records alone.** They stay on the device, unsent, and are not counted as deleted (`client.ts:unsupported`, `client.ts:resyncSupported`).
* **Stamping skips the kinds a device does not sync.** Otherwise their records would look deleted (`client.ts:captureExcept`).
* **A setting is left alone until a pull has taken it once.** Most settings existed in 0.3.0 without syncing, so each browser holds its own values and the phone holds the defaults. Stamped first, each would overwrite what the server has (`client.ts:leftAlone`).
* **A pull is collected whole before it is applied.** Records arrive in the order the server last changed them, so a tab can arrive before its session and a bookmark before its column. Applied page by page, the library would drop the tab or move the bookmark, and the next capture would send that loss to every device (`client.ts:round`).
* **A newly taken optional kind pulls from cursor 0 as a resync.** Earlier pulls left the kind behind the cursor. The server checks purged deletes only past cursor 0, so a record deleted elsewhere would otherwise stay. Stamps decide record by record (`client.ts:round`).
* **A server behind this device starts over.** It was restored from an older backup or replaced. Only the last page says where the server is (`client.ts:round`, `engine.ts:restartAfterServerReset`).
* **A library that never synced gets a safety backup** before the server's copy is written over it (`client.ts:round`).
* **A shadow entry that matches nothing makes the next capture stamp the record again,** so it is sent encrypted. The entry stays, so a setting back at its default still counts as synced (`client.ts:round`, `client.ts:resendAll`).
* **A record that changes while it is being sent goes out next round.** A value that keeps changing cannot keep one round pushing (`client.ts:round`).
* **The server took more changes than this round applied** (another device pushed in between, and its live notice may already have been dismissed as this device's own echo). The round pulls again (`client.ts:round`).
* **The highest cursor seen is compared once the round ends.** A notice for this device's own push can arrive before the push's answer, so notices are not compared on arrival (`client.ts:seenCursor`, `client.ts:noticed`).
* **Going offline says nothing new about the server,** so what was known about it stays (`client.ts:connect`).
* **A reconnect asks the server again.** It may have been updated while the socket was closed (`client.ts:openLive`).
* **Pausing sends a waiting change first,** then closes the socket and timers so nothing wakes the radio. `wake` starts it again (`client.ts:pause`).
* **The server URL must be HTTPS,** because the token and the library travel with every request. Plain HTTP is allowed only for a server on this computer (`client.ts:parseServerUrl`, `client.ts:LOCAL_HOSTS`).
* **An encrypted library needs a codec before any request.** The codec runs before each round, so an unsupported server gets no key, pull, or push (`client.ts:SyncCodec.prepare`). A value that arrived unencrypted is sent again encrypted (`client.ts:SyncCodec.open`).
* **The trash, Sources choices, and outside settings are optional hosts.** Without a host they stay on the device. Sources and outside settings sync only in the regular library (`client.ts:SyncHost`).
* **Outside settings and Sources respect local edits.** The `was` values say what each one held when this round read it. A value changed since was edited in Settings meanwhile, so the host keeps that edit and this round's push sends it (`client.ts:SyncHost.sources`, `client.ts:SyncHost.outsideSettings`).
* **The host normalizes what sync writes.** Synced records are untrusted input, so `writeLibrary` runs them through the same normalization as any other input (`client.ts:SyncHost.writeLibrary`).
* **A read-only device never sends.** It pulls and applies, even after a server reset or a restore that would otherwise send everything again. A library shown read-only uses this (`client.ts:SyncHost.readOnly`).
* **A library that goes encrypted resends every record** with a new stamp (`client.ts:resendAll`).

### Engine (`engine.ts`)

* **The engine is pure functions over `SyncState` and the records.** The worker runs four steps around its network calls: `capture` stamps and queues local edits, `outgoing` gives the queued changes, `settle` takes the answers, `receive` applies pulled changes (`engine.ts` module).
* **Local edits are found by comparing with a shadow.** The shadow holds each record's stamp, order key, and content hash as last agreed with the server. The rest of the worker needs no sync code (`engine.ts:capture`, `engine.ts:SyncState`).
* **A change leaves the queue only when the server answered it.** A record edited again since it was sent stays queued (`engine.ts:settle`).
* **The cursor stays after a push.** The push's own changes return in the next pull and are recognized by their stamps (`engine.ts:settle`).
* **`refused` counts the stale and clock refusals** so the app can report them (`engine.ts:settle`).
* **A new device takes the server's copy of records both sides have.** `joined` stays false until the first full pull (`engine.ts:SyncState`).
* **A change waits for its parent.** A tab waits for its session, a bookmark for its column, a session for its folder, unless the parent is known deleted. Applied without its parent, the library would drop or move it, and the next capture would send that loss back. Waiting changes sit in `held` (`engine.ts:receive`, `engine.ts:parentOf`).
* **Parents apply first.** Each pass repeats while it applies something, so a folder, then its session, then its tabs all land (`engine.ts:receive`).
* **A stamp far ahead is ignored.** The server should have refused it (`engine.ts:receive`).
* **Tombstones are forgotten after 90 days,** the server's default retention. `capture` removes them only while it runs, and keeps any whose key is still in the outbox, so they can outlast 90 days while sync is offline (`engine.ts:TOMBSTONE_KEEP_MS`, `engine.ts:capture`).
* **Order keys keep the longest increasing run.** A move or insert changes only the records that moved or were added, in O(n log n) (`engine.ts:orderList`).
* **`startResync` removes what it does not see.** Records synced before and not seen again by the end of the pull were deleted while this device was away (`engine.ts:startResync`, `engine.ts:finishResync`).
* **`restartAfterServerReset` queues every record, deletes included.** The stamps decide record by record, so the server gets back what it lost and the device keeps what is newer (`engine.ts:restartAfterServerReset`).

### Records (`library-records.ts`)

* **A library splits into records by kind.** Each folder, session (without its tabs), saved tab, column, bookmark, and portable setting is one record. Order is not part of a record's value. Siblings share an order group, and the engine gives each one a key (`library-records.ts:splitLibrary`, `library-records.ts:orderGroup`).
* **0.3.0 keeps the list of preferences it syncs.** That list is closed. A setting added later is a `setting` record, which 0.3.0 skips instead of erasing (`library-records.ts:PORTABLE_PREFERENCES`).
* **Every library setting has a sync scope.** A new key without one in `setting-scopes.ts` fails to compile here (`library-records.ts:SETTING_KEYS`, see [ADR 11](0011-setting-sync-scopes.md)).
* **A `setting` record that holds its default is not sent.** A phone or a new browser holds every default without choosing it, and sent first it would overwrite what another device chose (`library-records.ts:isUntouchedDefault`).
* **An unknown `setting` record comes back unchanged.** It is held in `heldSettings` and sent back as it came (`library-records.ts:assemble`, see [ADR 10](0010-settings-sync.md)).
* **A Sources choice is read and taken back as the host gave it.** A site or field this version does not know goes back unchanged (`library-records.ts:SyncedSource`, `library-records.ts:sourcesOf`).
* **Some fields never travel.** The browser window a session came from, its window position, and when it was last opened here stay on this device. `assemble` keeps this device's values (`library-records.ts:assemble`).
* **A missing value has nothing to send.** A change always carries a value or a delete (`library-records.ts:splitLibrary`).

### Order keys (`order-key.ts`)

* **Fractional indexes from rocicorp/fractional-indexing (CC0).** An item's key sorts between its neighbours, so a move rewrites only its own key (`order-key.ts` module).
* **The first character gives the integer's length.** Adding at either end only increments or decrements the integer, so keys grow with the log of the list length. A fraction never ends in `0` (`order-key.ts:DIGITS`).
* **A key longer than 64 characters is refused.** It means something keeps inserting at one spot (`order-key.ts:MAX_KEY_LENGTH`).
* **`increment` and `decrement` return undefined past the ends** of the integer range (`order-key.ts:increment`, `order-key.ts:decrement`).

### Server checks (`compat.ts`, `shared-pages-client.ts`)

* **A different protocol stops sync; a missing feature only leaves its part on the device.** Both apps show the result in Settings › Sync with the same words (`compat.ts:updateSide`, `compat.ts:problemBanner`).
* **Old servers say less.** A server with no version reports `null`, an unreleased build reports `0.0.0`, and a server with no feature list supports no optional part (`compat.ts:ServerInfo`, `compat.ts:parseServerInfo`).
* **Release numbers stay below 1000,** because Android's version code is built from them (`compat.ts:PROTOCOL_RELEASES`, `scripts/release-version.ts`).
* **`PROTOCOL_RELEASES` gets an entry whenever `PROTOCOL_VERSION` moves** (`compat.ts:PROTOCOL_RELEASES`).
* **`SERVER_FEATURES` names the first release with each feature,** so the banner can say which release to install (`compat.ts:SERVER_FEATURES`, `compat.ts:releaseWithAll`).
* **A stopped sync cannot be dismissed.** Missing features can, and the banner returns when the server version or the missing features change (`compat.ts:dismissKey`).
* **The dismissed banner stays on the device.** It never syncs (`compat.ts:SYNC_DISMISSED_KEY`).
* **Shared pages are stored as they came.** The server never reads library records for them (`shared-pages.ts` module).
* **A shared page id is 22 random base64url characters (132 bits),** so a link cannot be guessed (`shared-pages.ts:SHARED_PAGE_ID`).
* **A server without shared pages, or one that refuses the token, counts as `old` or `offline`.** `keepsIds` says the server keeps the id a device sends, so a page can carry its own link (`shared-pages-client.ts:sharedPagesSupport`, see [ADR 12](0012-shared-page-import.md)).
* **Each upload is a new link.** The old one stays until it is deleted. The id and source are sent only to a server that keeps them (`shared-pages-client.ts:uploadSharedPage`).
* **A page already gone counts as deleted** (`shared-pages-client.ts:deleteSharedPage`).
