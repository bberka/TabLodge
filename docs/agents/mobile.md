# Android app (`apps/mobile`)

Expo and React Native, TypeScript. Syncs with user's own sync server, reads same library as extension. [ADR 3](../adr/0003-mobile-app-framework.md) records why; [README](../android.md) lists what it does today.

## Where things are

| Path | Holds |
| --- | --- |
| `src/ui/` | Look and shared components: theme, sheets, dialogs, tab bar, keyboard and motion helpers |
| `src/library/` | The library: `store-shape.ts` (empty store, link extraction, statistics), `board-edits.ts` (columns and bookmarks), `session-edits.ts` (sessions and folders), then store, links, view, row actions |
| `src/transfer/` | Import, export, backups, files |
| `src/update/` | Check for updates: `update-check.ts` (versions, one hour wait, saved answer) is pure and tested; `app-update.ts` asks GitHub, downloads APK, shows dialogs |
| `src/library/background-sync.ts` | WorkManager task (`expo-background-task`): one sync round of regular library about every 15 minutes while server connected and **Sync in the background** on, then widget redraw when round changed library. Android may start app only to run it, so task defined when bundle loads and reads saved library itself. Force run on device with `adb shell cmd jobscheduler run -f com.bberka.tablodge <job id>` (`adb shell dumpsys jobscheduler com.bberka.tablodge` lists id); after `am kill` first forced run only reschedules work, so force it second time |
| `src/settings/` | App's own preferences. `preference-schema.ts` is the one place saying what each is, its default, how stored value is checked, whether it syncs; `preferences.ts` keeps current values; `preferences-sync.ts` shares synced ones |
| `src/private/` | Private library: lock, sheets, switch, auto-lock |
| `src/platform/` | Device, storage, open links, polyfills |
| `src/screens/` | One folder per area: `bookmarks`, `sessions`, `save`, `settings`, `transfer` |
| `modules/app-update/` | Local native module asking Android whether installs allowed and starting installer on downloaded APK (a `FileProvider` limited to cache's `updates` folder) |
| `modules/quick-tiles/` | Local native module with Save link and Search Quick Settings tiles and launcher shortcuts for same actions, which open `tablodge://save` and `tablodge://search` (parsed in `src/platform/app-route.ts`), and clipboard read that waits for window focus ([ADR 4](../adr/0004-android-quick-settings-tiles.md)) |
| `modules/bookmarks-widget/` | Local native module with Bookmarks home screen widget: provider, row service, column picker, link opener. Reads `files/widgets/bookmarks.json`, which `src/library/widget-sync.ts` writes from regular library only ([ADR 6](../adr/0006-android-bookmarks-widget.md)) |
| `modules/tablodge-crypto/` | Local native module (PBKDF2 and AES-GCM for private library) |
| `scripts/make-icons.mts` | `pnpm run mobile:icons`: redraws `assets/` (launcher foreground, monochrome layer, legacy icon, light and dark splash) from `apps/extension/shell/icons/tablodge.svg` |
| `scripts/licences.mts` | `pnpm run mobile:licences`: writes `src/about/licences.generated.json` (ignored by git) from Metro bundle's source map and Gradle release classpath (`scripts/native-licences.gradle`), with `scripts/third-party-notices.ts` at root. Every path that bundles app runs it first; new one must too, or Metro cannot find file |
| `scripts/emulator.mts` | `pnpm run mobile:emulator`: starts emulator, waits for boot, `--headless` without window, `--stop` ends it |
| `scripts/build-apk.mts` | `pnpm run mobile:apk`: standalone APK from this checkout |
| `tests/` | Vitest suites for logic needing no device. `phone-crypto-vectors.test.ts` opens output Kotlin module wrote on device; `live/peer.test.ts` is extension's side of live run (see [Live check](#live-check-on-an-emulator)) |

App imports types and sync client from `apps/extension/src` by relative path (Metro watches repository root). Those files must stay free of browser APIs, and `apps/extension/src/shared` changes can break this app: see [Cross app work](cross-app.md).

## Rules

- Keep session management simple. Tab reordering, splitting and merging sessions, enforcing library's size limits intentionally not planned for app (listed in [README](../android.md)); do not add them without owner asking.
- Expo pins exact versions. Add packages with `pnpm --filter tablodge-mobile exec expo install <package>`.
- Put pure logic in plain `.ts` file with test in `tests/`, not inside screen.
- Proof comes from emulator or device, not browser. Run `pnpm run mobile:emulator --headless` (no window, software GPU). It reuses first running emulator and `--stop` ends that one, so when other emulators run, start your own with `emulator -avd <name> -port <free even port> -no-window -no-audio -gpu swiftshader_indirect` and end it with `adb -s <serial> emu kill`. Set `ANDROID_SERIAL` to your emulator's serial before `pnpm run mobile:android` or `pnpm run mobile:apk --install`, and drive app and take screenshots with harness's device tools when it has them (in T3 Code, `device_open` and `device_screenshot`, never `adb input` or `screencap`), otherwise with `adb -s <serial> shell input tap|text|swipe` and `adb -s <serial> exec-out screencap -p > file.png`, headless too. Keep sample data off any real server. Do this without asking, for every visible change. What to report: [Proof](validation.md#proof).
- Do not edit PNGs in `assets/` by hand: change `scripts/make-icons.mts` or extension's mark and rerun `pnpm run mobile:icons`. Mark stays inside adaptive icon's 66 dp safe zone, monochrome layer is same shape in black, which Android tints for themed icons.
- New feature or user action checks whether it belongs in share sheet, app shortcut, or Quick Settings tile: [Entry points](cross-app.md#feature-triage).
- Put new setting or Settings section into `SECTIONS` in `src/screens/settings/settings-index.ts`, which both Settings search and Search elsewhere on Sessions and Bookmarks screens read; row's hint is its Help line, and `docs/android.md` lists it. Decide in same pull request whether new feature needs to be reachable from search too, and say why not when it does not.
- Accessibility still applies: labels, roles, touch targets, TalkBack behave like extension's [UI rules](ui.md#accessibility) intend.
- Destructive actions follow [UI rule](ui.md#destructive-actions): Settings and its sheets ask first with `confirm` (`src/ui/dialog.tsx`); Sessions and Bookmarks screens act at once and `showSnack` offers **Undo**.
- CI builds debug APK on `apps/mobile/**` changes; releases signed in `release.yml` ([CI](ci.md#android-app)).

## Adding a preference

Add one entry to `FIELDS` in `src/settings/preference-schema.ts`, its type to `Preferences`, its scope to shared `setting-scopes.ts` ([Cross app work](cross-app.md#feature-triage)). Synced preferences travel in library's `mobileApp` setting, which extension keeps but does not read. Each synced value stored with time last changed (`theme` and `at.theme`), and `preference-merge.ts` settles every key against library: later change wins, phone sends only what it changed, keys it does not know stay, so newer app's settings survive older one. Fresh install's empty library has no `mobileApp` setting yet; `settlePreferences` treats that as empty one. Library still merges `mobileApp` as one record, so when two phones write at once one write can be dropped; that phone sees its change missing and sends it again. While Settings sync off, sync client keeps server's settings but does not copy them into phone's library, so switching it back on sends phone's older copy as new edit and can overwrite what another phone changed meanwhile; fix belongs in shared sync client. Times come from each phone's clock. Value in `mobileApp` takes two keys, and `MOBILE_APP_KEYS_MAX` (80) caps setting; `tests/mobile-preferences.test.ts` fails when synced keys outgrow it.

## Live check on an emulator

Node tests replace `TablodgeCryptoModule` with Web Crypto stand-in, so change to module, private library, or its sync needs run on real build. Build release APK for x86_64 (`cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`), start your own headless emulator instance, and run server (`node apps/server/dist/node.js` with `TABLODGE_SYNC_TOKEN`, `DATA_DIR`, and `PORT=8787`; `adb -s <serial> reverse tcp:8787 tcp:8787`; connect app to `http://localhost:8787`). `apps/mobile/tests/live/peer.test.ts` is extension's side: uses extension's own key, codec, and sync client over real HTTP. Set `TL_STEP` to `create` (make library, with `TL_PIN` and `TL_KIND`), `edit` (add link), or `read` (open what phone sent), plus `TL_URL`, `TL_TOKEN`, and `TL_STATE`, and run `npx vp test run apps/mobile/tests/live/peer.test.ts`. `app-set` (merge JSON in `TL_APP` into regular library's `mobileApp`, as second phone would), `app-read`, and `app-bookmark` (add `TL_LINK` as bookmark, as extension would) work on regular library, not private one. Without `TL_STEP` file does nothing. To refresh `tests/support/phone-made.json`, change password on phone and copy `/private/v1/key` and one sealed record phone wrote from server.

## Profiling a large library

`apps/mobile/scripts/perf/scenarios.ts` builds #415 scale matrix (bookmarks, columns, sessions, links, folders) on extension's `perf-fixture.ts`. `tests/large-library.test.ts` checks cost as counts, not timings (reads per bookmark, records sent for one edit, state saved per round); add case there when change touches list, search, or sync round.

On emulator, from `apps/mobile`: `git apply scripts/perf/probe.patch` (timing probes; undo with `git apply -R scripts/perf/probe.patch` before committing), build release APK with `EXPO_PUBLIC_PERF=1`, then run `scripts/perf/run-matrix.sh` (its header lists setup, including `adb root` and redirect for `localhost:18917`) and `node scripts/perf/collate.mjs <dir>`. Allow plain HTTP in generated `android/` manifest for that build only. Check `uptime` and state load next to numbers: busy machine and software GPU inflate them.
