# 18. Android private library decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/src/private` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The private library's sync protocol is [ADR 2](0002-private-window-sync.md), and the envelope it uses is the extension's. The mobile area's first ADR is [ADR 17](0017-mobile-decisions.md). This file covers the private library folder only.

## Decisions

### Shape and storage

* **The private library is its own library, not a view of the regular one.** `src/private/private-library.ts`, the module header. It is edited like the regular library, with or without a server. Its data key is random. Only a copy wrapped by the password is kept, in the envelope the extension writes. The unwrapped key lives in memory while the library is unlocked.
* **The library is stored unsealed on the phone.** `private-library.ts`, module header. The password decides who can open it in the app. Sealing is for the server, which can then read nothing without the password.
* **A library with no password does not sync.** `private-library.ts:runClient`. What it would send would not be sealed.
* **Lock changes run one at a time.** `private-library.ts:serial`. The steps that change the library (set up, join, erase) share one queue. Each checks the lock again inside it, so a step that started earlier cannot overwrite one that ran first.
* **A change count tells a slow join that the library changed under it.** `private-library.ts:epoch`.
* **The wrapped data key is the lock.** `private-library.ts:setLock`. The lock record holds the id and the wrapped key. Its `kind` field (`pin` or `password`) from older versions is ignored, and none is written.
* **A library that kept the server's key takes the lock only from a credential that opens that key.** `private-library.ts:openFromServer`.

### Sync rounds

* **A round of a stopped client does nothing more.** `private-library.ts:createClient` and `activeClient`. Each client has a number. A round whose number is no longer active (the library locked, was erased, or took another lock) neither sends, reads, nor writes. `live` throws after every awaited request, before the lock is touched.
* **A protected library puts its key on an empty server.** `private-library.ts:baseCodec`. When the server's library has no key yet, the server holds only sealed values from then on.
* **A protected server library whose key this phone lacks stops the round.** `baseCodec`. The round throws `NEEDS_KEY_MESSAGE` and sends nothing in plain.
* **A password change here reaches the server, even after an offline change.** `baseCodec`, the `key` write. The server's copy is replaced, unless another device changed it first, and then that device's copy wins.
* **Another device's rewrap of the same key is kept.** `baseCodec`, the `kept` branch.
* **A round that outlived its key sends no plain records.** `private-library.ts:createClient`, the `held` checks.
* **A trash write waits for the library write before it.** `private-library.ts:createClient`, the `trash` wrapper. An erase may have overtaken the earlier write.
* **Stopping the client drops its sync position.** `private-library.ts:stopClient`. A server connected later gets the whole library again. The library on the phone stays.

### Keys, erase and startup

* **The kept key is in the Android keystore.** `private-library.ts:KEPT_KEY`. It is stored after the password was removed, so the library can keep syncing with a server that holds it sealed. The server token is kept there too.
* **Erase writes a marker before it deletes anything.** `private-library.ts:ERASING_KEY`. The marker is removed when the erase is done, so an erase that stops part way is finished at the next start.
* **A join's lock write can be half done, so the next start checks the credential again.** `private-library.ts:adopting`.
* **An erase in progress keeps the library out of reach.** `private-library.ts:erasing`. Nothing syncs until the erase finishes.
* **Before anything is deleted, a failure changes nothing.** `private-library.ts:eraseNow`. After that, the marker keeps the library out of reach until it is finished.
* **Trash changes already queued finish before the deletions.** `eraseNow`. A stopped client queues no more.
* **Erase steps run in a fixed order.** `private-library.ts:eraseSteps`. The library marker is removed near the end, and the erase marker last.
* **An unfinished erase is finished before a library is made over what is left.** `private-library.ts:startPrivate`.
* **An unlock is kept even when the status read fails.** `private-library.ts:unlockPrivate`. The key is in before the status is read.
* **A password check that outlives the library's state is dropped.** `unlockPrivate`. If the library was erased, set up again, or given another lock while the password was checked, the unlock does nothing.
* **Setting a password on a library that has none sends every record again.** `private-library.ts:protectPrivate`. Each record goes again, sealed with the new key.
* **Changing the password rewraps the same key.** `private-library.ts:changePrivateLock`. Nothing is encrypted again. The server's copy follows at the next round, and other devices keep their copy of the key.
* **A new library never reuses a server's key.** `private-library.ts:setupPrivate` and `protect`. A key kept from the server is tied to that server's credential, so a new library always gets a key and a lock of its own.
* **Startup reads the old unwrapped key only to move it.** `private-library.ts:startPrivate`. See Excuses.

### Joining a server's library

* **The server's key request has a time limit.** `private-library.ts:SERVER_CHECK_MS`, 8 s. A slow server would otherwise hold the drawer open.
* **A server that cannot be asked is not the same as a server with no key.** `private-library.ts:serverKey`. An answer that is not a key is an error.
* **The server information says whether the phone can sync.** `private-library.ts:privateServerInfo`. `failed` is true when the server could not be asked. The drawer then offers a retry, or a phone-only library.
* **A join keeps what the phone already has.** `private-library.ts:openFromServer`. The phone's library takes the server's lock, and its records sync with the server's.
* **A join commits alone and checks again.** `openFromServer`. A set-up, an erase, or a dismissed drawer that came during the waits wins over the join.
* **The last check comes before the change, with nothing awaited in between.** `openFromServer`. The lock and the key it opens change together in memory. Only then are the writes awaited, so no sync round can pair the server's lock with the phone's old key.

### Locking and autolock

* **Locking a library with no password only goes back to the regular library.** `private-library.ts:lockPrivate`. Locking forgets the key and stops syncing. The data stays on the phone.
* **Any touch restarts the idle wait.** `src/private/private-autolock.ts:markActive`.
* **Background locking is a fallback for builds without the screen-off signal.** `private-autolock.ts:startPrivateAutoLock`. See Excuses.

### Sheets and forms

* **Only one drawer is open at a time.** `src/private/private-sheets.tsx:set`.
* **A new password is typed twice.** `private-sheets.tsx:SetupForm`.
* **A short password or one of only digits is allowed with a note.** `SetupForm`, `weak`. The note never blocks saving.
* **A dismissed drawer's result never changes the screen.** `private-sheets.tsx:UnlockForm` and `ServerForm`, the `dismissedRef` checks.
* **Unlocking waits for an erase.** `UnlockForm`. A library being deleted cannot be opened.
* **A form that is saving blocks the choice between the two paths.** `private-sheets.tsx:FirstPin`. A pending join cannot land after a local save.
* **A server's protected library asks for its password first.** `FirstPin`. When the connected server already holds a private library, its password comes first. The drawer offers a phone-only library when the server cannot be asked, and that library does not sync until the password is entered from Settings.
* **Erase asks first, and a failure leaves the library as it was.** `private-sheets.tsx:confirmErase`. Both entry points use it.
* **An erase failure says how far it got.** `private-library.ts:eraseFailureNotice`. A failure that did not start changed nothing. One that stopped part way is finished later.
* **The status hint is always mounted.** `private-sheets.tsx`, the `accessibilityLiveRegion` hint. TalkBack announces it when its text arrives.

### Switch

* **Locking from the switch drops the key at once.** `src/private/private-switch.tsx:lockNow`. Opening the library again asks for its password.
* **The switch shows where the setting says.** `private-switch.tsx:PrivateSwitch`. As a header icon it appears when the setting is on, and while the library is open. With `button` it is a labeled button that is always there, for Settings.
* **The first use makes the library.** `PrivateSwitch`. It asks for a password the first time, and again at each lock.

## Excuses

Three hacks in this folder were justified by comments. Those comments are deleted. The hacks, and their fixes, are listed in #491.

* `src/private/private-library.ts:startPrivate` moves a server key an earlier version kept unwrapped in the keystore.
* `src/private/private-autolock.ts:startPrivateAutoLock` locks on background in `screen` mode on builds without the screen-off signal.
* `src/private/private-library.ts` accepts a library with no password, from an earlier version, and does not sync it.
