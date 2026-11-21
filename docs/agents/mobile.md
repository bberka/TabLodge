# Android app (`apps/mobile`)

Expo and React Native, TypeScript. It syncs with the user's own sync server and reads the same library as the extension. [ADR 3](../adr/0003-mobile-app-framework.md) records why; the [README](../android.md) lists what it does today.

## Where things are

| Path | Holds |
| --- | --- |
| `src/ui/` | Look and shared components: theme, sheets, dialogs, the tab bar, keyboard and motion helpers |
| `src/library/` | The library: `store-shape.ts` (the empty store, link extraction, statistics), `board-edits.ts` (columns and bookmarks), `session-edits.ts` (sessions and folders), then the store, links, the view, and the row actions |
| `src/transfer/` | Import, export, backups, and files |
| `src/update/` | Check for updates: `update-check.ts` (versions, the one hour wait, the saved answer) is pure and tested; `app-update.ts` asks GitHub, downloads the APK, and shows the dialogs |
| `src/library/background-sync.ts` | The WorkManager task (`expo-background-task`): one sync round of the regular library about every 15 minutes while a server is connected and **Sync in the background** is on, then a widget redraw when the round changed the library. Android may start the app only to run it, so the task is defined when the bundle loads and reads the saved library itself. Force a run on a device with `adb shell cmd jobscheduler run -f com.bberka.tablodge <job id>` (`adb shell dumpsys jobscheduler com.bberka.tablodge` lists the id); after `am kill` the first forced run only reschedules the work, so force it a second time |
| `src/settings/` | The app's own preferences. `preference-schema.ts` is the one place that says what each is, its default, how a stored value is checked, and whether it syncs; `preferences.ts` keeps the current values; `preferences-sync.ts` shares the synced ones |
| `src/private/` | The private library: its lock, sheets, switch, and auto-lock |
| `src/platform/` | Device, storage, open links, and polyfills |
| `src/screens/` | One folder per area: `bookmarks`, `sessions`, `save`, `settings`, `transfer` |
| `modules/app-update/` | Local native module that asks Android whether installs are allowed and starts the installer on the downloaded APK (a `FileProvider` limited to the cache's `updates` folder) |
| `modules/quick-tiles/` | Local native module with the Save link and Search Quick Settings tiles and the launcher shortcuts for the same actions, which open `tablodge://save` and `tablodge://search` (parsed in `src/platform/app-route.ts`), and the clipboard read that waits for window focus ([ADR 4](../adr/0004-android-quick-settings-tiles.md)) |
| `modules/bookmarks-widget/` | Local native module with the Bookmarks home screen widget: provider, row service, column picker, and link opener. It reads `files/widgets/bookmarks.json`, which `src/library/widget-sync.ts` writes from the regular library only ([ADR 6](../adr/0006-android-bookmarks-widget.md)) |
| `modules/tablodge-crypto/` | Local native module (PBKDF2 and AES-GCM for the private library) |
| `scripts/make-icons.mts` | `pnpm run mobile:icons`: redraws `assets/` (launcher foreground, monochrome layer, legacy icon, light and dark splash) from `apps/extension/shell/icons/tablodge.svg` |
| `scripts/licences.mts` | `pnpm run mobile:licences`: writes `src/about/licences.generated.json` (ignored by git) from the Metro bundle's source map and the Gradle release classpath (`scripts/native-licences.gradle`), with `scripts/third-party-notices.ts` at the root. Every path that bundles the app runs it first; a new one must too, or Metro cannot find the file |
| `scripts/emulator.mts` | `pnpm run mobile:emulator`: starts the emulator and waits for boot, `--headless` without a window, `--stop` ends it |
| `scripts/build-apk.mts` | `pnpm run mobile:apk`: a standalone APK from this checkout |
| `tests/` | Vitest suites for the logic that does not need a device. `phone-crypto-vectors.test.ts` opens output the Kotlin module wrote on a device; `live/peer.test.ts` is the extension's side of a live run (see [Live check](#live-check-on-an-emulator)) |

The app imports types and the sync client from `apps/extension/src` by relative path (Metro watches the repository root). Those files must stay free of browser APIs, and `apps/extension/src/shared` changes can break this app: see [Cross app work](cross-app.md).

## Rules

- Keep session management simple. Tab reordering, splitting and merging sessions, and enforcing the library's size limits are intentionally not planned for the app (listed in the [README](../android.md)); do not add them without the owner asking.
- Expo pins exact versions. Add packages with `pnpm --filter tablodge-mobile exec expo install <package>`.
- Pure logic goes in a plain `.ts` file with a test in `tests/`, not inside a screen.
- Proof comes from an emulator or a device, not the browser. Run `pnpm run mobile:emulator --headless` (no window, software GPU). It reuses the first running emulator and `--stop` ends that one, so when other emulators run, start your own with `emulator -avd <name> -port <free even port> -no-window -no-audio -gpu swiftshader_indirect` and end it with `adb -s <serial> emu kill`. Set `ANDROID_SERIAL` to your emulator's serial before `pnpm run mobile:android` or `pnpm run mobile:apk --install`, and drive the app and take screenshots with the harness's device tools when it has them (in T3 Code, `device_open` and `device_screenshot`, never `adb input` or `screencap`), otherwise with `adb -s <serial> shell input tap|text|swipe` and `adb -s <serial> exec-out screencap -p > file.png`, headless too. Keep sample data off any real server. Do this without asking, for every visible change. What to report: [Proof](validation.md#proof).
- Do not edit the PNGs in `assets/` by hand: change `scripts/make-icons.mts` or the extension's mark and rerun `pnpm run mobile:icons`. The mark stays inside the adaptive icon's 66 dp safe zone, and the monochrome layer is the same shape in black, which Android tints for themed icons.
- A new feature or user action checks whether it belongs in the share sheet, an app shortcut, or a Quick Settings tile: [Entry points](cross-app.md#feature-triage).
- A new setting or Settings section goes into `SECTIONS` in `src/screens/settings/settings-index.ts`, which both the Settings search and Search elsewhere on the Sessions and Bookmarks screens read; the row's hint is its Help line, and `docs/android.md` lists it. Decide in the same pull request whether a new feature needs to be reachable from search too, and say why not when it does not.
- Accessibility still applies: labels, roles, touch targets, and TalkBack behave like the extension's [UI rules](ui.md#accessibility) intend.
- Destructive actions follow the [UI rule](ui.md#destructive-actions): Settings and its sheets ask first with `confirm` (`src/ui/dialog.tsx`); the Sessions and Bookmarks screens act at once and `showSnack` offers **Undo**.
- CI builds a debug APK on `apps/mobile/**` changes; releases are signed in `release.yml` ([CI](ci.md#android-app)).

## Adding a preference

Add one entry to `FIELDS` in `src/settings/preference-schema.ts`, its type to `Preferences`, and its scope to the shared `setting-scopes.ts` ([Cross app work](cross-app.md#feature-triage)). Synced preferences travel in the library's `mobileApp` setting, which the extension keeps but does not read. Each synced value is stored with the time it was last changed (`theme` and `at.theme`), and `preference-merge.ts` settles every key against the library: the later change wins, a phone sends only what it changed, and keys it does not know stay, so a newer app's settings survive an older one. A fresh install's empty library has no `mobileApp` setting yet; `settlePreferences` treats that as an empty one. The library still merges `mobileApp` as one record, so when two phones write at once one write can be dropped; that phone sees its change missing and sends it again. While Settings sync is off the sync client keeps the server's settings but does not copy them into the phone's library, so switching it back on sends the phone's older copy as a new edit and can overwrite what another phone changed in the meantime; the fix belongs in the shared sync client. The times come from each phone's clock. A value in `mobileApp` takes two keys, and `MOBILE_APP_KEYS_MAX` (80) caps the setting; `tests/mobile-preferences.test.ts` fails when the synced keys outgrow it.

## Live check on an emulator

The Node tests replace `TablodgeCryptoModule` with a Web Crypto stand-in, so a change to the module, the private library, or its sync needs a run on a real build. Build the release APK for x86_64 (`cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`), start your own headless emulator instance, and run the server (`node apps/server/dist/node.js` with `TABLODGE_SYNC_TOKEN`, `DATA_DIR`, and `PORT=8787`; `adb -s <serial> reverse tcp:8787 tcp:8787`; connect the app to `http://localhost:8787`). `apps/mobile/tests/live/peer.test.ts` is the extension's side: it uses the extension's own key, codec, and sync client over real HTTP. Set `TL_STEP` to `create` (make the library, with `TL_PIN` and `TL_KIND`), `edit` (add a link), or `read` (open what the phone sent), plus `TL_URL`, `TL_TOKEN`, and `TL_STATE`, and run `npx vp test run apps/mobile/tests/live/peer.test.ts`. `app-set` (merge the JSON in `TL_APP` into the regular library's `mobileApp`, as a second phone would), `app-read`, and `app-bookmark` (add `TL_LINK` as a bookmark, as the extension would) work on the regular library, not the private one. Without `TL_STEP` the file does nothing. To refresh `tests/support/phone-made.json`, change the password on the phone and copy `/private/v1/key` and one sealed record the phone wrote from the server.

## Profiling a large library

`apps/mobile/scripts/perf/scenarios.ts` builds the #415 scale matrix (bookmarks, columns, sessions, links, folders) on the extension's `perf-fixture.ts`. `tests/large-library.test.ts` checks cost as counts, not timings (reads per bookmark, records sent for one edit, state saved per round); add a case there when a change touches a list, a search, or the sync round.

On an emulator, from `apps/mobile`: `git apply scripts/perf/probe.patch` (timing probes; undo with `git apply -R scripts/perf/probe.patch` before committing), build a release APK with `EXPO_PUBLIC_PERF=1`, then run `scripts/perf/run-matrix.sh` (its header lists the setup, including `adb root` and a redirect for `localhost:18917`) and `node scripts/perf/collate.mjs <dir>`. Allow plain HTTP in the generated `android/` manifest for that build only. Check `uptime` and state the load next to the numbers: a busy machine and the software GPU inflate them.
