# 10. Every setting syncs, and newer ones as their own record kind

Status: accepted, 2026-11-20. Issue #397. Amended by [ADR 11](0011-setting-sync-scopes.md): theme and appearance sync between devices of one kind, and `local-settings.ts` is now `setting-scopes.ts`.

## Context

Settings synced as `preference` records, one per key in a hand-kept list. A key added to the extension's settings stayed in one browser unless someone remembered the list, and ten had: snapshots, automatic backups, browser bookmark monitoring, link previews, and site icons. The Android app marked each preference `synced` or `device` by hand, and its theme and accent synced between phones.

Adding those keys to the `preference` list would lose data. A 0.3.0 extension assembles only the preference ids it knows, so the next capture finds an unknown one missing and pushes a delete for it ([ADR 5](0005-bookmark-notes-sync.md), [ADR 9](0009-sources-settings-sync.md)).

## Decision

* Every setting syncs while **Sync settings** is on. The exceptions, each with its reason, live in one file, `apps/extension/src/shared/local-settings.ts`: theme and appearance, the device name, the server connection, the private library's setup and lock, permission state, per-screen hints, and per-device dismissals. On Android every preference in the Appearance section is local, while the extension's board layout keeps syncing as it has since 0.3.0. docs/PRIVACY.md repeats the list.
* The extension syncs every key of `DEFAULT_SETTINGS` that is neither listed as local nor among the 0.3.0 preferences. The phone syncs every preference in its schema that is not listed. A new setting therefore syncs without anyone touching a list. `tests/local-settings.test.ts` round-trips every key through `splitLibrary` and `assemble`, fails for one that does not arrive and is not listed, and checks the list against docs/PRIVACY.md and every storage key in the extension's source.
* The 0.3.0 list stays `preference` records, unchanged. The rest travel as records of kind `setting`, keyed by the setting, which 0.3.0 skips. Clients send and take them only when the server lists `settings` among its `features`. `PROTOCOL_VERSION` stays 1.
* A `setting` record this version does not know is kept in `settings.heldSettings` as it came, and `splitLibrary` sends it back unchanged, so a newer version's setting is never deleted by an older one. Once a version knows the key, `normalizeSettings` takes the held value for it.
* First contact: most of these settings existed before they synced, so browsers already hold different values. Until a pull has taken `setting` records once, capture leaves the kind alone, so the server's value wins over one that never synced, and only the settings the server lacks go out after the pull. The first browser to sync after updating sets the value for the others. A `setting` record that never synced and still holds its default is not sent at all, so a phone or a new browser, which holds every default without anyone choosing it, cannot overwrite a chosen value even when it syncs first. Once a setting has synced, going back to its default is an edit like any other.

## Consequences

* Settings added since 0.3.0 reach other devices only once the server is updated. Settings › Sync lists what is missing until then.
* A 0.3.0 extension keeps its own values for these settings, and never erases them.
* A setting that is local today and should sync later needs a new key: under its old key, a version that still lists it as local would treat the synced value as one it holds, not one it knows.
