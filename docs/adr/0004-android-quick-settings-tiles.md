# 4. Android Quick Settings tiles

Status: accepted, 2026-11-17. Issue #248.

## Context

Issue #248 asks for Quick Settings tiles: buttons in the panel that opens when you pull down the notification shade, each starting one TabLodge action. A tile cannot show a list, so the tiles only open the app. A tile needs a `TileService` subclass and a manifest entry, which Expo does not generate, so this is native code that changes the merged manifest.

The extension has no equivalent, because Quick Settings is an Android system panel. It already covers the same actions with the toolbar popup and keyboard shortcuts.

## Decision

* **Two tiles: Save link and Search.** A third tile for **Add several links** and a Settings row that offers to add a tile (`requestAddTileService`, Android 13+) were left out of the first version. People add the tiles from the panel's edit mode.
* **A local Expo module, `apps/mobile/modules/quick-tiles`.** Its `AndroidManifest.xml` declares both services with `android.permission.BIND_QUICK_SETTINGS_TILE`, which only the system holds, and Gradle merges it into the app's manifest, as `app-update` does for its `FileProvider`. No config plugin and no JavaScript dependency are needed. It is a module of its own, not part of `open-links`, so tile code stays apart from link opening.
* **The tile only opens an address.** `LaunchTileService` opens `tablodge://save` or `tablodge://search` in the app and closes the panel. Android 14 and newer take a `PendingIntent` for that, older versions an `Intent`, so both paths exist. On a locked phone `startActivityAndCollapse` asks for the unlock first. The issue suggested `unlockAndRun`, but on Android 13 the panel opened again over the app after the unlock, so the app never got focus and could not read the clipboard. The JavaScript side reads the address with `parseTileRoute` in `src/platform/tile-route.ts` and opens the screen. Both tiles always open the regular library, never the private one.
* **The clipboard is read in the app, not the tile.** Android 10 and newer give the clipboard only to the app whose window has focus. The module's `clipboardText` waits for the window to gain focus (up to two seconds) and then reads it once. A link fills the Save link drawer; anything else leaves the field empty.
* **Stateless tiles.** Both stay inactive, have no on or off state, and are labeled from the module's strings. Each has its own one color icon (Material's bookmark add and search), which the system tints. The issue suggested the app's mark for both, but Android 17's small tiles show only the icon, and two identical marks could not be told apart. Android names the app beside each tile in edit mode, and on Android 10 and newer the app's name shows under the label.

## Consequences

* The tiles store nothing and need no network, so they work without a sync server.
* Android 12 and newer show their own "pasted from your clipboard" notice when Save link reads the clipboard.
* Anyone can see in the panel that TabLodge is installed, as with the launcher icon. No tile names or opens the private library.
