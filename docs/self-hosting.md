# Self hosting the sync server

TabLodge can keep your library the same on several browsers through a sync server that you run yourself. There is no TabLodge cloud: the server belongs to you, holds one library, and is protected by one token.

This guide covers setting the server up, connecting your browsers, and looking after it. For how sync decides between two edits, see [ADR 1](adr/0001-record-level-sync-protocol.md). For what is sent, see [Privacy](PRIVACY.md#sync-with-your-own-server).

* [Choose where to run it](#choose-where-to-run-it)
* [Create a token](#create-a-token)
* [Option A: a VPS with Docker and HTTPS](#option-a-a-vps-with-docker-and-https)
* [Option B: Cloudflare](#option-b-cloudflare)
* [Option C: Docker on this computer](#option-c-docker-on-this-computer)
* [Connect your browsers](#connect-your-browsers)
* [Look after the server](#look-after-the-server)
* [Troubleshooting](#troubleshooting)
* [Reference](#reference)

## Choose where to run it

| | Option A: VPS with Docker | Option B: Cloudflare | Option C: this computer |
| --- | --- | --- | --- |
| You need | A small Linux server, a domain or subdomain | A Cloudflare account, Node.js on your computer | Docker |
| Cost | The server (a 512 MB VPS is plenty) | Usually nothing on the Workers Free plan | Nothing |
| HTTPS | Automatic, through Caddy | Automatic | Not needed for the same computer |
| Works from other devices | Yes | Yes | No, only browsers on this computer |
| Your data lives | On your server | In your Cloudflare account | On this computer |

The server stores your sessions, saved tabs, bookmarks, and notes in plain text. Whoever runs the machine can read them, so pick a place you trust. Every option keeps working if the server goes away: each browser keeps its own complete library.

## Create a token

The token is the only thing that protects the server. Every browser sends it with each request, and anyone who has it can read and change your library. It must be at least 32 characters. Create one with:

```sh
openssl rand -base64 32
```

Keep it somewhere safe, such as a password manager. You enter it once in each browser.

## Option A: a VPS with Docker and HTTPS

This runs the sync server and [Caddy](https://caddyserver.com) side by side. Caddy gets an HTTPS certificate for your domain from Let's Encrypt, renews it, and passes requests to the sync server, which is not reachable from outside on its own.

### 1. Prepare the server and the domain

* A Linux VPS with at least 512 MB of memory. Any distribution that runs Docker works, on amd64 or arm64.
* A domain or subdomain, such as `sync.example.com`, with a DNS `A` record (and `AAAA` for IPv6) pointing at the server's address.
* Ports 80 and 443 open. Caddy needs port 80 to get the certificate. With `ufw`:

  ```sh
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  ```

* Docker with the Compose plugin. If it is missing, Docker's own install script sets up both:

  ```sh
  curl -fsSL https://get.docker.com | sudo sh
  ```

### 2. Start it

```sh
mkdir tablodge-sync && cd tablodge-sync
curl -fsSLO https://raw.githubusercontent.com/bberka/TabLodge/master/server/compose.https.yaml
cat > .env <<EOF
TABLODGE_DOMAIN=sync.example.com
TABLODGE_SYNC_TOKEN=$(openssl rand -base64 32)
EOF
chmod 600 .env
docker compose -f compose.https.yaml up -d
```

Replace `sync.example.com` with your domain. Read the token back with `grep TOKEN .env`.

### 3. Check it

```sh
curl https://sync.example.com/health
```

It answers `{"ok":true}`. The first answer can take a minute while Caddy gets the certificate. If it does not come, see [Troubleshooting](#troubleshooting). Then [connect your browsers](#connect-your-browsers) with `https://sync.example.com` and the token.

### Without Caddy

If the server already runs a reverse proxy, start only the sync server and point the proxy at it. The proxy must pass WebSocket upgrades on `/v1/live`, or changes only arrive every few minutes instead of right away.

```sh
TOKEN="$(openssl rand -base64 32)" && echo "$TOKEN"
docker run -d --name tablodge-sync --restart unless-stopped -p 127.0.0.1:8787:8787 -v tablodge-sync:/data \
	-e TABLODGE_SYNC_TOKEN="$TOKEN" ghcr.io/bberka/tablodge-sync:latest
```

For nginx, the location needs `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, and `proxy_set_header Connection "upgrade"`. Caddy, Traefik, and Cloudflare Tunnel pass WebSockets without extra settings.

## Option B: Cloudflare

This runs the server as a Worker with one Durable Object on your own Cloudflare account. SQLite backed Durable Objects are part of the Workers Free plan within its daily limits, which one person's library should stay far under; check Cloudflare's pricing page for the current numbers. Idle live connections cost nothing, and requests with a wrong token are turned away before they reach your data.

### 1. What you need

* A Cloudflare account.
* Node.js 24 or later, pnpm, and Git on your computer.

### 2. Deploy

```sh
git clone https://github.com/bberka/TabLodge.git
cd TabLodge
pnpm install
pnpm run cf:setup
```

The script opens a browser window to log in to Cloudflare if needed. It then deploys the Worker, creates a token, stores it as a Worker secret, and prints the address (`https://tablodge-sync.<your-subdomain>.workers.dev`) and the token. The token is shown only once, so save it.

### 3. Check it

```sh
curl https://tablodge-sync.<your-subdomain>.workers.dev/health
```

It answers `{"ok":true}`. For a few seconds right after the first deploy, Cloudflare may answer `error code: 1042` instead; wait a moment and try again. Then [connect your browsers](#connect-your-browsers).

### Your own domain

In the Cloudflare dashboard, open the `tablodge-sync` Worker and add a custom domain in its settings, for example `sync.example.com` on a zone you have on Cloudflare. Use that address in TabLodge instead.

### Settings on Cloudflare

`MAX_RECORDS`, `RETENTION_DAYS`, and `RATE_LIMIT_PER_MINUTE` are under `vars` in `server/wrangler.jsonc`. Change them and run `cf:setup` again. To try the Worker without an account, put `TABLODGE_SYNC_TOKEN=<token>` in `server/.dev.vars` and run `pnpm run cf:dev`.

## Option C: Docker on this computer

For one computer with several browsers or browser profiles, or for trying sync out:

```sh
TOKEN="$(openssl rand -base64 32)" && echo "$TOKEN"
docker run -d --name tablodge-sync --restart unless-stopped -p 127.0.0.1:8787:8787 -v tablodge-sync:/data \
	-e TABLODGE_SYNC_TOKEN="$TOKEN" ghcr.io/bberka/tablodge-sync:latest
```

Connect with `http://localhost:8787`. TabLodge accepts plain HTTP only for `localhost` and `127.0.0.1`; any other address needs HTTPS, because the token and your library travel with every request. Firefox upgrades the live connection to a secure one, which a plain HTTP server cannot answer, so in Firefox this setup syncs when something changes, every five minutes, and on **Sync now**, but not instantly.

To build the image from a copy of this repository instead, run `docker compose up -d` in `server/` after putting `TABLODGE_SYNC_TOKEN=<token>` in `server/.env`.

## Connect your browsers

Do this in every browser and browser profile that should share the library.

1. Open TabLodge **Settings › Sync**.
2. Enter the server address (for example `https://sync.example.com`) and the token.
3. Choose **Connect**.

The first browser sends its library to the server. Each further browser merges with it: items only it has are sent, and for items both sides have, the server's copy wins. Before the first sync writes anything, TabLodge saves a safety backup you can restore from **Settings › Recovery**. If two browsers already hold the same library from an imported backup, connect the one with the newest data first.

While sync is on, a cloud icon in the dashboard header shows whether everything is up to date, changes are waiting, or the server cannot be reached, and opens the Sync settings. **Sync now** syncs at once. Changes made offline are sent when the server can be reached again.

Sessions, saved tabs, folders, bookmark columns, bookmarks, and display preferences sync. Recovery snapshots, backups, the trash bin, private windows, and per browser settings such as the new tab page do not. When two browsers change the same item at the same time, the later change wins.

## Look after the server

### Check on it

* `curl https://<your address>/health` answers `{"ok":true}`.
* **Settings › Sync** shows the last sync time and any error.
* On Docker, `docker compose -f compose.https.yaml ps` shows `healthy`, and `docker compose -f compose.https.yaml logs sync` shows the server's messages. The logs are capped at 2 MB.

### Update

On a VPS:

```sh
docker compose -f compose.https.yaml pull
docker compose -f compose.https.yaml up -d
```

With a single `docker run` container, run `docker pull ghcr.io/bberka/tablodge-sync:latest`, then `docker rm -f tablodge-sync`, then start it again with the same command and token. The library is in the `tablodge-sync` volume and stays.

On Cloudflare, run `git pull`, `pnpm install`, and `pnpm run cf:setup` in your copy of the repository. The token stays.

`latest` is the newest released server. `edge` follows development and can change at any time.

### Back up and restore

A backup is one file with every item and every recorded delete, in a format any TabLodge sync server can load.

On Docker, the server image makes it:

```sh
docker compose -f compose.https.yaml exec -T sync node node.js export > tablodge-sync-backup.jsonl
```

To restore it into the server, for example after losing the volume:

```sh
docker compose -f compose.https.yaml exec -T sync node node.js import < tablodge-sync-backup.jsonl
```

With a single `docker run` container, use `docker exec -i tablodge-sync node node.js export` and `import` the same way.

For any server, Cloudflare included, a copy of the repository and Node.js 24 do the same over the network:

```sh
export TABLODGE_SYNC_TOKEN='<token>'
node server/scripts/transfer.ts export --url https://sync.example.com > tablodge-sync-backup.jsonl
node server/scripts/transfer.ts import --url https://sync.example.com < tablodge-sync-backup.jsonl
```

Importing keeps the newer version of anything the server already has, so it never overwrites newer work. After a server is restored from an older backup, connected browsers notice by themselves and send it everything it lost. Nothing needs to be done in TabLodge.

Each browser's own full backup (**Settings › Data › Back up**) also stays a complete copy of the library.

### Change the token

Do this if the token may have leaked.

* VPS: put a new token in `.env` (`openssl rand -base64 32`), then run `docker compose -f compose.https.yaml up -d`. The library is kept.
* Single container: remove it and start it again with a new `TABLODGE_SYNC_TOKEN`.
* Cloudflare: run `pnpm run cf:setup --rotate-token` and save the new token it prints.

Then in each browser, open **Settings › Sync**, choose **Disconnect**, and connect again with the new token. Nothing is lost: each browser keeps its library and merges with the server again.

### Move to another server

1. Export the library from the old server (see [Back up and restore](#back-up-and-restore)).
2. Set up the new server and import the file into it.
3. In each browser, **Disconnect**, then connect to the new address.
4. Delete the old server once every browser syncs with the new one.

This works in every direction, for example from a VPS to Cloudflare.

### Stop syncing and delete the server's copy

1. In each browser, open **Settings › Sync** and choose **Disconnect**. Each browser keeps its whole library.
2. Delete the server and its data:
   * VPS: `docker compose -f compose.https.yaml down -v` deletes the containers, the library, and Caddy's certificates.
   * Single container: `docker rm -f tablodge-sync && docker volume rm tablodge-sync`.
   * Cloudflare: run `pnpm run cf:delete`, or delete the `tablodge-sync` Worker in the dashboard. This deletes the library with it: deploying again afterwards starts with an empty server and a new token.

### Resources

One library is light. On a test machine the container used about 20 MB of memory and no measurable CPU at idle with a browser connected, about 60 MB at most while 50,000 records were pushed and pulled, and about 23 MB of disk for those 50,000 records. Caddy uses about 20 MB more. The image caps Node's memory at 128 MB, the Compose files limit the sync container to 256 MB and half a CPU core, and logs are capped. Answers are compressed, which makes a full sync several times smaller.

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| "The sync server refused the token." | The token in TabLodge differs from the server's | Copy it again; `grep TOKEN .env` on a VPS. After changing it, Disconnect and Connect again |
| "The sync server cannot be reached." | Wrong address, server down, or no network | Open `https://<address>/health` in the browser. On a VPS, check `docker compose -f compose.https.yaml ps` |
| `/health` does not answer over HTTPS on a new VPS | Caddy could not get a certificate | Check the DNS record points at the server and ports 80 and 443 are open, then read `docker compose -f compose.https.yaml logs caddy` |
| "The server address must start with https://" | Plain HTTP to another computer | Use Option A or B, or `localhost` for a server on this computer |
| Changes arrive only every few minutes | The live WebSocket does not get through | Make sure the reverse proxy passes WebSocket upgrades on `/v1/live`. In Firefox with a plain HTTP `localhost` server this is expected |
| "The sync server asked TabLodge to slow down." | More requests than `RATE_LIMIT_PER_MINUTE` | Sync tries again by itself. Raise the limit if it keeps happening |
| "The sync server is full." | More items than `MAX_RECORDS` | Delete sessions or bookmarks you no longer need, or raise the limit |
| "The server refused N old changes from this device" | The browser was offline for longer than `RETENTION_DAYS` and edited items deleted elsewhere meanwhile | The edited items stay in that browser but are not sent to the server. Recreate them if other browsers should have them |
| The token was printed by `cf:setup` and lost | Cloudflare keeps secrets unreadable | Run `cf:setup --rotate-token` and reconnect the browsers |

## Reference

### Commands

Run these from the root of your copy of the repository. Anything after the command name is passed on, as in `pnpm run cf:setup --rotate-token`.

| Command | What it does |
| --- | --- |
| `pnpm run cf:setup` | Deploys to Cloudflare, creating and printing a token on the first run. `--rotate-token` replaces the token |
| `pnpm run cf:deploy` | Deploys an update without touching the token |
| `pnpm run cf:dev` | Runs the Worker on this computer, with the token from `server/.dev.vars` |
| `pnpm run cf:delete` | Deletes the Worker and its library from Cloudflare |
| `pnpm run server:build` | Builds the Node server into `server/dist/node.js` |
| `pnpm run server:start` | Starts that build, with the token from `TABLODGE_SYNC_TOKEN` |
| `node server/scripts/transfer.ts export\|import` | Backs up or restores a library, see [Back up and restore](#back-up-and-restore) |

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `TABLODGE_SYNC_TOKEN` | none, required | The token browsers send, at least 32 characters |
| `TABLODGE_DOMAIN` | none | Your domain, for `compose.https.yaml` |
| `PORT` | `8787` | Port the sync server listens on |
| `DATA_DIR` | `/data` in the image | Folder for `library.db` |
| `MAX_RECORDS` | `500000` | Items the library may hold, deletes included |
| `RETENTION_DAYS` | `90` | How long a delete is remembered for browsers that are offline |
| `RATE_LIMIT_PER_MINUTE` | `300` | Requests per minute before the server answers 429 |

### Limits

| Limit | Value |
| --- | --- |
| Changes per push | 500 |
| Request size | 8 MB |
| One item | 256 KB |
| Changes per pull | 1000 |
| Live connections | 64 on Docker; one that sends no valid token in 10 seconds is closed |

### API

All paths except `/health` need `Authorization: Bearer <token>`. The server answers with CORS headers, so the extension needs no browser permission for its address.

| Request | Answer |
| --- | --- |
| `GET /health` | `{"ok":true}` |
| `GET /v1/status` | Protocol version, current cursor, record count, and limits |
| `GET /v1/changes?cursor=<n>&purged=<n>&limit=<n>` | The changes after `cursor`, the new cursor, whether more are waiting, and `purged`, the server's purge marker, which the browser sends back with its next pull. Or `{"resync":true}` when deletes the browser has not seen were purged, so it must start again from cursor 0 |
| `POST /v1/changes` with `{"changes":[...]}` | One result per change (`applied`, `superseded`, `stale`, or `clock`) and the new cursor |
| `GET /v1/live` (WebSocket) | Send `{"type":"auth","token":"..."}` first. The server answers `{"type":"ready","cursor":n}`, then `{"type":"cursor","cursor":n}` after every push that changed something. `ping` gets `pong` |

A full library answers a push with 507 unless every change in it is a delete. Too many requests get 429 with a `Retry-After` header.
