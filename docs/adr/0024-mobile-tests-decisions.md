# 24. Android test decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/tests` carried its test scope and its fixture decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here, with the test file or fixture that holds it. The proof for what a suite cannot show is in [Android app](../agents/mobile.md) (the emulator and the live check). The mobile area's other decisions are in [ADR 20](0020-mobile-decisions.md) to [ADR 23](0023-mobile-screens-decisions.md), and the private library and settings in [ADR 18](0018-mobile-private-decisions.md) and [ADR 19](0019-mobile-settings-decisions.md).

## Decisions

### What the suites prove, and what they cannot

* **The backup suite runs the phone's full backup against the extension's own code, both ways.** `tests/backup.test.ts`, with and without a password. The password wrap runs the native module's stand-in, so it cannot show that the Kotlin module wraps a whole backup file. `tests/phone-crypto-vectors.test.ts` shows the envelope for a small payload.
* **Background sync runs against the real library and client, with WorkManager replaced.** `tests/mobile-background-sync.test.ts`. The suite cannot show that Android runs the task with the app closed. The pull request shows that on an emulator.
* **Background sync loads the app's modules again, as Android does when it starts the process only to run the task.** `tests/mobile-background-sync.test.ts`, the reload step.
* **Scheduling is checked after the change that asked for it.** `tests/mobile-background-sync.test.ts:settlesAt`.
* **The widget suite cannot show that the Kotlin widget draws what it is given.** `tests/mobile-widget-sync.test.ts`. The writer's output is checked; the drawing is not.
* **The private library suite replaces the crypto module with a Node stand-in.** `tests/private-library.test.ts`. It cannot show that the Kotlin `TablodgeCryptoModule` behaves like its stand-in, or anything on screen.
* **The undo suite runs against the Docker server's SQLite and the extension's sync client.** `tests/mobile-undo-sync.test.ts`. A restore that the server refuses to bring back shows up as two libraries that differ.
* **The live check is skipped unless `TL_STEP` is set.** `tests/live/peer.test.ts`. It uses the extension's own sync client, private codec and key code over real HTTP. The steps are in [Android app](../agents/mobile.md#live-check-on-an-emulator).
* **The `app-*` live steps work on the regular library; the others work on the private one.** `tests/live/peer.test.ts`.

### Fixtures and stand-ins

* **The phone's crypto is checked against the extension's reader with output from a device.** `tests/phone-crypto-vectors.test.ts`. The fixture was captured from a release build on an emulator: a data key was wrapped with the password (`wrapKey`) and a bookmark sealed with it (`sealValue`). A Web Crypto reader in Node must read both. The other direction, the extension's output opened by the Kotlin module, can only be shown on a device.
* **The stand-in follows the Kotlin contract.** `tests/support/fake-crypto.ts`. It uses Web Crypto and the same contract as `modules/tablodge-crypto`.
* **The stand-in's wrap work factor is low.** `tests/support/fake-crypto.ts`. The envelope records the factor, and the extension's reader honours it, so a test does not wait on the full factor each time.
* **The server is the real API over the real change log.** `tests/support/world.ts`. It runs in two libraries, as `node.ts` serves them: the regular one and `/private`.
* **The extension side is wired to memory as its service worker wires it to extension storage.** `tests/support/world.ts`.
* **Enabling private sync on the server mirrors the service worker.** `tests/support/world.ts`, the extension's `enablePrivateSync`. A library with a password and no key on the server yet puts its key there. When the server already holds one, the password is entered once. Rewrapping keeps the same key.
* **Preferences and storage live on `globalThis`.** `tests/support/fake-preferences.ts` and `tests/support/memory-storage.ts`. A test that loads the app's modules again, as a restart does, still shares one object with them and finds what was saved.
* **Storage can fail on purpose.** `tests/support/memory-storage.ts`. Keys whose removal fails test an erase that stops halfway; keys whose write fails test an erase that cannot start; a key whose next operation waits holds one storage step.
* **The glass palettes are copied, because the theme cannot be imported under Node.** `tests/mobile-glass.test.ts:THEMES`. `src/ui/theme.ts` imports react-native.
* **The preferences fixture fills only the keys under test.** `tests/mobile-row-defaults.test.ts`. The rest are never read.

### Preferences guard

* **Every preference keeps syncing unless the shared scope file scopes it to the device with a reason.** `tests/mobile-preferences.test.ts`, the guard for #397 and #418. The scope is in `apps/extension/src/shared/setting-scopes.ts`, and `docs/PRIVACY.md` repeats it.
* **The library drops a value it cannot hold.** `tests/mobile-preferences.test.ts`, the arrival through the library.
* **The theme and the bar are the same on every phone; the browser a phone opens links in is its own.** `tests/mobile-preferences.test.ts` (#418).
* **Two writes of the preference record: one of them wins whole.** `tests/mobile-preferences.test.ts:settleAll`.
* **Whichever phone reaches the library first gives the same answer.** `tests/mobile-preferences.test.ts`.
* **A fresh install's empty library has `settings: {}` until the first sync brings the record.** `tests/mobile-preferences.test.ts`.

### Sync and undo

* **A change made just before the app goes to the background is not left waiting for the delay.** `tests/mobile-sync.test.ts`, the background case.
* **A server replaced after a device has pulled is empty and behind, so a device that sends would send every record again.** `tests/mobile-sync.test.ts`, the server replacement.
* **The phone's own JSON export carries the ids, so a round trip keeps them.** `tests/mobile-transfer.test.ts`.
* **Other bookmark tools' exports are read with the extension's reader.** `tests/mobile-transfer.test.ts`, the preview.
* **Bookmarks in no list go to the phone's default column.** `tests/mobile-transfer.test.ts`, the preview.
* **A session with no recorded folder goes to the fallback.** `tests/mobile-session-changes.test.ts`.

### Private library

* **Each test stops every live connection and timer of the phones it started.** `tests/private-library.test.ts`, the teardown. No round reaches the next test's server.
* **A round started by an unlock finishes before the test ends.** `tests/private-library.test.ts`, the teardown.
* **The phone's stored record that says it is a PIN still opens.** `tests/private-library.test.ts`. Short, number-only passwords from an older version are covered.
* **A library from an earlier version has no PIN and does not open until it gets one.** `tests/private-library.test.ts`.
* **A library from an earlier version that synced plain keeps its plain records on the server until it is sealed.** `tests/private-library.test.ts`.
* **Turning the device-only choice off happens before the library is made.** `tests/private-library.test.ts`.
* **A retry checks the credential again, even though the lock already carries the server's id.** `tests/private-library.test.ts`.
* **A sync round seals with the server's key, which the extension holds.** `tests/private-library.test.ts`.
* **A drawer that asks while the network is out reports a failed lookup, not "no key on the server".** `tests/private-library.test.ts`.
* **Back online, the round finds the server's key, and the phone's own key is not stored over it.** `tests/private-library.test.ts`. The server takes a key only when it has none.
* **The way back for a device-only library is the server's password, entered from Settings.** `tests/private-library.test.ts`.
* **An erase stopped by failing storage stays closed at start, and the next start finishes it once storage works.** `tests/private-library.test.ts`.
* **Setting up a password while a join waits leaves the queue in order.** `tests/private-library.test.ts`. The join's writes and the setup's are queued, not interleaved.
* **Locking under a round that has already read the server's key is safe.** `tests/private-library.test.ts`.
* **Coming back to the app counts as a touch, so the auto-lock wait starts over.** `tests/private-library.test.ts`.
* **With the lock mode set to never, nothing locks the library.** `tests/private-library.test.ts`.

### Test timing

* **Building 20,000 bookmarks one by one is slow, so the default five-second limit would fail it.** `tests/backup.test.ts`. The `built` and `read` checks hold the real bounds. Each save checks for a duplicate, which is why the build is slow.

## Excuses

None. This folder had no lint directive without a reason.
