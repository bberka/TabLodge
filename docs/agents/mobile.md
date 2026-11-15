# Android app (`apps/mobile`)

Expo and React Native, TypeScript. It syncs with the user's own sync server and reads the same library as the extension. [ADR 3](../adr/0003-mobile-app-framework.md) records why; the [README](../README.md#android-app) lists what it does today.

## Where things are

| Path | Holds |
| --- | --- |
| `src/ui/` | Look and shared components: theme, sheets, dialogs, the tab bar, keyboard and motion helpers |
| `src/library/` | The library: edits, the store, links, the view, the row actions |
| `src/transfer/` | Import, export, backups, and files |
| `src/settings/` | The app's own preferences and their sync |
| `src/private/` | The private library: its lock, sheets, switch, and auto-lock |
| `src/platform/` | Device, storage, open links, and polyfills |
| `src/screens/` | One folder per area: `bookmarks`, `sessions`, `save`, `settings`, `transfer` |
| `modules/tablodge-crypto/` | Local native module (PBKDF2 and AES-GCM for the private library) |
| `scripts/make-icons.mts` | `pnpm run mobile:icons`: redraws `assets/` (launcher foreground, monochrome layer, legacy icon, light and dark splash) from `apps/extension/shell/icons/tablodge.svg` |
| `scripts/build-apk.mts` | `pnpm run mobile:apk`: a standalone APK from this checkout |
| `tests/` | Vitest suites for the logic that does not need a device |

The app imports types and the sync client from `apps/extension/src` by relative path (Metro watches the repository root). Those files must stay free of browser APIs, and `apps/extension/src/shared` changes can break this app: see [Cross app work](cross-app.md).

## Rules

- Keep session management simple. Tab reordering, splitting and merging sessions, and enforcing the library's size limits are intentionally not planned for the app (listed in the [README](../README.md#android-app)); do not add them without the owner asking.
- Expo pins exact versions. Add packages with `pnpm --filter tablodge-mobile exec expo install <package>`.
- Pure logic goes in a plain `.ts` file with a test in `tests/`, not inside a screen.
- Proof comes from an emulator or a device, not the browser. Start the emulator with a visible window and software GPU: `emulator -avd <name> -no-audio -gpu swiftshader_indirect`, and keep sample data off any real server. Report the Android version, the Material or iOS look, and whether TalkBack, dark theme, or a small screen were not checked. Details: [Proof](validation.md#proof).
- Do not edit the PNGs in `assets/` by hand: change `scripts/make-icons.mts` or the extension's mark and rerun `pnpm run mobile:icons`. The mark stays inside the adaptive icon's 66 dp safe zone, and the monochrome layer is the same shape in black, which Android tints for themed icons.
- Accessibility still applies: labels, roles, touch targets, and TalkBack behave like the extension's [UI rules](ui.md#accessibility) intend.
- CI builds a debug APK on `apps/mobile/**` changes; releases are signed in `release.yml` ([CI](ci.md#android-app)).
