# 28. Library storage, private lock, and checked-data decisions that were code comments (src/shared)

Status: accepted, 2026-11-25. Issue #442.

## Context

This record covers the library storage (`library-state.ts`, `library-index.ts`, `library-values.ts`, `library-sync.ts`), the checks on untrusted data (`library-normalize.ts`, `trash.ts`, `passcode.ts`), and the private library's password lock and encryption (`private-lock.ts`, `private-sync.ts`, `crypto-envelope.ts`). Their non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The layout itself is in [ADR 25](0025-paged-library-layout.md). Sync records are in [ADR 27](0027-shared-sync-decisions.md).

## Decisions

### Stored layout (`library-state.ts`, `library-index.ts`)

* **Sessions and bookmarks have their own keys.** The index under `tablodge.state` names the key versions that make up the library. Before this, one value held everything, so saving one tab rewrote the whole library (`library-state.ts` header, [ADR 25](0025-paged-library-layout.md)).
* **Record keys are never edited in place.** An edit writes a new key, so the old version stays until the index stops naming it (`library-state.ts` header).
* **A commit writes record keys first, then the index.** The index write is the commit point, so a crash leaves the previous library or the new one, never a mix (`library-state.ts` header, `library-state.ts:write`).
* **Records a commit replaces are checkpointed only when an open checkpoint still needs them.** A failed copy costs the checkpoint, not the save (`library-state.ts:write`).
* **The migration keeps the old entry until it is verified and a week has passed.** The recovery copy under `tablodge.state.premigration` is kept for a week, not the "few days" the file header said (`library-state.ts:PREMIGRATION_KEEP_MS`, `library-state.ts:PREMIGRATION_KEEP_MS`).
* **The old entry stays the only authority until the final index write.** A migration can stop at any step and be repeated. The app's own loader is used for the old entry, so the records hold what the app showed before (`library-state.ts:migrate`).
* **Dev tools write the old layout.** They write the app's state shape without an index, which the migration reads as the old layout (`library-state.ts:migrate`).
* **Anything the records cannot hold is found before the first byte is written** (`library-state.ts:migrate`).
* **The migration marker names the keys before they are written,** so a crash mid-batch leaves nothing untracked. A resumed attempt skips records a previous attempt already wrote correctly (`library-state.ts:migrate`).
* **A failed migration keeps what went wrong in the marker,** for a bug report (`library-state.ts:migrate`).
* **Reads retry.** A commit that finished during a read removed keys the index pointed at, so the read runs again (`library-state.ts:read`).
* **Writes are batched by size.** The app sets and gets in batches of serialized characters and tabs, so one call never holds a huge value (`library-state.ts` storage batch constants).
* **Undo keeps only what an action replaced.** Everything else is still where the index says (`library-state.ts:Checkpoint`).
* **Old-layout entries come back as stored.** A library in the old layout, or one saved by a newer version, is not rewritten on read (`library-state.ts:read`).
* **Records keep their sync stamps.** An app edit never erases the sidecar, only the entries for tabs or bookmarks that are gone. Expired tombstones stop being carried (`library-state.ts:write`, `library-index.ts:SIDECAR`, [ADR 27](0027-shared-sync-decisions.md)).
* **Removing the library deletes the index first.** Unreferenced keys left by a crash are harmless. An index that points at nothing is not (`library-state.ts:remove`).
* **Verification re-reads every record the index lists** and compares it with the index. An empty result means the stored library is whole (`library-state.ts:verify`).
* **A checkpoint records its state by a token** that changes with every commit from any worker (`library-state.ts:checkpoint`).
* **Storage use includes the recovery copy and the marker** (`library-state.ts:LibraryState`).
* **Sync stamps stay on the record they belong to** (`library-index.ts:SIDECAR`).
* **Each record needs a stable, unshared id,** because sync addresses records by id (`library-index.ts:assertStableIds`).
* **Items are grouped into runs that stay under both limits, keeping order** (`library-index.ts:batches`).
* **A record that matches the stored one is not written** (`library-index.ts:planState`).
* **Sync data is carried, never trusted.** A malformed part is dropped, so it cannot make the library unreadable (`library-sync.ts:parseSync`, [ADR 27](0027-shared-sync-decisions.md)).
* **Hashes use cyrb53 on purpose.** A short, non-cryptographic hash is enough to spot a record, snapshot, or backup identical to a previous one. The loop uses a local binding, because a global `Math.imul` lookup per character is far slower in a worker sandbox (`library-values.ts:hash`).
* **JSON has sorted keys.** `chrome.storage` returns objects with sorted keys, so a record read back would otherwise serialize differently and every checksum would fail (`library-values.ts:canonicalJson`).
* **Bit operations are allowed in one file only.** The lint directive in `library-values.ts` carries that reason.

### Checked data (`library-normalize.ts`, `trash.ts`, `passcode.ts`)

* **Stored state, imports, and messages are checked field by field.** Unknown values fall back to defaults and limits are enforced. The service worker runs the same check on every read and write, and the pages and the Android app reuse its limits (`library-normalize.ts` module).
* **Loading never drops what is above a limit.** Limits apply to writes. A library can arrive larger through sync or a backup, and dropping on load would delete the rest on the next write (`library-normalize.ts:MAX_SESSIONS`).
* **Schema 10 keeps the data model of 9.** It only moved sessions and bookmarks to their own keys ([ADR 25](0025-paged-library-layout.md), `library-index.ts:SCHEMA_VERSION`).
* **Tab split pairs are kept only when complete.** Two neighbouring tabs with the same pair key, one at each position, and matching pinned and tab-group state keep their split. The left tab moves first if stored the other way. Orphans, reused keys, and mismatched pairs lose their split, and the tabs stay (`library-normalize.ts:pairSplits`).
* **Empty split keys are left out.** A missing split adds no `split: undefined` key (`library-normalize.ts:normalizeTab`).
* **Icons and colours are checked by a fixed list.** A column or folder keeps only a registry icon id. A column keeps a preset accent id or `#rrggbb`; `default` and `system` are dropped (`library-normalize.ts:iconField`, `library-normalize.ts:colorField`).
* **A note has a length limit.** The longest note a saved tab or bookmark keeps is fixed, and a bookmark's note is trimmed or dropped when empty (`library-normalize.ts:NOTES_MAX`, `library-normalize.ts:bookmarkNotes`).
* **Old sessions had a description and notes.** One field now holds both, and the room for both stays as it was (`library-normalize.ts:NOTES_MAX`).
* **The saving device is kept only when it has a name** (`library-normalize.ts:storedDevice`).
* **Synced preferences are kept as they are,** because the Android app reads the same keys. A synced setting takes two keys, its value and its change time. The app's test keeps under the limit, and an extension older than this limit still cuts at 20 keys (`library-normalize.ts:MOBILE_APP_KEYS_MAX`).
* **Unknown synced settings are held as plain JSON,** up to a size per value and a count. A value cut here looks deleted, and that delete would sync (`library-normalize.ts:normalizeHeldSettings`).
* **A held setting stands in for a missing one** once this version knows it (`library-normalize.ts:normalizeSettings`).
* **A blank new tab on Firefox is always enabled.** Firefox opens a new tab as a blank page before the add-on's page loads, so the worker cannot tell it from the dashboard and cannot hand it on (`library-normalize.ts:normalizeSettings`).
* **Hosts are compared in one place.** A trailing dot is dropped, so `bank.com.` and `bank.com` match (`library-normalize.ts:urlHost`).
* **Excluded sites are bare hosts,** and an entry covers the host and its subdomains. Old stored origins are accepted. The same rule is duplicated in `excluded-sites.ts` for the pages and the phone (`library-normalize.ts:normalizeExcludedHost`).
* **The Archived folder is created once and reused by name.** Every read normalizes the library, so the folder must come out the same each time, or sync would see a new folder on every read (`library-normalize.ts:folderEntriesWithArchive`).
* **Pinned tabs that were saved deliberately stay** even if the save setting is later turned off (`library-normalize.ts:storedDevice`).
* **Sessions archived by older builds become normal sessions,** and archived sessions without a folder move into the Archived folder (`library-normalize.ts:storedDevice`).
* **Trash entries over 200,000 characters stay on the device that deleted them.** The sync server refuses a larger change, and one refused change stops the whole push ([ADR 27](0027-shared-sync-decisions.md), `trash.ts:TRASH_SYNC_MAX_CHARS`). The cap counts characters, not bytes, so it does not guarantee the server's 256 KiB byte limit. Follow-up issue, not changed here.
* **Trash entries cache their size** on this device, so the size cap never serializes stored items again. The cache is never synced (`trash.ts:TrashEntry`).
* **Imports skip what is in the trash.** A session import skips deleted sessions and tabs; a bookmark import skips deleted bookmarks and columns. Folders hold no links (`trash.ts:trashedUrls`).
* **A password is never trimmed,** because spaces count. The limit counts characters, not UTF-16 units, and is checked after normalization, so the same text is accepted or refused whichever way it was typed (`passcode.ts:validateCredential`).
* **Opening is not checked, only setting.** Older versions let a person pick a PIN of 4 to 8 digits. Such a PIN still opens what it protected, because opening never checks the length. A value that already opened something is passed on as it is (`passcode.ts:validateCredential`).
* **Two entries are the same password when their derived keys match.** Full width and composed forms of the same text match (`passcode.ts:sameCredential`).
* **A short password gets a hint while it is typed,** because anyone who copies the file can try a short or digits-only password offline (`passcode.ts:weakPasswordHint`).

### Private library lock (`private-lock.ts`)

* **A random 256-bit data key encrypts every private value with AES-GCM.** A save costs no key stretching. The data key is wrapped in the credential envelope, and nothing derived from the credential is stored (`private-lock.ts` header, `crypto-envelope.ts`).
* **The data key is only in `chrome.storage.session`.** The browser keeps it in memory and never writes it to disk. It is gone after a restart, a reload, Lock now, or the idle timeout (`private-lock.ts` header, `private-lock.ts:LOCK_SESSION_KEY`).
* **Closing the last private window locks the library, but nothing wakes for that close.** The worker keeps the ids of the private windows open while unlocked and compares them with the windows that exist before it serves anything (`private-lock.ts:judgePrivateWindows`, `private-lock.ts:createPrivateLock`).
* **Window ids are judged as follows.** If a tracked window still exists, the session never ended: stay unlocked and track every open window. If none exists, or nothing was tracked, lock. This also covers windows that opened and closed while the worker slept (`private-lock.ts:judgePrivateWindows`).
* **Chromium window ids only go up while the browser runs,** and the tracked ids are cleared when it closes, so an id cannot come back for a different window (`private-lock.ts:judgePrivateWindows`).
* **Enabling and removing the lock rewrite every value, and both are resumable.** Each value is sealed or plain. Readers accept both. The lock record's `state` says which way the pass goes, so an interrupted pass finishes on the next unlock and never leaves unreadable data (`private-lock.ts:convertValues`, `private-lock.ts:finish`).
* **The data key goes to memory before the pass runs,** so an interrupted pass carries on without asking. If only the record survives, unlocking with the credential resumes it. The record goes last (`private-lock.ts:enable`, `private-lock.ts:finish`).
* **The sealed value names its storage key.** The key name is authenticated, so a sealed value cannot be moved to another key (`private-lock.ts:seal`).
* **Each conversion batch is one value at a time.** A cut-off pass leaves some values converted and the rest as they were; running it again finishes (`private-lock.ts:convertValues`).
* **The local keys the pass never seals** are the private config and the lock record (`private-lock.ts:convertValues`).
* **Without the worker's window list the library does not lock when the last private window closes.** A regular worker cannot see private windows (`private-lock.ts:createPrivateLock`).
* **A wrong credential costs a PBKDF2 run,** and after a few in a row the page waits (`private-lock.ts:LOCKOUT_BASE_MS`).
* **Activity is written at most once per interval** (`private-lock.ts:TOUCH_WRITE_MS`).
* **Storing, removing, and window checks of the key run one at a time.** A check never judges against a half-written unlock, and never removes a key a newer unlock stored (`private-lock.ts:createPrivateLock`).
* **A window list that cannot be read counts as no windows,** so the library locks rather than guessing (`private-lock.ts:createPrivateLock`).
* **The windows are written in the same call as the key.** If they cannot be read, none are tracked and the next read locks again (`private-lock.ts:unlock`).
* **A read that fetched the key before a lock must not use it.** The answer is checked inside the queue (`private-lock.ts:createPrivateLock`).
* **The lock record's kind is `password`.** Older `pin` records are read the same way and nothing changes (`private-lock.ts:LockRecord`).
* **The base64 helpers use the Uint8Array methods that Chromium lacks,** so the lint rule is disabled on those two lines, with the reason in each directive (`private-lock.ts:toBase64`, `private-lock.ts:fromBase64`).

### Private sync encryption (`private-sync.ts`)

* **Private sync uses its own random key.** The key is wrapped in the same credential envelope as the lock, and stored on the server with `POST /v1/key`. Every record value is sealed with that key, with the record key as authenticated data. The server sees which records exist and when they change, not what they hold (`private-sync.ts` header).
* **Another device joins with the same password,** and keeps the unwrapped key in its own private storage, which the local lock seals in turn (`private-sync.ts:joinSyncKey`).
* **Changing the password rewraps the same key.** Nothing is encrypted again, and other devices keep syncing. The `rewrap` case is written by one device and read by the others (`private-sync.ts:rewrapSyncKey`).
* **A library synced before any lock holds plain values.** A device with the key seals each one again as it pulls it (`private-sync.ts` header, [ADR 27](0027-shared-sync-decisions.md) `reseal`).
* **The private library's connection is the regular address with `/private`,** and the same token (`private-sync.ts:privateSyncTarget`).
* **A regular window opens Settings in a private window with a query** to turn private sync on there (`private-sync.ts:PRIVATE_SYNC_ASK`).

### Envelope (`crypto-envelope.ts`)

* **The envelope is versioned and self-describing.** PBKDF2-SHA-256 turns the credential into an AES-GCM-256 key. The work factor or the algorithm can change later without breaking old files (`crypto-envelope.ts` header).
* **Envelope version 1 layout:** magic `TLEN`, version 1, KDF id 1 (PBKDF2-SHA-256), 4-byte iteration count, salt length 16, IV length 12, the salt and IV (random per encryption), then AES-GCM ciphertext with its 16-byte tag (`crypto-envelope.ts` header, `crypto-envelope.ts:FIXED_HEADER_BYTES`).
* **The whole header is authenticated.** Any changed header byte fails authentication (`crypto-envelope.ts:encryptBytes`).
* **The credential is NFKC-normalized** before use, so the same text typed on another keyboard still matches (`crypto-envelope.ts:encryptBytes`).
* **Nothing derived from the credential, and no hint, is written** (`crypto-envelope.ts` header).
* **The work factor is OWASP's 2023 figure for PBKDF2-HMAC-SHA256.** Raise it in `crypto-envelope.ts:ENVELOPE_MIN_ITERATIONS`. Old files keep their own count (`crypto-envelope.ts:ENVELOPE_MIN_ITERATIONS`).
* **A file may ask for more work than this build writes,** but a hostile one cannot tie up the page for minutes. There is a cap on the iteration count, and a cap on the credential length (`crypto-envelope.ts:MAX_ACCEPTED_ITERATIONS`, `crypto-envelope.ts:MAX_DECRYPT_CREDENTIAL_LENGTH`).
* **A wrong credential and a changed file give the same error.** A caller learns nothing more from the failure (`crypto-envelope.ts:decryptBytes`).
* **Decryption returns all of the data or throws.** It never returns partial output (`crypto-envelope.ts:decryptBytes`).
