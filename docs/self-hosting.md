# Self hosting the sync server

The sync server keeps one TabLodge library and passes changes between your devices. You can run it with Docker on your own machine or server, or on your own Cloudflare account. Both run the same code and follow the same rules ([ADR 1](adr/0001-record-level-sync-protocol.md)).

> **Status:** the server works, but the extension cannot connect to it yet. Sync in the extension is the next step of issue #3. Until then, the server is only useful for testing.

The server sees your library in plain text: URLs, titles, and notes. Run it somewhere you trust, and always put it behind HTTPS.

## The token

One server holds one library, protected by one token. Every device sends the token with each request, so anyone who has it can read and change the library. It must be at least 32 characters. Generate one with:

```sh
openssl rand -base64 32
```

To replace a leaked token, set a new one and restart the server (Docker) or run the setup script with `--rotate-token` (Cloudflare), then enter the new token on each device.

## Docker

You need Docker with Compose and a copy of this repository.

```sh
cd server
echo "TABLODGE_SYNC_TOKEN=$(openssl rand -base64 32)" > .env
docker compose up -d
```

The server listens on port 8787 and keeps the library in the `tablodge-sync` volume (`/data/library.db` in the container). `curl http://localhost:8787/health` answers `{"ok":true}` when it is up, and the container reports itself healthy.

Put a reverse proxy with HTTPS in front of it, such as Caddy or nginx, and make sure the proxy passes WebSocket upgrades on `/v1/live`. With Caddy, this is enough:

```text
sync.example.com {
	reverse_proxy localhost:8787
}
```

To update, pull the repository and run `docker compose up -d --build`. The library stays in the volume. To back it up, copy `library.db` while the server is stopped, or keep using TabLodge's own full backup.

Without Compose, build and run the image from the repository root:

```sh
docker build -f server/Dockerfile -t tablodge-sync .
docker run -d --name tablodge-sync -p 8787:8787 -v tablodge-sync:/data \
	-e TABLODGE_SYNC_TOKEN="$(openssl rand -base64 32)" tablodge-sync
```

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `TABLODGE_SYNC_TOKEN` | none, required | The token devices send |
| `PORT` | `8787` | Port to listen on |
| `DATA_DIR` | `/data` in the image | Folder for `library.db` |
| `MAX_RECORDS` | `500000` | Records the library may hold, deletes included |
| `RETENTION_DAYS` | `90` | How long a delete is remembered for devices that are offline |

## Cloudflare

This runs the server as a Worker with one Durable Object on your own Cloudflare account. SQLite backed Durable Objects are included in the Workers Free plan within its daily limits, which one person's library should stay under; check Cloudflare's pricing page for the current numbers. Live connections use WebSocket hibernation, so an idle connection costs nothing, and the Worker turns away requests with a wrong token before they reach the Durable Object.

You need Node.js 24 or later, pnpm, and a copy of this repository. From the repository root:

```sh
pnpm install
pnpm --filter tablodge-sync-server cf:setup
```

The script logs you in to Cloudflare if needed, deploys the Worker, creates a token, stores it as a Worker secret, and prints the address (`https://tablodge-sync.<your-subdomain>.workers.dev`) and the token. Run it again after pulling updates; the token stays the same unless you pass `--rotate-token`.

To use your own domain, add a custom domain to the `tablodge-sync` Worker in the Cloudflare dashboard. `MAX_RECORDS` and `RETENTION_DAYS` are set under `vars` in `server/wrangler.jsonc`.

To try it locally without an account, put `TABLODGE_SYNC_TOKEN=<token>` in `server/.dev.vars` and run `pnpm --filter tablodge-sync-server cf:dev`.

## API

All paths except `/health` need `Authorization: Bearer <token>`.

| Request | Answer |
| --- | --- |
| `GET /health` | `{"ok":true}` |
| `GET /v1/status` | Protocol version, current cursor, record count, and limits |
| `GET /v1/changes?cursor=<n>&purged=<n>&limit=<n>` | The changes after `cursor` (at most 1000), the new cursor, whether more are waiting, and `purged`, the server's purge marker, which the device sends back with its next pull. Or `{"resync":true}` when deletes the device has not seen were purged, so it must start again from cursor 0 |
| `POST /v1/changes` with `{"changes":[...]}` | One result per change: `applied`, `superseded`, `stale`, or `clock`, and the new cursor. At most 500 changes and 8 MB per request, and 256 KB per change |
| `GET /v1/live` (WebSocket) | Send `{"type":"auth","token":"..."}` first. The server answers `{"type":"ready","cursor":n}` and then `{"type":"cursor","cursor":n}` after every push that changed something. Send `ping` to get `pong` |

A full library answers a push with status 507 unless every change in it is a delete.
