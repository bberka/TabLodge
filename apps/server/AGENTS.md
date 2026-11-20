# Sync server

Load [server.md](../../docs/agents/server.md) before editing here.

- After changing `src/` or `apps/extension/src/shared/sync/`, run `pnpm run cf:bundle` and commit `cloudflare-deploy/worker.js`. The Deploy to Cloudflare button copies that file, not the source, and a test fails while it is stale.
- Never remove the Durable Object `migrations` entry or add a `deleted_classes` migration for `SyncLibrary`. Either deletes the stored library.
- Bump `PROTOCOL_VERSION` only for a change old clients cannot use. Both apps stop syncing with a server on another protocol.
