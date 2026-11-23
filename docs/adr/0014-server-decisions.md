# 14. Sync server decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/server` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. The sync protocol itself is [ADR 1](0001-record-level-sync-protocol.md); shared pages are [ADR 12](0012-shared-page-import.md) and [ADR 13](0013-live-shared-pages-and-passwords.md). Environment variables and the transfer commands are in [Self hosting](../self-hosting.md).

## Decisions

### Runtimes

* **One API, two runtimes.** `src/api.ts`, `createApi`, knows nothing of the runtime. `src/node.ts` serves it in Docker and `src/worker.ts`, `SyncLibrary`, serves it inside the library's Durable Object. The live WebSocket is runtime specific, so `createApi` only reports the new cursor after a push changed something (`onApplied`).
* **One SQLite implementation for both.** Node's `node:sqlite` and a Durable Object's storage are both synchronous SQLite, so `src/sql-change-log.ts`, `SqlChangeLog`, and `SqlPageStore` run over the small `Sql` interface. `SqlChangeLog` follows the rules of the in memory `ChangeLog` in `apps/extension/src/shared/sync/change-log.ts`, and `tests/sync-protocol.test.ts` runs the same tests on both.
* **The Docker image is one file.** `vite.config.ts` bundles `src/node.ts` into `dist/node.js`, so the image needs no `node_modules`.
* **The button deploys a prebuilt Worker.** The Deploy to Cloudflare button copies only `cloudflare-deploy/`, so `scripts/cloudflare-deploy.ts` bundles `cloudflare-deploy/worker.js`; `--check` fails when the committed file is stale. `tests/cloudflare-deploy.test.ts` checks that the Worker states its sync protocol on the line the update workflow (`cloudflare-deploy/.github/workflows/update-tablodge.yml`) reads, so a release with another protocol stops the update.
* **The Worker answers what it can without waking the object.** `worker.ts`, the default `fetch`: health checks, a wrong token, and a shared page id that cannot exist are answered in the Worker, so they never bill a Durable Object wake. The private windows' library is the same API under `/private`, in a second object named `private`; the main one is named `default`. The Worker sets `SPACE_HEADER` on each forwarded request so the object knows which library it holds, and only the main library has shared pages. `SyncLibrary` creates the shared page table on first use, so the private object never gets it. `node.ts` likewise opens `private.db` on first use, so a server whose devices never sync private windows has no second file.
* **`node.ts` forwards `/private` as a new `Request`.** Node's server adapter does not let a request be rebuilt from the incoming one, so `app.all(`${PRIVATE_PREFIX}/*`)` builds it from the URL, method, headers, and body.

### Live channel

* **The token travels in the first message.** `src/live.ts`: browsers cannot set headers on a WebSocket, so a device sends `{"type":"auth","token":…}` and gets `{"type":"ready","cursor":n}` or a close with `LIVE_UNAUTHORIZED`. After every push that applied a change the server sends `{"type":"cursor","cursor":n}`. The channel carries no records, so a device pulls through the normal API. `app.use('/v1/*', except(LIVE_PATH, bearerAuth(…)))` in `api.ts` leaves the path open for that reason, and CORS does not apply to WebSockets.
* **Keepalive is `ping` and `pong`.** `SyncLibrary` answers them with `setWebSocketAutoResponse`, so an idle object with open sockets is not billed for duration and is not woken.
* **Idle strangers cannot hold a socket.** `LIVE_AUTH_TIMEOUT_MS` closes a socket with no valid token; in the Worker an alarm does it and fires only while such sockets exist (`SyncLibrary`). `node.ts` keeps one table of unauthenticated sockets and their timers for both libraries. `LIVE_MAX_SOCKETS` refuses more sockets than one person's devices need.
* **The token is compared in constant time.** `sameToken` does not depend on where the strings first differ. It needs bit arithmetic, hence the `eslint-disable no-bitwise` with its reason around it.

### CORS and rate limits

* **Gzip is an option.** `ApiOptions.compress` is on in the Docker server, where pull pages compress to a fraction of their size. Cloudflare compresses at its edge already.
* **CORS is open.** `createApi` sends `Access-Control-Allow-Origin: *`. The extension calls the server from its own origin and CORS lets it do that without a host permission; the token, not the origin, protects the library.
* **Limits are fixed windows per server,** which serves one library. The library window (`rateWindow`, `limits.requestsPerMinute`) counts after the token check, so only the owner's devices can use it up. It stops a runaway client from running up the server's cost.
* **Icons and previews have their own window** (`previewWindow`; `/v1/icon`, `/v1/preview`, `/v1/page-source` skip the library window), because a screen of links asks for a dozen at once and must not use up the library's allowance.
* **A page view is the one route that hands out library data without the token.** Its window (`viewWindow`, and `passwordAttempts` per page id) counts before the lookup, so a crawler gets 429 while the library's devices keep syncing.
* **A full library still takes deletes.** `POST /v1/changes` checks `log.size >= limits.maxRecords` before applying, so one push can go over the limit by its own size at most. Deletes free space once their tombstones are purged.
* **A page upload's body limit is six times the page.** `POST /v1/pages` uses `maxPageBytes * 6 + 4096` because JSON escaping can make the body several times the page's size.
* **`/v1/page-source` is `no-store`.** A copy is kept once, and the page is too large to hold for other requests. Icons and previews are cached for `PREVIEW_TTL_MS`.
* **`/v1/status` reports `SERVER_VERSION`.** A release image stamps it; other builds report `0.0.0`.

### Link previews and icons

* **The server fetches, so no third party learns the links.** `src/preview.ts`: a device that asks for an icon or preview would otherwise hand the page's owner the phone's or browser's address, or hand a third party the list of saved links. The caller holds the token, but the server still refuses to be pointed at its own network.
* **Every hop is checked.** `allowedUrl` accepts a plain web address whose host resolves only to public addresses. `isPrivateAddress` covers loopback, private, link local (cloud metadata), shared address space, and their IPv6 counterparts. `guardedFetch` has a time limit (`FETCH_TIMEOUT_MS`), follows up to `MAX_REDIRECTS`, and applies the same rules to each one. `resolveAddresses` in `node.ts` returns every address a host name points at, so a site that points at the server's own network is refused. The Cloudflare runtime cannot reach private networks at all, so `worker.ts` passes no resolver.
* **Reads are capped.** `readLimited` and `readHtml` read the first part of a page, enough to reach its head, and stop. `fetchPage` returns nothing for a non HTML page or one larger than `MAX_PAGE_BYTES`; the device extracts the text and the server keeps nothing.
* **A preview prefers the page's own card.** `readPageMeta` takes Open Graph or Twitter card first, then the plain title and description and the linked icon, with addresses made absolute against the page. The share image comes back as a `data:` URL only when it is under `MAX_IMAGE_BYTES`. `fetchIcon` takes the icon the home page links, or `/favicon.ico`.
* **`btoa` instead of `Buffer`.** `dataUrl` uses `btoa` because it exists in Node and Workers, and `Buffer` does not in Workers (the directive in `preview.ts` says so).

### Change log

* **Cheap on a small server and billed by rows.** `SqlChangeLog` keeps the cursor, purge marks, and record count in a small `meta` table and in memory, read once at start, so a Durable Object waking from hibernation does not read every row to count them. A push reads only the stamp columns of the records it touches. A purge finds old deletes through a partial index, so it looks only at old tombstones (`SCHEMA`).
* **A stale stamp is refused** (`pushResult` with `purgedH`, [ADR 1](0001-record-level-sync-protocol.md), Tombstones). The test `a browser that updates from 0.3.0 still drops a record deleted elsewhere whose delete was purged meanwhile` in `tests/sync-client.test.ts` moves the clock on one second, because a stamp from the same millisecond as the purged delete would be refused as stale.
* **The object is the only writer.** That holds for one Docker server per data folder and for a Durable Object, and the cached counters depend on it.
* **Stamps compare as strings** where `SqlChangeLog` tracks the newest purged delete (`purge`).
* **In memory state moves after the commit.** `SqlChangeLog` sets `seq` and `count` only once the transaction has committed, so a rolled back push leaves them as they were.
* **A stored change is parsed again** (`readChange`), so a damaged row is skipped instead of sent to devices.
* **SQLite tuning for a small server** (`sqlite` in `src/node-sqlite.ts`): WAL with `synchronous = NORMAL`, which is safe in WAL mode and flushes the disk far less; a capped WAL file and page cache; prepared statements reused; and `auto_vacuum = INCREMENTAL` with a vacuum after purges (`Sql.compact`, which a runtime that frees space by itself leaves out), so space from purged rows goes back to the disk. `auto_vacuum` must be set before the first table is created; on an existing database it has no effect.

### Shared pages

* **Headers decide what a browser may do** (`PAGE_HEADERS` in `src/shared-pages.ts`), so even a hand made upload cannot run script on the server's address. The page is bytes the device sent; the server never parses it or the library's records ([ADR 1](0001-record-level-sync-protocol.md)). `sandbox` gives the page an opaque origin and no scripts; popups are allowed so its links open in a new tab, outside the sandbox (`allow-popups-to-escape-sandbox`). `Referrer-Policy: no-referrer` keeps the page's address from every site a visitor opens from it. `Cache-Control: no-store` makes a deleted page stop showing at once. The password form and hashing are [ADR 13](0013-live-shared-pages-and-passwords.md).
* **One answer for a bad id.** `pageNotFound` answers a malformed, unknown, and deleted id the same way, so none can be told apart.
* **Adding a page is one transaction** (`SqlPageStore.add`): it adds the page unless its id is taken, the server already holds `maxPages`, or the page would take the total over `maxBytes`.

### Transfer

* **Export and import go through the sync API,** so they work the same for Docker and Cloudflare (`src/transfer.ts`, `exportLibrary`, `importLibrary`). The file is JSON lines (`EXPORT_FORMAT`): a header, then one change per line, deletes included, with the stamps the server holds, so importing it anywhere gives the same library. An encrypted library also carries its wrapped key in the header; the values stay encrypted throughout.
* **A different key stops the import.** `storeKey` stores the export's wrapped key unless the server already holds the same one, because another key would leave the imported values unreadable.
* **The server keeps the newer version.** `importLibrary` pushes every change, and the server keeps the newer version of any record it already has.
* **`transfer.ts` imports nothing from the rest of the repository,** so `scripts/transfer.ts` can run it with Node directly from a copy of the repository, against any server. The Docker image runs it as `node node.js export` and `import`.

## Consequences

* A test or guard states a decision where one exists: `tests/sync-protocol.test.ts` (both logs), `tests/shared-pages.test.ts` (routing, limits, headers), `tests/cloudflare-deploy.test.ts` (the protocol line and the bundle). The rest relies on this document and on review.
* The `/private` request rebuild, the single writer assumption, and the one push overshoot of `maxRecords` are limits, not bugs. Changing one means changing its row here.
