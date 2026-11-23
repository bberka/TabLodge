# 20. Android app decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/mobile` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The Quick Settings tiles are [ADR 4](0004-android-quick-settings-tiles.md), the Bookmarks widget is [ADR 6](0006-android-bookmarks-widget.md), and the framework is [ADR 3](0003-mobile-app-framework.md). Decisions that a mobile doc already covers are linked, not repeated.

## Decisions

### App shell

* **A share that starts the app goes back to its source.** `apps/mobile/app.tsx:Main`, the `finish` function. A saved draft that came from a share (`draft.quick`) exits the app 250 ms later, so Android shows the app the link came from. The "cold start" test that marks such a draft is an Excuse, tracked in #487.
* **A new share replaces the last shared file's sheet.** `app.tsx:Main:openSettings`. An export file or backup shared into the app opens the Settings › Import and export sheets. A new `fileKey` starts the sheet fresh.
* **A refused shared file stays on screen over its source.** `app.tsx:Main:openShare`. The refusal toast is shown before `BackHandler.exitApp()`, so it remains over the app the file came from.
* **A shared file is read once, then its cache copy goes.** `app.tsx:Main`, the effect that calls `openShare` with `cacheCopies`. A failed delete is ignored because the system clears the cache anyway.
* **The connect drawer lives in `Main`.** `app.tsx:Main:connect`. An empty screen and Settings both open it, so its state sits above both.
* **Back ends the selection first.** `app.tsx:Main`, the `BackHandler` effect. Back clears a selection, then returns to Bookmarks from another tab, then leaves the app.
* **The live connection pauses behind other apps.** `app.tsx:Main`, the `AppState` effect. Behind other apps the live connection and its timers stop. In front they resume and catch up.
* **Quick Settings tiles open the regular library.** `app.tsx:Main:openTile` and [ADR 4](0004-android-quick-settings-tiles.md). A copied link fills the field, with any words around it as the title. Other clipboard text leaves the field empty.
* **Bookmarks widget headers open their column.** `apps/mobile/src/platform/app-route.ts:parseColumnRoute` and [ADR 6](0006-android-bookmarks-widget.md). Only the regular library has columns the widget can open.

### Platform

* **The app loads its polyfills first.** `apps/mobile/index.ts` and `src/platform/polyfills.ts`. The shared sync code runs on the phone, so the polyfills are imported before the app. React Native's `URL` cuts hash routes at the slash, rejects an upper case scheme, and does not normalize a host, which broke the link cleaning the extension and the app share, so the standard `URL` replaces it. Hermes has no `toSorted` or `Promise.withResolvers`; each is added only when missing.
* **The phone has no `chrome` API.** `src/platform/chrome.d.ts`. The shared normalizer tests `chrome.runtime.getURL` to detect Firefox. The phone always fails that test, because it has no `chrome`. Only the one type the shared code names is declared.
* **Storage is split by what it holds.** `src/platform/storage.ts`. The server token goes to the Android keystore (`expo-secure-store`). The library and the sync bookkeeping go to SQLite, which has no AsyncStorage size limit.
* **The private library's sync key sits in the keystore.** `storage.ts:PRIVATE_KEY_KEY` and `KEPT_KEY_KEY`, beside the server token.
* **SecureStore key names allow only word characters, dots, and dashes.** `storage.ts:secure` turns any other character into `_`.
* **All links go to Android in one call.** `src/platform/open-links.ts:openLinks`. The first link brings the browser to the front, so the rest must be handed over together. When the chosen way fails (the browser was removed, or there is no in-app tab), the default browser takes them. Builds without native support open links one at a time, so only the first is reliable. A link that no app can open is skipped without a message (the `catch` in `openLinks`).
* **Many links ask first.** `open-links.ts:openAll`. Above a few links the app asks, since each one leaves the app. `onOpen` runs only after one opened, never after Cancel. The private library opens nothing once it has locked.
* **One link gets fewer choices than several.** `src/platform/open-choices.ts:openChoices`. Android's chooser already lists every browser and takes one link at a time, so a single link gets the in-app tab, the default browser, and the chooser. Several links get the installed browsers instead.
* **The private library keeps its own opener.** `open-choices.ts:settingsOpener` reads the settings for the library on screen. The private library follows its own choice, which can name another browser.
* **Browser keys are unique per package.** `open-choices.ts:OpenChoice.key`. Two browsers can share a name, never a package.

### Native modules

* **Installs need the person's permission on Android 8 and newer.** `modules/app-update/index.ts:installAllowed` is false until the person allows installs from TabLodge in Settings.
* **Clipboard reads wait for the window.** `modules/quick-tiles/index.ts:readClipboard`, and [ADR 4](0004-android-quick-settings-tiles.md). Android 10 and newer read the clipboard only once the app has focus.
* **The wrap formats are the extension's.** `modules/tablodge-crypto/index.ts:unwrapKey` and `wrapKey` read and write the credential envelope the extension reads (PBKDF2-SHA-256 into AES-GCM).
* **A sealed record is bound to its name.** `tablodge-crypto/index.ts:sealValue` and `openSealed`. The record's key name is authenticated, so a value moved to another record fails to open.

### Build and release scripts

* **The APK is signed with the local debug key.** `scripts/build-apk.mts`. Android refuses to update the released app with it, so it installs next to nothing else. Uninstalling the released app first removes its local data. It carries the ARM libraries phones use, and only arm64 unless `--all-abis` is given.
* **An emulator already running is reused.** `scripts/emulator.mts`. Starting it again does not boot a second one.
* **Licences come from the build, not from `package.json`.** `scripts/licences.mts`. The bundle's source map gives the npm packages Metro includes, and the Gradle release classpath gives the native libraries. A package without a licence id or text fails the run. The bundle imports the output, so the file must exist before Metro runs (`write`).
* **The licence file is written where Metro can find it.** `src/about/licences.ts:licences`. The file is written before every bundle and ignored by git. Metro needs a static path.
* **The licence data types are types only.** `src/about/licence-data.ts:LicenceData`. The Node scripts that write the file import the same types.
* **Licence text is re-joined for a phone.** `src/about/licence-list.ts:joinLines`. Licence files wrap at about 80 columns, which breaks every line twice on a phone. Lines of each paragraph are joined, blank lines and list items stay.
* **The dark splash uses a brighter brand purple.** `scripts/make-icons.mts:brightBrand`. The brand purple is dim on `#16151B`, so the dark splash uses the app's dark accent from `src/ui/theme.ts`.
* **The mark fits the launcher's safe zone.** `make-icons.mts:markCanvas`. The mark spans 104 of 128 units, with a 4 unit stroke on each side, centred on (64, 64). The 526 px foreground is 51% of the canvas; the 66 dp safe zone of the 108 dp adaptive icon is 61%, so no launcher mask cuts it. The splash mark is a little smaller so Android 12 can crop its circle.
* **The monochrome layer is only a shape.** `make-icons.mts`, the `android-icon-monochrome.png` render. Android paints one wallpaper colour on themed icons, so only its shape and transparency matter.
* **Icons are written as plain 8 bit files.** `make-icons.mts`, the `output` step. A plain output with no colour profile keeps each file small.

### Transfer

* **A full backup is the extension's ZIP.** `src/transfer/backup.ts:buildBackup`. The layout is the extension's, so the extension can restore a phone's backup. A password wraps the ZIP in the extension's envelope, using the phone's native PBKDF2 and AES-GCM, since Hermes has no WebCrypto.
* **Spread arguments are chunked.** `backup.ts:CHUNK`. Hermes has a smaller call stack than the browsers this idiom comes from.
* **Cleaning compares each kind on its own.** `backup.ts:KEPT_KINDS`. Cleaning a library can add a default folder or column, so the kinds are not compared as one list.
* **A restored file is cleaned the way the extension cleans it.** `backup.ts:readBackup`. A damaged or hostile file cannot put anything into the library that the library would not hold itself.
* **The library keeps one safety copy.** `src/transfer/restore.ts:SafetyCopy`. The next restore replaces it. The extension's full restore takes a safety backup too and offers Undo.
* **Trash counts as saved for imports.** `src/transfer/transfer.ts:existingUrls`. A link already in the trash is skipped by an import.
* **A column from the source joins by id.** `transfer.ts:columnFor`. A source column is matched by its id, so it joins the column with that id, or keeps the id.
* **Pinned tabs come only from the extension's export.** `transfer.ts:freshLinks`. Other sources cannot carry the pin.
* **Import rules are the extension's.** `transfer.ts` and `apps/extension/src/app`. Reading other apps' files and the share and export formats are the extension's pure code, so a file reads the same on both. Only how the result lands in the library is written here.
* **The read limit is the extension's.** `src/transfer/files.ts:MAX_BACKUP_BYTES`, 60 MB. The extension reads up to this much of a backup too.
* **Shared files use the picked-file limits.** `files.ts:sharedFile`. `File` reads the size when the share did not give one.
* **Shared and exported files are written to the cache first.** `files.ts:shareTextFile` and `shareBinaryFile`. Android's share sheet reads them from there, and the system clears the cache when it needs room.

### Update check

* **The APK comes only from this repository's releases.** `src/update/update-check.ts:DOWNLOAD_PREFIX`.
* **The update check runs without the phone.** `update-check.ts`. It holds no storage, no network, and no React Native, so every rule runs under Node. `app-update.ts` supplies the clock, the saved answer, and the request.
* **A release can exist before its APK.** `update-check.ts:LatestRelease.apkUrl` is missing until the release workflow attaches the APK, a few minutes after the release is published.
* **Only an answer starts the cooldown.** `update-check.ts:outcomeFor`. A failed request leaves the cooldown alone, so the next tap can try again.
* **The saved answer is compared with the installed version each time.** `outcomeFor`. Installing the update ends its notice at once.
