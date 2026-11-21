# 11. Three sync scopes for settings

Status: accepted, 2026-11-21. Issue #418. Amends [ADR 10](0010-settings-sync.md).

## Context

ADR 10 split settings into those that sync and those that stay on one device, and put theme and appearance on the second list. That kept a phone's theme from changing a browser, but it also kept two phones, or two browsers, from sharing a theme the user picks once. "Stays on the device" was doing two jobs: settings bound to one device, and settings that only one app uses.

## Decision

* Every setting has one of three scopes, with its reason, in `apps/extension/src/shared/setting-scopes.ts`, which replaces `local-settings.ts`:
  * `all`: syncs to every browser and phone. Both apps read it and it means the same in each.
  * `platform`: syncs to every browser or every phone. The other app has no use for it: theme, accent, the extension's dashboard layout, the phone's look and gestures.
  * `device`: never syncs. Only for what cannot mean anything on another device: its name, its connection, a permission only it can grant, its installed apps, its private library, dismissals and remembered state. The private library's lock options are `device` too, even though they would mean something elsewhere: a change made on one device must not weaken the protection of another device's private library.
* `all` and `platform` travel alike: no new record kind, field, or feature flag. Every client carries the record, and only the app that reads it acts on it.
  * Library settings reach every device. The phone reads exactly the ones scoped `all`, which `tests/setting-scopes.test.ts` checks against its source.
  * The phone's preferences travel in the `mobileApp` setting, which only phones read. The appearance preferences now sync there too, as they did in 0.3.0.
  * The extension's theme, accent, and private window accent stay in their own storage keys, so private windows keep sharing them. They sync as `setting` records `uiTheme`, `uiAccent`, and `privateAccent`, which the host hands to the client as `outsideSettings` (`read`, `apply`, and `defaults`, the way it hands in Sources). They go only to a server that lists `settings`, under the first contact rule of ADR 10, with the host's defaults counting as untouched. A phone holds them in `heldSettings` without reading them and sends them back unchanged.
* The registry is typed against `Settings` and `Preferences`, so a setting without a scope fails to compile, and the test fails for one without a reason, for a `device` one that PRIVACY.md does not list, and for one that syncs against its scope.

## Consequences

* A 0.3.0 extension skips `setting` records and keeps its own theme. A 0.3.0 phone already synced its look in `mobileApp` and keeps doing so.
* Site icons existed once in each app under different keys. #429 made it one `all` library setting, `siteIcons`, with `server` and `browser`; the phone's `off` and `direct` carry over as `browser`, and a phone that held one keeps it unless the server already holds a value (first contact, ADR 10). The phone's save screen lookup (`savePreview`) and the extension's hover card (`linkPreviews`) are different behaviors, so each stays a `platform` setting of its own app.
* Moving a setting between `all` and `platform` changes nothing on the wire. Moving one out of `device` later needs a new key, as ADR 10 says.
