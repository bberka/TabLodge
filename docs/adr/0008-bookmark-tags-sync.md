# 8. Bookmark tags sync as their own record kind

Status: accepted, 2026-11-20. Issue #344.

## Context

Bookmarks gained tags. Most of them come from the address: a link's kind (movie, video, repo, read, and so on) is worked out from host and path rules in `link-kind.ts` each time it is drawn. The person can also type their own tags, and can remove the automatic kind from one bookmark so it stays removed.

The kind needs no storage. The typed tags and the removed kinds do, and they must sync. ADR 5 found that extensions from v0.2.0 to v0.3.0 rebuild every pulled bookmark from the fields they know and push the result back. A `tags` field inside the bookmark record would be erased on every device by one extension that has not updated.

## Decision

* Typed tags and removed kinds travel as one record of kind `tag`, keyed by the bookmark id, with the value `{tags?, hiddenKinds?}`. A bookmark with neither has no `tag` record, and its bookmark record is the same as before.
* In the library, `bookmark.tags` and `bookmark.hiddenKinds` stay optional lists on the bookmark. `splitLibrary` moves them into the `tag` record, and `assemble` puts them back.
* Both lists are normalized the same way on every device (`bookmark-tags.ts`): tags in lower case without the device's language, in the order given, each once; removed kinds in one fixed order. Two devices therefore never write different values for the same record and send it back and forth.
* Clients send and pull `tag` records only when the server lists `tags` among the `features` of `/v1/status`, as with `notes`. Against an older server, tags stay out of capture and out of the outbox, and a resync does not count them as deleted.
* A `tag` record that arrives before its bookmark waits in `held`. Deleting a bookmark removes its `tag` record.
* The kind itself is never stored or synced, so a better rule reaches every saved link at once, with no backfill.
* `PROTOCOL_VERSION` stays 1.

## Consequences

* Older clients skip the unknown kind, so they never see tags and cannot erase them. Their edits to the bookmark itself still sync, and the tags stay attached.
* Tags reach other devices only once the server is updated.
* One record holds both lists, so an edit to tags on one device and to removed kinds on another at the same time keeps only the later edit. Both are changed in the same editor, so this is rare.
