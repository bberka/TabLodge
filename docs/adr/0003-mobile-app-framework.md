# 3. Mobile app framework

Status: proposed, 2026-11-12. Draft pull request on `feat/mobile-app`.

## Context

Issue #1 recommended staying extension first. The maintainer chose to build a phone app anyway, with a small scope: a link saver like Raindrop. It saves links into bookmark columns and opens them. It also shows sessions, because a phone browser cannot create them, and it syncs through the [self hosted server](../self-hosting.md). Android comes first, as an APK. iOS waits for a separate decision.

The extension and the sync server are TypeScript, and the sync client in `src/shared/sync/` uses no browser APIs.

## Decision

* **Expo with React Native and TypeScript**, in a `mobile/` workspace of this repository.
* **Android only for now.** `app.json` lists `android` as the only platform. The Android package id is `com.bberka.tablodge`.
* **Development builds, not Expo Go.** The share sheet target needs native configuration, which `expo prebuild` generates. The `android/` folder is generated and ignored.
* **Shared code later.** The model types, sync client, and crypto move to a shared package once the app needs them, so the extension keeps working at every step.

## Rejected

* **Flutter, Swift and Kotlin, Kotlin Multiplatform.** None share code with the TypeScript extension and server.
* **Capacitor.** It reuses the most UI, but a web view feels less native and handles the share target poorly.

## Consequences

* A second toolchain (JDK, Android SDK, Gradle) for anyone building the app.
* Expo pins exact versions, so `mobile/package.json` is exempt from the caret range lint rule.
* Sessions are read only on the phone. Restoring windows and tab groups has no phone equivalent.
* iOS needs a share extension, a US$99 yearly developer account, and a pass through App Review guideline 4.2.2. That decision is left open.
