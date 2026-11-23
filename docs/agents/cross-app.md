# Cross app work

Apps share one library format and one sync protocol, so feature in one app can need work in another. Decide that before coding.

## Shared code

`apps/extension/src/shared/` is code extension, server, Android app share: data types (`types.ts`), library storage, sync protocol and client, private library crypto, link helpers. Page code in `src/app/` is extension only, lint rule stops server and Android app importing it. `grep -rn "extension/src" apps/mobile apps/server` lists every shared import. When you change one of these files:

- Keep it free of browser and Node APIs.
- Run `vp run check`, which type checks and tests all apps, and `pnpm run mobile:export` when Android app imports it.
- Run `pnpm run cf:bundle` when sync protocol changed.

## Feature triage

Every feature ships complete in both extension and Android app. Each app works alone, without sync server and without other app. Only feature that depends on server by nature, such as site icons or page copies fetched through it, or publishing, may need connected server, and without one it fails quietly. Feature only one platform can do, such as Android Quick Settings tiles or reading saved lists from site pages in browser, answers "not applicable" for other app and says why. Other apps get its results through ordinary sync.

**Behavior parity.** One action or setting behaves same in both apps: duplicates on save, click and open targets, sort orders, tracking parameter cleanup, Undo and confirm, names, messages, defaults. Differ only where platform cannot, and say why in spec and pull request. Change both apps in one pull request, or file linked issue there when other needs separate work. Put shared logic in `src/shared`.

**Entry points.** Every new feature, and every pull request that adds user action, checks where else action belongs. In extension that is right-click menu for link, page, image, video, audio, or selection. New item follows `apps/extension/src/shared/context-menu-plan.ts`: TabLodge root for that context, then context's bookmark item (**Bookmark link to**, **Bookmark this page to**), column submenu, and **New column**. #268 trimmed menus, so item goes under that root, never at top level. On Android matching places are share sheet, launcher app shortcuts, and Quick Settings tile where one fits. Both apps also have search that reaches features: when you add feature, setting, or Settings section, decide whether it belongs in global finder (extension) and in search (Android). If it does, add it in same pull request. If not, say why in pull request. Triage carries `Entry points:` line, even when answer is none.

When feature touches data, sync, settings, or link handling, answer each question and put answers in [spec](spec-driven.md) on issue, and in pull request when no issue exists:

1. **Other app.** What does it need in other app, or why not applicable there? Does stored library or setting that now syncs need matching change, or at least safe fallback (`apps/mobile/src`)? Does old app version still read data?
2. **Server.** Does protocol, limit, or record type change? Then old clients and servers must keep working, or `PROTOCOL_VERSION` moves. New field on synced record does not survive old extensions: their normalizer drops unknown fields and pushes loss back. Send it as record kind of its own behind `features` flag, as bookmark notes do ([ADR 5](../adr/0005-bookmark-notes-sync.md)).
3. **Website and docs.** Features, permissions, FAQ, screenshots: see [Documentation](documentation.md#keep-current).
4. **Privacy.** New stored data or network behavior goes into [PRIVACY.md](../PRIVACY.md).

**Settings.** New feature thinks through use cases and settings they could call for. Triage carries `Settings:` line: what was considered, what was added, why rest stays fixed. Today's behavior is default; setting earns its place.

**Sync scope.** Every setting has one scope and reason in `src/shared/setting-scopes.ts` ([ADR 11](../adr/0011-setting-sync-scopes.md)): `all` by default (both apps read it), `platform` (all browsers or all phones, when other app has no use for it, such as theme), or `device`, which never syncs and is only for what cannot mean anything on another device: its name, connection, permission only it grants, installed apps, private library, dismissals and remembered state. Two phones are two devices. Tests enforce it.

The 'challenge-feature' skill helps decide whether feature is worth building.

## Issues

Triage and labels are in [Issues](issue-tracker.md).
