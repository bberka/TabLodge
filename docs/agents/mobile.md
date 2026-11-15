# Android app (`apps/mobile`)

Expo and React Native, TypeScript. It syncs with the user's own sync server and reads the same library as the extension. [ADR 3](../adr/0003-mobile-app-framework.md) records why; the [README](../README.md#android-app) lists what it does today.

## Where things are

| Path | Holds |
| --- | --- |
| `src/ui/` | Look and shared components: theme, sheets, dialogs, the tab bar, keyboard and motion helpers |
| `src/library/` | The library: `store-shape.ts` (the empty store, link extraction, statistics), `board-edits.ts` (columns and bookmarks), `session-edits.ts` (sessions and folders), then the store, links, the view, and the row actions |
| `src/transfer/` | Import, export, backups, and files |
| `src/settings/` | The app's own preferences. `preference-schema.ts` is the one place that says what each is, its default, how a stored value is checked, and whether it syncs; `preferences.ts` keeps the current values; `preferences-sync.ts` shares the synced ones |
| `src/private/` | The private library: its lock, sheets, switch, and auto-lock |
| `src/platform/` | Device, storage, open links, and polyfills |
| `src/screens/` | One folder per area: `bookmarks`, `sessions`, `save`, `settings`, `transfer` |
| `modules/tablodge-crypto/` | Local native module (PBKDF2 and AES-GCM for the private library) |
| `scripts/make-icons.mts` | `pnpm run mobile:icons`: redraws `assets/` (launcher foreground, monochrome layer, legacy icon, light and dark splash) from `apps/extension/shell/icons/tablodge.svg` |
| `scripts/build-apk.mts` | `pnpm run mobile:apk`: a standalone APK from this checkout |
| `tests/` | Vitest suites for the logic that does not need a device. `phone-crypto-vectors.test.ts` opens output the Kotlin module wrote on a device; `live/peer.test.ts` is the extension's side of a live run (see [Live check](#live-check-on-an-emulator)) |

The app imports types and the sync client from `apps/extension/src` by relative path (Metro watches the repository root). Those files must stay free of browser APIs, and `apps/extension/src/shared` changes can break this app: see [Cross app work](cross-app.md).

## Rules

- Keep session management simple. Tab reordering, splitting and merging sessions, and enforcing the library's size limits are intentionally not planned for the app (listed in the [README](../README.md#android-app)); do not add them without the owner asking.
- Expo pins exact versions. Add packages with `pnpm --filter tablodge-mobile exec expo install <package>`.
- Pure logic goes in a plain `.ts` file with a test in `tests/`, not inside a screen.
- Proof comes from an emulator or a device, not the browser. Start the emulator with a visible window and software GPU: `emulator -avd <name> -no-audio -gpu swiftshader_indirect`, and keep sample data off any real server. Report the Android version, the Material or iOS look, and whether TalkBack, dark theme, or a small screen were not checked. Details: [Proof](validation.md#proof).
- Do not edit the PNGs in `assets/` by hand: change `scripts/make-icons.mts` or the extension's mark and rerun `pnpm run mobile:icons`. The mark stays inside the adaptive icon's 66 dp safe zone, and the monochrome layer is the same shape in black, which Android tints for themed icons.
- Accessibility still applies: labels, roles, touch targets, and TalkBack behave like the extension's [UI rules](ui.md#accessibility) intend.
- CI builds a debug APK on `apps/mobile/**` changes; releases are signed in `release.yml` ([CI](ci.md#android-app)).

## Adding a preference

Add one entry to `FIELDS` in `src/settings/preference-schema.ts` and its type to `Preferences`. Mark it `synced` to share it between phones, or `device` when it depends on this phone (what it can draw, which browsers it has, its privacy choices). Synced preferences travel in the library's `mobileApp` setting, which the extension keeps but does not read. Each synced value is stored with the time it was last changed (`theme` and `at.theme`), and `preference-merge.ts` settles every key against the library: the later change wins, a phone sends only what it changed, and keys it does not know stay, so a newer app's settings survive an older one. The library still merges `mobileApp` as one record, so when two phones write at once one write can be dropped; that phone sees its change missing and sends it again. The times come from each phone's clock. A value in `mobileApp` takes two keys, and `MOBILE_APP_KEYS_MAX` (80) caps the setting; `tests/mobile-preferences.test.ts` fails when the synced keys outgrow it.

## Live check on an emulator

The Node tests replace `TablodgeCryptoModule` with a Web Crypto stand-in, so a change to the module, the private library, or its sync needs a run on a real build. Build the release APK for x86_64 (`cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64`), start your own emulator instance, and run the server (`node apps/server/dist/node.js` with `TABLODGE_SYNC_TOKEN`, `DATA_DIR`, and `PORT=8787`; `adb reverse tcp:8787 tcp:8787`; connect the app to `http://localhost:8787`). `apps/mobile/tests/live/peer.test.ts` is the extension's side: it uses the extension's own key, codec, and sync client over real HTTP. Set `TL_STEP` to `create` (make the library, with `TL_PIN` and `TL_KIND`), `edit` (add a link), or `read` (open what the phone sent), plus `TL_URL`, `TL_TOKEN`, and `TL_STATE`, and run `npx vp test run apps/mobile/tests/live/peer.test.ts`. Without `TL_STEP` the file does nothing. To refresh `tests/support/phone-made.json`, change the PIN on the phone and copy `/private/v1/key` and one sealed record the phone wrote from the server.
