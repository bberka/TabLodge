# 13. Send to private storage

Status: accepted, 2026-11-21. Issue #459.

## Context

The maintainer asked for a **Send to private storage** action on links in sessions and bookmark columns, available when private windows use a separate saved library. That library is encrypted with a random data key, which lives only in the private worker's session storage while the library is unlocked ([ADR 2](0002-private-window-sync.md)). A regular window is where people find the link, and the private library is usually locked there. The regular window must never be able to read private contents, and no plaintext copy of a sent link may stay behind.

## Decision

* **Move, with Undo.** The link leaves the regular library without the trash, because the trash syncs with the whole link. The regular server sees an ordinary delete, so nothing new goes on the wire and v0.3.0 clients keep working.
* **An encrypted inbox, not the password.** The private library keeps an ECDH P-256 key pair. The private key is stored inside the sealed library, the public key in plain local storage. A regular window seals each send to the public key with an ephemeral key, HKDF-SHA-256 and AES-GCM, with the entry id and the ephemeral key as authenticated data, and stores it under a key of its own. It never asks for the password and never touches the data key or the private library, unlocked or not. A library set up before this has no key pair until its next unlock, so the action says to open a private window until then.
* **One key per entry, outside the private prefix.** `tablodge.sendprivate.entry.<id>` is outside `tablodge.private.`, so the lock's sealing pass does not rewrite it and the private library's change events do not carry it. Separate keys mean the regular worker that appends and the private worker that drains never overwrite each other's writes.
* **Held while Undo is offered.** An entry carries a plain `holdUntil`, the end of the Undo window, and the private worker leaves it alone until then. Closing the toast clears it and deletes the Undo record and the library's garbage keys, so the regular side then holds no copy. Undo deletes the entry with the regular library's checkpoint; once the private library has taken it, Undo is refused instead of leaving two copies.
* **A fixed landing column.** Links land as bookmarks in the column `sent-from-regular-windows`, named "Sent from regular windows". The id is the same on every device, so private sync merges two devices' columns into one, and the normalizer of every version accepts it. An address already in that column is not added again, which also makes a take-in that was cut off before its entries were deleted harmless.
* **Android: a pending list, unsealed.** The phone stores its private library unsealed in the app's private database, and its native crypto module has only AES-GCM. Sent links wait in `tablodge.sendprivate.pending` in the same database, as protected as the library, and move in when the private library next opens. The snackbar's Undo holds an entry in memory; after a restart nothing is held. No new native crypto was added.
* **Scope.** Single links and selected links. Whole sessions and columns are left for later. Android has no link selection inside sessions, so there a session link goes one at a time.

## Consequences

* Anyone who can write extension storage can add links to the private library, as they could already change the regular library. They cannot read what was sent.
* The entry shows that something was sent and when, but not what.
* Snapshots and backups made before a send still contain the link. They are not rewritten.
* A link sent while the private library never unlocks again stays on the device in its sealed entry. Erase private data deletes it.
