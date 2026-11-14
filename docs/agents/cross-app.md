# Cross app work

The apps share one library format and one sync protocol, so a feature in one app can need work in another. Decide that before coding.

## Shared code

`apps/extension/src/shared/` is the code the extension, the server, and the Android app share: the data types (`types.ts`), library storage, the sync protocol and client, private library crypto, and link helpers. Page code in `src/app/` is extension only, and a lint rule stops the server and the Android app importing it. `grep -rn "extension/src" apps/mobile apps/server` lists every shared import. When you change one of these files:

- Keep it free of browser and Node APIs.
- Run `vp run check`, which type checks and tests all apps, and `pnpm run mobile:export` when the Android app imports it.
- Run `pnpm run cf:bundle` when the sync protocol changed.

## Feature triage

When a feature touches data, sync, settings, or link handling, answer each question and put the answers in the issue or pull request:

1. **Android app.** Would users expect it there? Does the stored library or a setting that now syncs need a matching change, or at least a safe fallback (`apps/mobile/src`)? Does an old app version still read the data?
2. **Server.** Does the protocol, a limit, or a record type change? Then old clients and servers must keep working, or `PROTOCOL_VERSION` moves.
3. **Website and docs.** Features, permissions, FAQ, and screenshots: see [Documentation](documentation.md#keep-current).
4. **Privacy.** New stored data or network behavior goes into [PRIVACY.md](../PRIVACY.md).

A feature that belongs to one app only needs the answer "not applicable" and no more. The 'challenge-feature' skill helps decide whether a feature is worth building.

## Issues

Triage and labels are in [Issues](issue-tracker.md).
