# Sync server

Load [server.md](../../docs/agents/server.md) before editing here.

- After changing `src/` or `apps/extension/src/shared/sync/`, run `pnpm run cf:bundle`, commit `cloudflare-deploy/worker.js`. Deploy to Cloudflare button copies that file, not source. Test fails while stale.
- Never remove Durable Object `migrations` entry or add `deleted_classes` migration for `SyncLibrary`. Either deletes stored library.
- Bump `PROTOCOL_VERSION` only for change old clients cannot use. Both apps stop syncing with server on another protocol.
