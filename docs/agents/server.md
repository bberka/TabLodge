# Sync server (`apps/server`)

Hono sync server: Docker image (Node, SQLite) or Cloudflare Worker with Durable Object. Users: [Self hosting](../self-hosting.md); [Architecture](../architecture.md#sync-protocol) and [ADR 1](../adr/0001-record-level-sync-protocol.md): protocol.

## Where things are

| Path | Holds |
| --- | --- |
| `src/` | API (`api.ts`), SQLite change log, Node entry (`node.ts`), Worker entry (`worker.ts`) |
| `scripts/` | `cloudflare-deploy.ts` (bundles button's Worker), `deploy-cloudflare.ts`, `setup-cloudflare.ts`, `transfer.ts` |
| `cloudflare-deploy/` | Button copy, update workflow, generated `worker.js`, shared `deploy.js` |
| `Dockerfile`, `compose*.yaml`, `wrangler.jsonc` | Docker, Cloudflare deployment |

Protocol code (`apps/extension/src/shared/sync/`) shared with extension and Android app; server imports it from there.

## Rules

- After changing `src/` or shared sync code, run `pnpm run cf:bundle` and commit `cloudflare-deploy/worker.js`. Test fails while stale.
- Keep `cloudflare-deploy/wrangler.jsonc` and `wrangler.jsonc` in step (name, compatibility date, Durable Object binding, migrations, vars). Test checks it.
- Never remove `migrations` entry or add `deleted_classes` migration for `SyncLibrary`: deletes stored library.
- Bump `PROTOCOL_VERSION` (`apps/extension/src/shared/sync/change-log.ts`) only for change old clients cannot use, and add its first release to `PROTOCOL_RELEASES` in `apps/extension/src/shared/sync/compat.ts`.
- New entry in `features` gets row in `SERVER_FEATURES` in `compat.ts` (what stops working without it, and release that adds it), so both apps list it when server lacks it, and row in feature table of [Self hosting](../self-hosting.md#update).
- Docker build copies `apps/server`, `apps/extension/src/shared`, root workspace files, and `patches/` (pnpm needs every listed patch, even for packages filter skips); add to Dockerfile when server imports another path.
- Image and release workflows: [CI](ci.md#sync-server-image).
