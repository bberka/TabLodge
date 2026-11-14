# Extension (`apps/extension`)

The Chrome, Brave, and Firefox extension (Manifest V3). It also holds the code the other apps share: `src/shared/` (library storage, the sync protocol and client) and the data types in `src/app/types.ts`. A change there can reach the server and the Android app, so read [Cross app work](cross-app.md) before editing it.

## Where things are

| Path | Holds |
| --- | --- |
| `shell/` | `manifest.json`, icons, HTML shells, `service-worker.ts`, boot scripts |
| `src/app/` | Pages, data model, messages |
| `src/components/ui/` | Radix and Tailwind primitives |
| `scripts/` | Build, packaging, verification, dev browser, accessibility checks |
| `tests/` | Vitest suites (the worker runs in a VM with mocked `chrome.*`) |

[Architecture](../architecture.md) explains storage, messages, sync, private windows, and Firefox differences. Read the section for the area you touch.

## Rules

- Strict TypeScript, no `any` escapes. Treat stored data, imports, and messages as untrusted and validate them. The service worker is one classic script and cannot import; mirrors of shared lists are kept equal by tests.
- Changes to storage keys, export format identifiers, drag MIME types, or context menu IDs need a migration.
- Read the display name from `PROJECT.name` in pages or `APP_NAME` in the worker (both the manifest's `short_name`).
- Bundle everything locally: no CDN imports, remote fonts, or network calls. A new permission needs a stated reason in the [README permissions table](../README.md#permissions-and-privacy) and the [privacy policy](../PRIVACY.md).
- Test on Chrome and Firefox when a change touches what they treat differently ([Browser support](../architecture.md#browser-support)).
- Add a regression test for a bug fix. Extend the `chrome.*` mock in the worker tests when you use another API.
- UI work follows [UI rules](ui.md).

## Commands

Use `vp run <task>` from the repository root: `dev:chrome`, `dev:firefox`, `build`, `pack`, `browser:firefox`, `a11y`. The list is in the [README](../README.md#development) and `apps/extension/package.json`. The dev browser keeps its profile in `apps/extension/.dev/`, and builds land in `apps/extension/dist/`. Load the same build folder every time: another path gives the extension a different ID and separate storage.
