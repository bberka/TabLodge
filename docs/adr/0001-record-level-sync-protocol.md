# 1. Record level sync protocol

Status: accepted, 2026-11-11. Issue #3.

## Context

Issue #3 asks for instant sync across devices, a paid hosted service on Cloudflare, and self hosting with Docker or Cloudflare. A change should reach the other online devices within about a second. A whole library snapshot with a conflict dialog cannot work at that speed, because two open devices would conflict almost all the time. The library layout from #21 already reserves a stamp, an order key, and a tombstone for every record (see [Sync reservations](../architecture.md#sync-reservations)), but nothing writes them yet.

## Decision

The unit of sync is one record: a session, a saved tab, a bookmark, a column, a folder, or a preference. The protocol code lives in `src/shared/sync/` and uses no browser or server APIs, so the extension, the Durable Object, and the Docker server share it.

* **Changes.** A change carries the whole record, its stamp, and its order key, or marks the record deleted. The server never looks inside the record. Tabs are keyed under their session, because tab ids are only unique inside a session, so moving a tab between sessions is a delete and a create.
* **Stamps.** A hybrid logical clock (`clock.ts`). The stamp `h` is the wall time in milliseconds and a counter, both fixed width base 36, so string order is causal order. Equal stamps are ordered by device id. A device moves its clock past every stamp it receives, so a device with a slow clock still writes after what it has seen. A stamp more than a day ahead of the receiver is refused, so one wrong clock cannot win every later edit.
* **Conflicts.** The change with the larger stamp wins, per record (last writer wins). Two edits to the same record at the same moment on two devices lose one of them. The data is links and names, and the trash and server side history make that recoverable, so this is accepted. A delete is a change like any other, so an edit newer than a delete brings the record back and an older one does not.
* **Order.** Siblings carry order keys (`order-key.ts`), the fractional index scheme from rocicorp/fractional-indexing (CC0). Moving an item rewrites only its own key. Adding items at either end increments an integer part, so keys stay a few characters long.
* **Server log.** The server gives every accepted change the next sequence number and keeps only the newest change per record (`change-log.ts`, the in memory reference). A device pulls the changes after its cursor in pages, so a device back from a month offline gets one change per record, not a replay. A push answers each change with `applied`, `superseded` (the server has a newer version, which the next pull brings), `stale`, or `clock`.
* **Tombstones.** Deletes are kept for a retention window and then purged. A device whose cursor is older than the newest purge has missed deletes it can no longer be told about, so the server answers its pull with `resync`. The device drops its copy and pulls everything again from cursor 0, in pages, so no response has to hold the whole library. A pushed change for a record the server has no trace of, stamped at or before the newest purged tombstone, is refused as `stale`, because the record may have been deleted and purged. The device reports refused changes instead of keeping them silently.

## Consequences

* The extension needs a sync engine in the service worker that turns commits into changes, keeps an offline outbox, and applies remote changes through the existing mutation queue. Pages never write synced data.
* The Durable Object and the Docker server implement the same rules as `ChangeLog` over SQLite. The reference stays the oracle their tests compare against.
* The retention window must be longer than any normal offline period. A device offline for longer resyncs and loses only edits to records that were deleted and purged meanwhile.
* The server sees record contents in plain text. Locked storage (#141) syncs only as an encrypted value.

## Considered and rejected

* **Whole library snapshots with a conflict dialog** (the original issue body). Too many conflicts at instant speed.
* **CRDTs per field.** More merge precision than links and names need, and a larger format that every server and client must implement.
* **Order as an array in the parent.** Every move would rewrite the parent and conflict with any other move in the same list.
