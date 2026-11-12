# 3. Mobile app framework

Status: proposed, 2026-11-12. Draft pull request on `feat/mobile-app`.

## Context

Issue #1 recommended staying extension first. The maintainer chose to build a phone app anyway, with a small scope: a link saver like Raindrop. It saves links into bookmark columns and opens them. It also shows sessions, because a phone browser cannot create them, and it syncs through the [self hosted server](../self-hosting.md). Android comes first, as an APK. iOS waits for a separate decision.

The extension and the sync server are TypeScript, and the sync client in `src/shared/sync/` uses no browser APIs.

## Decision

* **Expo with React Native and TypeScript**, in a `mobile/` workspace of this repository.
* **Android only for now.** `app.json` lists `android` as the only platform. The Android package id is `com.bberka.tablodge`.
* **Development builds, not Expo Go.** The share sheet target needs native configuration, which `expo prebuild` generates. The `android/` folder is generated and ignored.
* **Shared code by import.** The app imports the model types and the sync client straight from `src/` with relative paths, and Metro watches the repository root. Both are free of browser APIs, so nothing moved and the extension is untouched. `mobile/src/chrome.d.ts` declares the one Chrome type the model names. If the app later needs more shared code, it moves to a package then.
* **Storage.** The token is in the Android keystore (expo-secure-store). The library and sync state are in SQLite (expo-sqlite key value store), which has no size limit like AsyncStorage.
* **Development data.** Dev builds seed the extension's dev fixture into an empty library (`mobile/src/seed.ts`). It is required inside a `__DEV__` conditional so Metro drops it from release bundles, and it is never synced.
* **Look.** Two looks, Material and iOS, switched in Settings and defaulting to the phone's own. They differ in colors, shapes, the tab bar, headers, switches, and where Add link sits. The tab bar can also float, which is off by default. Gestures (swipe rows, the drawer) use React Native's own `PanResponder` and `Animated`, so no native gesture library is needed. Every swipe action also exists as a screen reader action and in selection mode, so none depends on a gesture.
* **Share sheet.** `expo-share-intent` adds the Android `SEND text/*` filter. Prebuild generates it in the manifest.

## Rejected

* **Flutter, Swift and Kotlin, Kotlin Multiplatform.** None share code with the TypeScript extension and server.
* **Capacitor.** It reuses the most UI, but a web view feels less native and handles the share target poorly.

## Consequences

* A second toolchain (JDK, Android SDK, Gradle) for anyone building the app.
* Expo pins exact versions, so `mobile/package.json` is exempt from the caret range lint rule.
* Sessions are read only on the phone. Restoring windows and tab groups has no phone equivalent.
* iOS needs a share extension, a US$99 yearly developer account, and a pass through App Review guideline 4.2.2. That decision is left open.
