# Android app (`apps/mobile`)

Expo and React Native, TypeScript. It syncs with the user's own sync server and reads the same library as the extension. [ADR 3](../adr/0003-mobile-app-framework.md) records why; the [README](../README.md#android-app) lists what it does today.

## Where things are

| Path | Holds |
| --- | --- |
| `src/` | App code: library, sync wiring, screens, settings |
| `modules/tablodge-crypto/` | Local native module (PBKDF2 and AES-GCM for the private library) |
| `scripts/build-apk.mts` | `pnpm run mobile:apk`: a standalone APK from this checkout |
| `tests/` | Vitest suites for the logic that does not need a device |

The app imports types and the sync client from `apps/extension/src` by relative path (Metro watches the repository root). Those files must stay free of browser APIs, and `apps/extension/src/shared` changes can break this app: see [Cross app work](cross-app.md).

## Rules

- Expo pins exact versions. Add packages with `pnpm --filter tablodge-mobile exec expo install <package>`.
- Pure logic goes in a plain `.ts` file with a test in `tests/`, not inside a screen.
- Proof comes from an emulator or a device, not the browser. Start the emulator with a visible window and software GPU: `emulator -avd <name> -no-audio -gpu swiftshader_indirect`, and keep sample data off any real server. Report the Android version, the Material or iOS look, and whether TalkBack, dark theme, or a small screen were not checked. Details: [Proof](validation.md#proof).
- Accessibility still applies: labels, roles, touch targets, and TalkBack behave like the extension's [UI rules](ui.md#accessibility) intend.
- CI builds a debug APK on `apps/mobile/**` changes; releases are signed in `release.yml` ([CI](ci.md#android-app)).
