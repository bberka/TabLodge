# Cross app work

The apps share one library format and one sync protocol, so a feature in one app can need work in another. Decide that before coding.

## Shared code

`apps/extension/src/shared/` is the code the extension, the server, and the Android app share: the data types (`types.ts`), library storage, the sync protocol and client, private library crypto, and link helpers. Page code in `src/app/` is extension only, and a lint rule stops the server and the Android app importing it. `grep -rn "extension/src" apps/mobile apps/server` lists every shared import. When you change one of these files:

- Keep it free of browser and Node APIs.
- Run `vp run check`, which type checks and tests all apps, and `pnpm run mobile:export` when the Android app imports it.
- Run `pnpm run cf:bundle` when the sync protocol changed.

## Feature triage

Every feature ships complete in both the extension and the Android app. Each app works alone, without a sync server and without the other app. Only a feature that depends on the server by nature, such as site icons or page copies fetched through it, or publishing, may need a connected server, and without one it fails quietly. A feature that only one platform can do, such as Android Quick Settings tiles or reading saved lists from site pages in the browser, answers "not applicable" for the other app and says why. The other apps get its results through ordinary sync.

**Entry points.** Every new feature, and every pull request that adds a user action, checks where else the action belongs. In the extension that is the right-click menu for a link, page, image, video, audio, or selection. A new item follows `apps/extension/src/shared/context-menu-plan.ts`: the TabLodge root for that context, then the context's bookmark item (**Bookmark link to**, **Bookmark this page to**), the column submenu, and **New column**. #268 trimmed the menus, so the item goes under that root, never at the top level. On Android the matching places are the share sheet, launcher app shortcuts, and a Quick Settings tile where one fits. The triage carries an `Entry points:` line, even when the answer is none.

When a feature touches data, sync, settings, or link handling, answer each question and put the answers in the issue or pull request:

1. **Other app.** What does it need in the other app, or why is it not applicable there? Does the stored library or a setting that now syncs need a matching change, or at least a safe fallback (`apps/mobile/src`)? Does an old app version still read the data?
2. **Server.** Does the protocol, a limit, or a record type change? Then old clients and servers must keep working, or `PROTOCOL_VERSION` moves.
3. **Website and docs.** Features, permissions, FAQ, and screenshots: see [Documentation](documentation.md#keep-current).
4. **Privacy.** New stored data or network behavior goes into [PRIVACY.md](../PRIVACY.md).

The 'challenge-feature' skill helps decide whether a feature is worth building.

## Issues

Triage and labels are in [Issues](issue-tracker.md).
