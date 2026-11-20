# Self hosting the sync server

TabLodge can keep your library the same on several browsers through a sync server that you run yourself. There is no TabLodge cloud. The server belongs to you, holds one library, and is protected by one token.

This guide covers setting the server up, connecting your browsers, and looking after it. To have an AI agent do the setup, use the [copy and paste prompts](README.md#set-up-sync-with-an-ai-agent). For how sync decides between two edits, see [ADR 1](adr/0001-record-level-sync-protocol.md). For what is sent, see [Privacy](PRIVACY.md#sync-with-your-own-server).

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
| You need | A small Linux server, a domain or subdomain | A Cloudflare account and a GitHub or GitLab account, nothing to install | Docker |
| Cost | The server (a 512 MB VPS is plenty) | Usually nothing on the Workers Free plan | Nothing |
| HTTPS | Automatic, through Caddy | Automatic | Not needed for the same computer |
| Works from other devices | Yes | Yes | No, only browsers on this computer |
| Your data lives | On your server | In your Cloudflare account | On this computer |

The server stores your sessions, saved tabs, bookmarks, and notes in plain text. Whoever runs the machine can read them, so pick a place you trust. If the server goes away, every option leaves each browser with its own complete library.

## Create a token

The token is the only thing that protects the server. Every browser sends it with each request, and anyone who has it can read and change your library. It must be at least 32 characters. Create one with:

```sh
openssl rand -base64 32
```

Or, in TabLodge, open **Settings › Sync** and choose **Generate token** in the **No server yet?** dialog. It makes a random token of 64 hexadecimal characters in the browser, copies it, and fills it in for you.

Keep the token somewhere safe, such as a password manager. You enter it once in each browser.

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
curl -fsSLO https://raw.githubusercontent.com/bberka/TabLodge/master/apps/server/compose.https.yaml
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

This runs the server as a Worker with one Durable Object on your own Cloudflare account. SQLite backed Durable Objects are part of the Workers Free plan within its daily limits, which one person's library should stay far under; check Cloudflare's pricing page for the current numbers. Idle live connections cost nothing, and requests with a wrong token are turned away before they reach your data. Views of [shared pages](#shared-pages) count against the same daily request limit, so a link that many people open can use it up and stop sync until the limit resets at midnight UTC.

### 1. Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bberka/TabLodge/tree/master/apps/server/cloudflare-deploy)

1. [Create a token](#create-a-token) and keep it at hand. The **No server yet?** button in **Settings › Sync** opens a dialog that walks through these same steps and has the button too.
2. Choose the button and log in to Cloudflare, or create a free account.
3. Connect your GitHub or GitLab account when asked. Cloudflare copies the server into a new repository there and deploys it from that repository.
4. Paste the token as the value of `TABLODGE_SYNC_TOKEN`, keep the other settings, and deploy.

When it finishes, Cloudflare shows the Worker's address, such as `https://tablodge-sync.<your-subdomain>.workers.dev`. That and the token are what you enter in TabLodge.

### Or deploy from your computer

This needs Node.js 24 or later, pnpm, and Git, and creates the token for you:

```sh
git clone https://github.com/bberka/TabLodge.git
cd TabLodge
pnpm install
pnpm run cf:setup
```

The script opens a browser window to log in to Cloudflare if needed. It then deploys the Worker, creates a token, stores it as a Worker secret, and prints the address (`https://tablodge-sync.<your-subdomain>.workers.dev`) and the token. The token is shown only once, so save it.

### 2. Check it

Open `https://tablodge-sync.<your-subdomain>.workers.dev/health` in a browser, or run:

```sh
curl https://tablodge-sync.<your-subdomain>.workers.dev/health
```

It answers `{"ok":true}`. For a few seconds right after the first deploy, Cloudflare may answer `error code: 1042` instead; wait a moment and try again. Then [connect your browsers](#connect-your-browsers).

### Your own domain

In the Cloudflare dashboard, open the `tablodge-sync` Worker and add a custom domain in its settings, for example `sync.example.com` on a zone you have on Cloudflare. Use that address in TabLodge instead.

### Settings on Cloudflare

`MAX_RECORDS`, `RETENTION_DAYS`, and `RATE_LIMIT_PER_MINUTE` are under `vars` in `wrangler.jsonc`. If you deployed with the button, edit that file in the repository Cloudflare created and commit; Cloudflare deploys the commit. If you deployed from your computer, edit `apps/server/wrangler.jsonc` and run `pnpm run cf:deploy`. To try the Worker without an account, put `TABLODGE_SYNC_TOKEN=<token>` in `apps/server/.dev.vars` and run `pnpm run cf:dev`.

## Option C: Docker on this computer

For one computer with several browsers or browser profiles, or for trying sync out:

```sh
TOKEN="$(openssl rand -base64 32)" && echo "$TOKEN"
docker run -d --name tablodge-sync --restart unless-stopped -p 127.0.0.1:8787:8787 -v tablodge-sync:/data \
	-e TABLODGE_SYNC_TOKEN="$TOKEN" ghcr.io/bberka/tablodge-sync:latest
```

Connect with `http://localhost:8787`. TabLodge accepts plain HTTP only for `localhost`, `127.0.0.1`, and `[::1]`. Any other address needs HTTPS, because the token and your library travel with every request. Firefox upgrades the live connection to a secure one, which a plain HTTP server cannot answer, so in Firefox this setup syncs when something changes, every five minutes, and on **Sync now**, but not instantly.

To build the image from a copy of this repository instead, put `TABLODGE_SYNC_TOKEN=<token>` in `apps/server/.env` and run `docker compose up -d` in `apps/server/`. Unlike the command above, `apps/server/compose.yaml` publishes port 8787 on every network interface, so other devices on your network can reach it.

## Connect your browsers

Do this in every browser and browser profile that should share the library.

1. Open TabLodge **Settings › Sync**.
2. Enter the server address (for example `https://sync.example.com`) and the token.
3. Choose **Connect**.

The first browser sends its library to the server. Each further browser merges with it: items only it has are sent, and for items both sides have, the server's copy wins. Before the first sync writes anything, TabLodge saves a safety backup you can restore from **Settings › Recovery**. If two browsers already hold the same library from an imported backup, connect the one with the newest data first.

While sync is on, a sync icon in the dashboard header shows whether everything is up to date, changes are waiting, or the server cannot be reached, and opens the Sync settings; its label says both, such as "Sync: up to date. Open Sync settings". **Sync now** syncs at once. Changes made offline are sent when the server can be reached again.

Sessions, saved tabs, folders, bookmark columns, bookmarks and their notes, the trash bin, and settings (excluded sites among them) sync, so what you delete on one device can be restored on another. A server older than the trash (its `features` list has no `trash`) leaves each device's trash where it is until the server is updated, one without `notes` leaves bookmark notes on the device that wrote them, and one without `sources` leaves the extension's **Settings › Sources** choices in each browser. An item over about 200 KB, such as a session with hundreds of links, stays on the device that deleted it. Recovery snapshots, automatic backups, and browser bookmark monitoring do not sync. **Sync settings** in **Settings › Sync** is on by default; turn it off in a browser to keep its settings separate, and turning it back on sends that browser's settings. When two browsers change the same item at the same time, the later change wins.

### Private windows

How private windows sync depends on their storage, chosen in **Settings › Private windows**:

* **Same library as regular windows.** Private windows change the regular library, so their changes sync with it right away.
* **Separate saved library.** It does not sync until you turn on **Sync private windows** in **Settings › Sync**, opened from a private window. When you connect sync in a regular window, TabLodge offers to open that private window for you. It then goes to the same server as a second library, under `/private`, and needs no setup there. Turn it on in each browser whose private windows should share it.
* **Separate temporary library.** It never syncs, because it is meant to disappear when the browser closes.

The separate library always has a password, so TabLodge asks for it when you turn private sync on and encrypts every item before it leaves the browser. The first browser makes a random key and stores it on the server wrapped with that password, so the server only ever holds the wrapped key and encrypted items. Update every browser and phone first if you choose a password of 4 to 7 characters: an older build cannot join with one. Each other browser joins from the set-a-password screen its private windows show first: it offers the server's password, which becomes that browser's lock, and the server's data merges into what the browser holds. A browser can also keep its private library on the device with a password of its own, and when it turns **Sync private windows** on later it asks for the server's password once, which replaces its own, and the two libraries merge. On a server with no private library yet, the set-a-password screen has a **Sync private windows** switch, on by default; switched off, the library stays on the device and does not match your other devices until you turn it on in **Settings › Sync**. A browser whose password differs from the server's is refused, so there is never a second one. Turn private sync off before removing the lock. Removing the regular sync server, or changing its address or token, turns private sync off too and deletes its key from the browser, so turn it on again and enter the password once.

Changing the password wraps the same key again on the server first, and the change is refused, with the old password kept, when the server cannot take it. The other browsers keep syncing, and a browser that turns private sync on later uses the new one. Erasing the private library on a browser does not touch the server's copy.

The server can still see how many private items there are and when they change. Whoever holds the server's data can try every short or number-only password, so use a long one if that matters to you. A 4-digit PIN made with an older version still opens what it protects and still joins the server's key; it is just a short password.

Private sync runs only while a private window is open and its library is unlocked, so changes from other browsers arrive the next time you open one. [ADR 2](adr/0002-private-window-sync.md) explains the design.

## Look after the server

### Check on it

* `curl https://<your address>/health` answers `{"ok":true}`.
* **Settings › Sync** shows the last sync time and any error.
* On Docker, `docker compose -f compose.https.yaml ps` shows `healthy`, and `docker compose -f compose.https.yaml logs sync` shows the server's messages. The logs are capped at 2 MB.

### Update

TabLodge updates itself from the browser store, but your server updates only when you update it, or once a day if you [turn that on](#update-automatically). An older server keeps working with a newer TabLodge. **Settings › Sync**, in the extension and in the Android app, shows the server's version and lists what does not work until you update it. While something does not work, a banner at the top of the extension's dashboard and the app's Bookmarks and Sessions says so. When sync has stopped, the banner stays until the server or the app is updated. When only features are missing, **Dismiss** hides it on that device until the server reports another version or lacks a different set of features. Each TabLodge release also publishes the server with the same version number, so to hear about new versions, watch the repository's releases on GitHub (**Watch › Custom › Releases**).

Each optional part of TabLodge needs a server from the release that added it:

| Feature | Server release | Without it |
| --- | --- | --- |
| Private windows' library (`private`) | 0.2.0 | The private library does not sync |
| Site icons and link previews (`preview`) | 0.2.2 | Icons through the server show as letter tiles, and links get no previews |
| Trash (`trash`) | 0.2.2 | Each device keeps its own trash |
| Bookmark notes (`notes`) | 0.4.0 | Notes stay on the device where they were written |
| Sources settings (`sources`) | 0.4.0 | The sites in **Settings › Sources**, their columns, and save modes stay in each browser |
| Shared pages (`shared-pages`) | 0.4.0 | **Upload to my server** cannot share pages |
| Page copies through the server (`page-source`) | 0.4.0 | The Android app fetches pages for **Keep a copy** itself, so the site sees the phone |

Sync stops only when the server and the app speak different versions of the sync protocol, which is rare. **Settings › Sync** then says which one to update: "Your sync server is older than this app. Update the server to 0.2.0 or later." or "This app is older than your sync server. Update TabLodge." Everything on the device stays as it is, and sync starts again by itself after the update.

The version reads "an unreleased build" for a server built from `master`: the **Deploy to Cloudflare** button, `cf:deploy`, the `edge` image, and your own builds. Only the release images (`latest` and the version tags) and, from 0.4.0 on, a Cloudflare server updated by the [Update TabLodge workflow](#update-automatically) carry their version. A server from before 0.4.0 reports none.

Updating keeps the library and the token. Connected browsers lose their live connection for a moment and reconnect by themselves.

**Cloudflare, deployed with the button.** Open the repository Cloudflare created for you on GitHub or GitLab and replace `worker.js` with the newest [`apps/server/cloudflare-deploy/worker.js`](https://github.com/bberka/TabLodge/blob/master/apps/server/cloudflare-deploy/worker.js) from TabLodge: open the file, choose **Edit**, paste, and commit. Cloudflare deploys the commit by itself.

**Cloudflare, deployed from your computer.** In your copy of the repository:

```sh
git pull
pnpm install
pnpm run cf:deploy
```

`cf:deploy` uploads the new Worker and leaves the token alone (`cf:setup` does the same and also creates a token if the Worker has none). The library stays in the Durable Object's storage, and the new code runs from the next request. The private windows' library, if you use it, is a second object of the same kind and needs nothing extra. If you deployed from a fork on GitHub, choose **Sync fork** there before `git pull`.

**VPS:**

```sh
docker compose -f compose.https.yaml pull
docker compose -f compose.https.yaml up -d
```

**Single container:** run `docker pull ghcr.io/bberka/tablodge-sync:latest`, then `docker rm -f tablodge-sync`, then start it again with the same command and token. The library is in the `tablodge-sync` volume and stays.

`latest` is the server from the newest TabLodge release, and each release is also tagged with its version, such as `0.1.9`. `edge` is built from `master` whenever the server code changes there, and can change at any time.

To check the update, open **Settings › Sync**, or ask for the status. `version` is the server's release, and the `features` list shows what it supports:

```sh
curl -H "Authorization: Bearer <token>" https://sync.example.com/v1/status
```

Do not remove the `migrations` entry in `wrangler.jsonc` (in `apps/server/`, or in the repository the button created) or add a `deleted_classes` migration for `SyncLibrary`: Cloudflare would delete the stored library with it.

### Update automatically

A VPS, a single container, and a Cloudflare server deployed with the button can each take every new release by themselves, once a day. It is off until you set it up. Updates come from GitHub and its image registry, where the server came from, and Watchtower's own image from Docker Hub; nothing else is contacted. An update restarts the server, so connected devices reconnect, and it brings a release you may not have read about yet. A release that changes the sync protocol, which is rare, stops devices on an older TabLodge from syncing until they update; the Cloudflare workflow stops before such a release and says so. A server deployed from your computer with `cf:setup` is updated by hand.

**VPS.** Download the newest `compose.https.yaml` (the `curl` line in [step 2](#2-start-it)), then:

```sh
echo COMPOSE_PROFILES=autoupdate >> .env
docker compose -f compose.https.yaml up -d
```

Use the line in `.env`, not `--profile autoupdate`: the sync container gets the label the service looks for only from `COMPOSE_PROFILES`.

This starts `autoupdate`, a [Watchtower](https://github.com/nicholas-fedor/watchtower) container that looks for a new image at 04:00 UTC every day. When there is one, it restarts only the sync container with it and deletes the old image; Caddy and every other container are left alone. If you already run a Watchtower of your own, it leaves the sync container to this one while the profile is on. To turn it off, delete the line from `.env`, run `docker compose -f compose.https.yaml rm -sf autoupdate`, then `docker compose -f compose.https.yaml up -d`, which starts the sync container again without the label. To stay on one release, set `TABLODGE_IMAGE` to its version tag, such as `ghcr.io/bberka/tablodge-sync:0.4.0`; Watchtower then has nothing to update.

Watchtower controls Docker through its socket, which gives it the same power over the machine as root. It is a community project kept up by one person. The original `containrrr/watchtower` is no longer maintained and does not start on Docker 29. If you would rather not run it, a daily cron job does the same with Docker alone (`crontab -e`, with your folder):

```sh
0 4 * * * cd /home/me/tablodge-sync && docker compose -f compose.https.yaml pull sync && docker compose -f compose.https.yaml up -d sync
```

**Single container.** A Watchtower you already run for every container updates `tablodge-sync` too, and you need nothing more. Otherwise, start the container again as in [Update](#update), with `-l com.centurylinklabs.watchtower.scope=tablodge` added before the image name, then start a Watchtower limited to that label:

```sh
docker run -d --name tablodge-sync-autoupdate --restart unless-stopped -l com.centurylinklabs.watchtower.scope=tablodge \
	-v /var/run/docker.sock:/var/run/docker.sock nickfedor/watchtower:1.24.1 --scope tablodge --cleanup --schedule "0 0 4 * * *"
```

Without the scope, this Watchtower would remove any other Watchtower on the machine when it starts. Each update keeps the container's name, port, volume, and token. `docker rm -f tablodge-sync-autoupdate` turns it off.

**Cloudflare, deployed with the button.** Add the **Update TabLodge** workflow to the repository Cloudflare created: on GitHub, choose **Add file › Create new file**, name it `.github/workflows/update-tablodge.yml`, paste the content of [`apps/server/update-tablodge.yml`](https://github.com/bberka/TabLodge/blob/master/apps/server/update-tablodge.yml), and commit. Every day it downloads `worker.js` from the newest TabLodge release and commits it when it changed, and Cloudflare deploys that commit. **Actions › Update TabLodge › Run workflow** updates at once. A GitLab repository has no GitHub Actions, so update it by hand.

* The button deploys `master`, which is often ahead of the newest release, so the workflow replaces `worker.js` only with a release published after it last changed. The first update comes with the next release.
* It changes only `worker.js`. When a release needs a different `wrangler.jsonc` (outside `vars`, which stay yours), the run fails and its message links the file to copy by hand.
* For a release with a new sync protocol, the run fails. Update TabLodge on every device, then run the workflow by hand with **Also take a release with a new sync protocol** ticked.
* The repository variable `TABLODGE_VERSION` (**Settings › Secrets and variables › Actions › Variables**), such as `0.4`, keeps it on that release line.
* GitHub emails you when a run fails. In a public repository, GitHub turns scheduled workflows off after 60 days without a commit; **Enable workflow** on the Actions tab turns it on again.

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

For any server, Cloudflare included, a copy of the repository and Node.js 24 do the same over the network. `--token <token>` can replace the variable:

```sh
export TABLODGE_SYNC_TOKEN='<token>'
node apps/server/scripts/transfer.ts export --url https://sync.example.com > tablodge-sync-backup.jsonl
node apps/server/scripts/transfer.ts import --url https://sync.example.com < tablodge-sync-backup.jsonl
```

The private windows' library is a second library on the same server: back it up with the same commands and `--url https://sync.example.com/private` (in the Docker image, `node node.js export --url http://127.0.0.1:8787/private`). If it is encrypted, the file holds the encrypted items and the wrapped key, so it can be restored but not read without the password.

Importing keeps the newer version of anything the server already has, so it never overwrites newer work. After a server is restored from an older backup, connected browsers notice by themselves and send it everything it lost. Nothing needs to be done in TabLodge.

Each browser's own full backup (**Settings › Data › Back up**) also stays a complete copy of the library.

### Shared pages

**Share › HTML page** in the extension and **Share › HTML page** in the Android app offer **Upload to my server** when the server is connected and new enough. The page is the same one the Share dialog would save as a file. The server keeps it as it came and serves it to anyone with its link, `https://<address>/p/<id>`, without the token. The id is 22 random characters, so a link cannot be guessed, but anyone who has it can open the page and pass it on. Each upload makes a new link; to change a page, share it again and delete the old one.

**Settings › Sync › Shared pages** in either app lists every page on the server with its link, and **Delete** removes it, after which its link answers 404. Pages belong to the regular library only: the private windows' library and the Android app's private library are never uploaded, and nothing is served under `/private/p/`.

The server sends each page with headers that allow no scripts, forms, or frames (`Content-Security-Policy` with `sandbox`), with `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` so sites opened from the page do not learn its address, `X-Robots-Tag: noindex`, and `Cache-Control: no-store`. Page views have their own allowance of 120 a minute, apart from the library's, so visitors cannot slow down sync. Over it, a visitor gets 429.

On Cloudflare's Workers Free plan, every view, a 429 included, counts against the account's daily request limit, which sync uses too. A link shared widely can use it up and stop sync until midnight UTC. A Docker server has no such limit. Shared pages are not part of the [backup](#back-up-and-restore), so moving to another server leaves them behind.

### Change the token

Do this if the token may have leaked.

* VPS: put a new token in `.env` (`openssl rand -base64 32`), then run `docker compose -f compose.https.yaml up -d`. The library is kept.
* Single container: remove it and start it again with a new `TABLODGE_SYNC_TOKEN`.
* Cloudflare: run `pnpm run cf:setup --rotate-token` and save the new token it prints. With the button, open the Worker in the Cloudflare dashboard, then **Settings › Variables and Secrets**, and replace the value of `TABLODGE_SYNC_TOKEN`.

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
| "Your sync server is older than this app. Update the server to 0.x or later." | The server speaks an older sync protocol | [Update](#update) the server. Sync starts again by itself |
| "This app is older than your sync server. Update TabLodge." | The server speaks a newer sync protocol | Update the extension or the Android app |
| **Settings › Sync** lists features under "Until the server is updated" | The server is from before those features | [Update](#update) the server. Sync goes on meanwhile |
| "The sync server refused the token." | The token in TabLodge differs from the server's | Copy it again; `grep TOKEN .env` on a VPS. After changing it, Disconnect and Connect again |
| "The sync server cannot be reached." | Wrong address, server down, or no network | Open `https://<address>/health` in the browser. On a VPS, check `docker compose -f compose.https.yaml ps` |
| `/health` does not answer over HTTPS on a new VPS | Caddy could not get a certificate | Check the DNS record points at the server and ports 80 and 443 are open, then read `docker compose -f compose.https.yaml logs caddy` |
| "The server address must start with https://" | Plain HTTP to another computer | Use Option A or B, or `localhost` for a server on this computer |
| Changes arrive only every few minutes | The live WebSocket does not get through | Make sure the reverse proxy passes WebSocket upgrades on `/v1/live`. In Firefox with a plain HTTP `localhost` server this is expected |
| "The sync server asked TabLodge to slow down." | More requests than `RATE_LIMIT_PER_MINUTE` | Sync tries again by itself. Raise the limit if it keeps happening |
| "The sync server is full." | More items than `MAX_RECORDS` | Delete sessions or bookmarks you no longer need, or raise the limit |
| "The server turned down N old changes from this browser" | The browser was offline for longer than `RETENTION_DAYS` and edited items deleted elsewhere meanwhile, or its clock was more than a day ahead | The edited items stay in that browser but are not sent to the server. Recreate them if other browsers should have them |
| "The sync server has no token set up yet." | On Cloudflare, `TABLODGE_SYNC_TOKEN` is missing or shorter than 32 characters | Set it under **Settings › Variables and Secrets** for the Worker, or run `pnpm run cf:setup --rotate-token` |
| The sync container keeps restarting | `TABLODGE_SYNC_TOKEN` is missing or shorter than 32 characters; the logs say so | Put a token of at least 32 characters in `.env` and start it again |
| "A session, tab, or bookmark is too large for the sync server." | One item is over 256 KB | Shorten that item's notes or description |
| The token was printed by `cf:setup` and lost | Cloudflare keeps secrets unreadable | Run `cf:setup --rotate-token` and reconnect the browsers |

## Reference

### Commands

Run these from the root of your copy of the repository. Anything after the command name is passed on, as in `pnpm run cf:setup --rotate-token`.

| Command | What it does |
| --- | --- |
| `pnpm run cf:setup` | Deploys to Cloudflare, creating and printing a token on the first run. `--rotate-token` replaces the token |
| `pnpm run cf:deploy` | Deploys an update without touching the token |
| `pnpm run cf:dev` | Runs the Worker on this computer, with the token from `apps/server/.dev.vars` |
| `pnpm run cf:delete` | Deletes the Worker and its library from Cloudflare |
| `pnpm run server:build` | Builds the Node server into `apps/server/dist/node.js` |
| `pnpm run server:start` | Starts that build, with the token from `TABLODGE_SYNC_TOKEN` |
| `pnpm run cf:bundle` | Rebuilds `apps/server/cloudflare-deploy/worker.js`, the Worker the button deploys, from `apps/server/src`. `--check` only reports whether the committed file is out of date |
| `node apps/server/scripts/transfer.ts export\|import` | Backs up or restores a library, with `--url` and optionally `--token`. See [Back up and restore](#back-up-and-restore) |

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `TABLODGE_SYNC_TOKEN` | none, required | The token browsers send, at least 32 characters |
| `TABLODGE_DOMAIN` | none | Your domain, for `compose.https.yaml` |
| `TABLODGE_IMAGE` | `ghcr.io/bberka/tablodge-sync:latest` | The image `compose.https.yaml` runs, for example to pin a version |
| `TABLODGE_HTTP_PORT`, `TABLODGE_HTTPS_PORT` | `80`, `443` | Host ports Caddy listens on in `compose.https.yaml` |
| `COMPOSE_PROFILES` | none | `autoupdate` starts the [daily update](#update-automatically) in `compose.https.yaml` |
| `PORT` | `8787` | Port the sync server listens on |
| `DATA_DIR` | `/data` in the image, `./data` otherwise | Folder for `library.db` and `private.db` |
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
| Live connections | 64 for both libraries together on Docker, 64 per library on Cloudflare. One that sends no valid token in 10 seconds is closed |
| One shared page | 1 MB |
| Shared pages | 50, and 20 MB together |
| Shared page views | 120 a minute, apart from `RATE_LIMIT_PER_MINUTE` |

### API

All paths except `/health` and `/p/<id>` need `Authorization: Bearer <token>`. The server answers with CORS headers, so the extension needs no browser permission for its address.

| Request | Answer |
| --- | --- |
| `GET /health` | `{"ok":true}` |
| `GET /v1/status` | Protocol version, the server's release `version` (`0.0.0` for a build that is not a release), current cursor, record count, limits, and `features`, the optional parts this server has (`private`, `key`, `preview`, `trash`, `notes`, `sources`, `shared-pages`, and `page-source`) |
| `GET /v1/changes?cursor=<n>&purged=<n>&limit=<n>` | The changes after `cursor` (500 unless `limit` says otherwise, at most 1000), the new cursor, whether more are waiting, and `purged`, the server's purge marker, which the browser sends back with its next pull. Or `{"resync":true}` when deletes the browser has not seen were purged, so it must start again from cursor 0 |
| `POST /v1/changes` with `{"changes":[...]}` | One result per change (`applied`, `superseded`, `stale`, or `clock`) and the new cursor |
| `GET /v1/key` | `{"key": ...}`, the library's wrapped encryption key, or `null` when it is not encrypted |
| `POST /v1/key` with `{"key": "...", "previous": ...}` | Stores the key only while the server still holds `previous` (`null` for none); otherwise 409 with the current key |
| `GET /v1/icon?host=<host>` | The site's icon as an image: the one its home page links, or `/favicon.ico`. 404 when there is none. Used by the **Site icons** setting of the Android app and the extension |
| `GET /v1/preview?url=<address>` | `{"title", "description", "image"}` read from the page, where `image` is the share image as a `data:` URL (at most 512 KB). 404 when the page cannot be read. Used by the extension's **Preview links on hover** setting and the Android app's **Preview links when saving** |
| `POST /v1/pages` with `{"title": "...", "html": "..."}` | 201 with `{"id", "title", "size", "createdAt", "path"}`, where `path` is `/p/<id>`. 413 for a page over 1 MB, 507 when the server holds 50 pages or the page would take them over 20 MB |
| `GET /v1/pages` | `{"pages": [...]}`, every shared page without its content, newest first |
| `POST /v1/pages/<id>/delete` | `{"deleted":true}`, or 404 when there is no such page |
| `GET /p/<id>` | The shared page, to anyone, with the headers in [Shared pages](#shared-pages). 404 for an id that is unknown, deleted, or malformed |
| `GET /v1/page-source?url=<address>` | `{"url", "html"}`: the whole page (at most 3 MB) and the address it ended at after redirects. 404 when it is not an HTML page, is too large, or cannot be read. Not cached and not stored. Used by the Android app's **Keep a copy**, which extracts the readable text on the phone |
| `GET /v1/live` (WebSocket) | Send `{"type":"auth","token":"..."}` first. The server answers `{"type":"ready","cursor":n}`, then `{"type":"cursor","cursor":n}` after every push that changed something. `ping` gets `pong` |

Every path except the shared page ones is also served under `/private`, for the private windows' library, which is kept apart: a second Durable Object on Cloudflare, and `private.db` next to `library.db` on Docker, created the first time a browser uses it.

The server fetches the page or icon itself, from its own network address, so the site sees the server and not your device. It refuses anything but public web addresses: other schemes, `localhost`, names ending in `.local` or `.internal`, hosts with no dot, credentials in the address, and any address that resolves to a private, loopback, link local, or shared range, checked again on every redirect (three at most). Previews read a page up to its `</head>` (256 KB at most), `/v1/page-source` reads the whole page (3 MB at most), and each request waits at most six seconds. Icon and preview answers are kept in memory for a day; a page for a copy is passed on and kept nowhere. These three paths have their own allowance of 600 requests a minute, so a screen of links does not use up the library's. A site whose name resolves to a public address at the check and a private one at the fetch (DNS rebinding) is not caught on Docker; only the token holder can ask, so keep the token private.

A full library answers a push with 507 unless every change in it is a delete. Too many requests get 429 with a `Retry-After` header.
