# 19. Android settings decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile/src/settings` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. What each preference does for a person is in [Android app](../android.md), and the type, default, and reader of each one are in `preference-schema.ts`. The sync rules for the library's `mobileApp` setting are in [ADR 10](0010-settings-sync.md) and [ADR 11](0011-setting-sync-scopes.md). The mobile area's first ADR is [ADR 20](0020-mobile-decisions.md).

## Decisions

### Syncing between phones

* **Settings travel in the library, not in a server of their own.** `src/settings/preference-schema.ts` defines the `FIELDS` entries. A preference syncs through the library's `mobileApp` setting, unless its entry in `ANDROID_PREFERENCES` (`apps/extension/src/shared/setting-scopes.ts`) scopes it to this device, and the reason is written there. Adding one takes one `FIELDS` entry and one `ANDROID_PREFERENCES` entry; the types and readers follow.
* **Each synced value sits beside the time it was last changed.** `src/settings/preference-merge.ts:AT_PREFIX`. The time is stored under `at.<key>`, so the merge can tell which phone changed a value last.
* **A fresh library has no `mobileApp` yet, and that counts as empty.** `preference-merge.ts:NO_MOBILE_APP`. A sync writes `mobileApp` only when it has a value to send, so the first sync brings the setting in only when there is one.
* **Two phones settle one value by the later change.** `preference-merge.ts:settlePreferences`. The library merges `mobileApp` as one record, so two phones changing different preferences offline would cost one of them its change. Each key is compared with the library's, the newer side wins, and this phone sends back only what is newer here. Clocks are the phones' own, so a phone with a wrong clock can win or lose.
* **Equal times go to the library.** `settlePreferences`. Both phones then keep one value.
* **A preference this phone never changed is not sent because of this phone.** `settlePreferences`. A value this phone adopted from the library can still be sent back by a later round, when a later library record omits it or holds an older one. Keys this version does not know stay as they are, so a newer app's settings survive an older one.
* **The library's `mobileApp` object is returned as the same object when nothing here is newer.** `Settled` in `preference-merge.ts`. Nothing is written.
* **Only a change made on this phone is stamped and sent.** `preferences.ts:setPreferences`. A preference taken from another phone is not sent back.
* **Preferences from another phone keep their times.** `preferences.ts:adoptPreferences`. Adopting does not send them at once. See the entry above for when a later round can.
* **The change times are kept in their own storage key.** `preferences.ts:changedAt`. Settings sync reads them, so they are separate from the values.
* **Local changes are handed to sync by a callback.** `preferences.ts:watchLocalChanges`. The preferences module does not know about sync.
* **Synced values are read leniently.** `preference-schema.ts:readSyncedPreferences`. A value that is not valid is left out, so one bad entry never changes the others, and a key this version does not know is ignored.
* **The synced values are the plain values the extension keeps.** `preference-schema.ts:syncedPreferences`. The extension stores them in the library without reading them.

### Stored and legacy values

* **A value that is missing or invalid falls back to its default.** `preference-schema.ts:parsePreferences`. Stored and backed up preferences are read this way.
* **An older Icons-only size reads as today's pair.** `preference-schema.ts:upgrade` maps `barSize: 'icons'` to today's size and label fields. An earlier Icons-only size was full width without names. The older `siteIcons` setting is read by `preference-schema.ts:legacySiteIconsOf` in `preferences.ts`, and `preferences-sync.ts` copies it across phones.

### Theme and look

* **Automatic picks the look by platform.** `preferences.ts:resolveLook`. iOS on an iPhone, Material on Android.
* **Theme `unspecified` hands the choice back to the phone.** `preferences.ts:applyTheme`. The app's theme follows the phone's setting.

### Backup and reset

* **Reset keeps this phone's identity.** `preferences.ts:resetPreferences`. The phone's name, the column last saved to, and whether settings sync stay.
* **A backup leaves out the phone's name and last column.** `preferences.ts:backupPreferences`. Those belong to this phone, not to the library.
* **A restored backup is one change, and it keeps the same two values.** `preferences.ts:restorePreferences`.

### Pointers into the extension

* **The private-library button is shown with a warning about its visibility.** `preference-schema.ts`, the `FIELDS` entry for the private library button. The button tells anyone holding the phone that a private library exists.
* **The link-preview switch is not the extension's hover card.** `preference-schema.ts`, the `FIELDS` entry for link previews. The extension's `linkPreviews` setting is a different one.
* **Sync is on by default, like the extension's Sync settings.** `preference-schema.ts`, the `FIELDS` entry for settings sync.
* **Chrome ignores a request for a private tab from another app.** `preference-schema.ts`, the `FIELDS` entry for the private browser. A private browser is therefore chosen as an app. [Android app](../android.md) explains this to the person.
* **A small floating tab bar has no room for names.** `preference-schema.ts`, the `FIELDS` entry for the bar's labels.
* **Turning the blur off draws solid surfaces, which is lighter on a slow phone.** `preference-schema.ts`, the `FIELDS` entry for the blur. The blur is on by default.
* **The main button has to do something, so `none` is not an option.** `preference-schema.ts`, the `FIELDS` entry for the main button.

## Excuses

None found in this folder. The legacy reads above are compatibility, not hacks.
