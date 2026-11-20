# 6. Android Bookmarks widget

Status: accepted, 2026-11-17. Issue #242.

## Context

Issue #242 asks for home screen widgets so a saved link is one tap from the launcher. The maintainer's decision for the first version: a **Bookmarks** widget only, read only, showing one bookmark column. A row opens its link the way **Settings › Open links** says, and the header opens the app on that column. No Sessions widget and no save action.

A widget runs in the launcher's process and draws native views, so it cannot start the app's JavaScript to read the library. Expo does not generate widget providers.

The extension has no equivalent, because a home screen widget is an Android system feature. The extension's new tab board already shows the same columns.

## Decision

* **A local Kotlin Expo module, `apps/mobile/modules/bookmarks-widget`**, like `quick-tiles` ([ADR 4](0004-android-quick-settings-tiles.md)). It holds an `AppWidgetProvider`, a `RemoteViewsService` for the rows, a configuration activity, and a small activity that opens a row's link. `react-native-android-widget` was the other candidate. It would draw the widget from JavaScript, but adds a dependency and starts the JavaScript runtime for every redraw.
* **No config plugin.** The module's `AndroidManifest.xml` declares the receiver, service, and activities, and Gradle merges it into the app's manifest, as for `quick-tiles` and `app-update`. A config plugin would only be needed to change files that prebuild generates, and nothing here does. The same module manifest adds the launcher shortcuts' `meta-data` to `MainActivity` (in `quick-tiles`, since the shortcuts reuse the tiles' actions).
* **A JSON snapshot as the hand-off.** `src/library/widget-snapshot.ts` builds it from the **regular library only**: an **All** list first (the app's All chip, offered even when that chip is hidden), then every bookmark column in order, each with its first 50 web links (title, address, site), at most 50 columns, and the **Open links** choice. `src/library/widget-sync.ts` rebuilds it on every change to the regular library or the preferences, and hands it to the module, which writes `files/widgets/bookmarks.json` in the app's private storage and redraws the widgets. The writer starts after the saved library has loaded, writes at once so a save from the share sheet or a tile is not lost when the app closes, and skips a write when nothing the widget shows changed.
* **An empty library deletes the snapshot.** A regular library with no bookmarks gives no snapshot, so **Erase bookmarks**, **Erase everything**, and **Clear library** all delete the file through the same path, and a restore writes it again. The private library is never read; a test runs the real libraries and checks that nothing from the private one is written, whichever library is on screen.
* **Per-widget column choice stays on the phone**, in the module's own `SharedPreferences`, and is removed when the widget is. It does not sync.
* **States, not crashes.** No snapshot (never opened, erased, or unreadable) shows "Open TabLodge to show your bookmarks". A missing column, or a widget with no stored column, shows "This column is gone. Tap to choose another." An empty column shows "Nothing saved here yet".
* **Opening links.** A row's tap goes through a translucent activity with no history and its own empty task, so TabLodge does not come to the front. It opens the default browser, the chosen browser, or a Custom Tab (the session extra set by hand, so no `androidx.browser` dependency), and falls back to the default browser when the chosen one is gone. The header opens `tablodge://column/<id>`, which the app routes like the tiles' addresses.
* **Look.** The app's own palette in light and dark (`values-night`), not Material You. Rows are at least 48 dp, with "title, site" as their TalkBack label. The header has a button that reopens the configuration on every Android version. The provider also declares `reconfigurable`, which lets Android 12 and newer launchers offer their own entry.

## Consequences

* The snapshot is a second copy of up to 2,500 regular links on the phone, in private storage that is not backed up (`allowBackup` is off). [Privacy](../PRIVACY.md) lists it.
* A widget shows what the app last wrote. A change made on another device reaches it the next time the app syncs, which since #361 includes the background sync about every 15 minutes; the widget never contacts the server. Its half-hourly update only redraws from the same file.
* Letter tiles stand in for site icons, since the widget cannot fetch them.
