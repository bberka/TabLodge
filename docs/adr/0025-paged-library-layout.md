# 25. The library is stored in pages and chunks (layout 11)

Status: accepted, 2026-11-24. Issue #415.

## Context

Layout 10 kept every bookmark in one record and every session's summary in the index. One edit at 10,000 bookmarks wrote 6.4 MB (the bookmarks record, plus the Undo entry copying the replaced record), and one session rename at 10,000 sessions wrote 5.1 MB (the index, 3.4 MB). Round trips were 1 s and 2.8 s.

## Decision

* `tablodge.state` stays the commit point but lists pages: session entries in pages of 100 (`tablodge.sidx.<n>.<rev>`) and bookmarks in chunks of 100 (`tablodge.bmchunk.<n>.<rev>`), each with a hash and a count. Session records are unchanged. `schemaVersion` of the index is 11 (`LAYOUT_VERSION`). The data model keeps `SCHEMA_VERSION` 10, so exports, backups, and the Android app's library are unchanged.
* A page or chunk is cut by position. An edit rewrites the piece it falls in; an insert or a move rewrites the pieces it passes.
* Undo keeps the index it started from and the pieces the action replaced, nothing else.
* A layout 10 library is upgraded at the first worker start after the update, inside the mutation queue, after a safety backup. The new pieces are written under new keys and read back and checked; the single write of the new index is the switch. A failure before it removes what was written and leaves layout 10, which keeps working and is written as layout 10. The old index (`tablodge.state.preupgrade`) and the old bookmarks record stay for seven days.
* No sync protocol change. Sync sees the same logical library.

## Why it is one-way

A build that only knows layout 10 sees `schemaVersion` 11 and treats the library as "saved by a newer version": it shows the update message, refuses every write, and removes nothing. After the upgrade, going back to such a build loses no data but cannot use the library until the extension is updated again. Restoring the kept index by hand is possible during the week the copy is kept, but writes made since are not in it. A layout old builds could still read cannot write less, because they read one bookmarks record and check its hash.

## Consequences

* An edit writes the changed piece, the small root, and an Undo entry made of the same pieces.
* The root stays small, but the session entry list is still read whole on each commit (cached by page hash within a worker run).
* Reading the whole library still costs time proportional to its size. Since 2026-11-27 the common single record edits read only the pages and records they touch, and open pages apply the change (see [Scoped edits](../architecture.md#scoped-edits)).
