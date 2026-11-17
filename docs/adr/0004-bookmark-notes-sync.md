# 4. Bookmark notes sync as their own record kind

Status: accepted, 2026-11-17. Issue #276.

## Context

Bookmarks gained an optional `notes` string. Each app edits, shows, searches, exports, imports, and backs it up without a server, and sync only carries it between devices. The plan was to send it inside the bookmark record and rely on older clients ignoring an unknown field.

They do not ignore it. Extensions with sync (v0.2.0 to v0.3.0) run every pulled record through `normalizeBookmark`, which rebuilds a bookmark from the fields it knows and drops `notes`. The next capture sees the stripped copy as a local edit and pushes it with a newer stamp, so one extension that has not updated yet erases the note on every device. Nobody has to edit anything for this to happen. The Android app and the server keep unknown fields, but that does not help.

Raising `PROTOCOL_VERSION` would prevent the loss. It would also stop every updated client from syncing with a self hosted server that has not been updated, and the other way round.

## Decision

* A note travels as a record of kind `note`, keyed by the bookmark id, with the value `{notes}`. A bookmark without a note has no `note` record, and its bookmark record is the same as before, so updating causes no resend.
* In the library, `bookmark.notes` stays a plain optional string. `splitLibrary` moves it into the `note` record, and `assemble` puts it back.
* Clients send and pull `note` records only when the server lists `notes` among the `features` of `/v1/status`, the same check the trash uses. Against an older server, notes stay out of capture and out of the outbox, so they stay on the device and the rest of the library syncs as before.
* A `note` that arrives before its bookmark waits in `held`, like a bookmark that waits for its column. Deleting a bookmark removes its `note` record, and the next capture sends that delete.
* `PROTOCOL_VERSION` stays 1.

## Consequences

* Older clients skip a kind they do not know, so they never see a note and cannot erase one. Their edits to the bookmark itself still sync, and the note stays attached.
* Notes reach other devices only once the server is updated.
* A future field that older clients would drop needs the same treatment. #277 (saving a quote) writes into `bookmark.notes`, so it needs nothing more.
