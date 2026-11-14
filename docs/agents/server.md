# Sync server (`apps/server`)

A Hono server for self hosters, as a Docker image (Node, SQLite) or a Cloudflare Worker with a Durable Object. Users read [Self hosting](../self-hosting.md); [Architecture](../architecture.md#sync-protocol) and [ADR 1](../adr/0001-record-level-sync-protocol.md) describe the protocol.

## Where things are

| Path | Holds |
| --- | --- |
| `src/` | API (`api.ts`), SQLite change log, Node entry (`node.ts`), Worker entry (`worker.ts`) |
| `scripts/` | `cloudflare-deploy.ts` (bundles the button's Worker), `setup-cloudflare.ts`, `transfer.ts` |
| `cloudflare-deploy/` | What the Deploy to Cloudflare button copies; `worker.js` is generated |
| `Dockerfile`, `compose*.yaml`, `wrangler.jsonc` | Docker and Cloudflare deployment |

The protocol code (`apps/extension/src/shared/sync/`) is shared with the extension and the Android app, and the server imports it from there.

## Rules

- After changing `src/` or the shared sync code, run `pnpm run cf:bundle` and commit `cloudflare-deploy/worker.js`. A test fails while it is stale.
- Keep `cloudflare-deploy/wrangler.jsonc` and `wrangler.jsonc` in step (name, compatibility date, Durable Object binding, migrations, vars). A test checks it.
- Never remove the `migrations` entry or add a `deleted_classes` migration for `SyncLibrary`: it deletes the stored library.
- Bump `PROTOCOL_VERSION` only for a change old clients cannot use.
- The Docker build copies `apps/server`, `apps/extension/src/shared`, and the root workspace files; add to the Dockerfile when the server imports another path.
- Image and release workflows: [CI](ci.md#sync-server-image).
