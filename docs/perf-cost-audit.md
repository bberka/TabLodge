# Performance and cost audit

Branch `chore/performance-cost-audit`, audited 2026-11-15. No code was changed. No Cloudflare account, traffic data, or Lighthouse run was available, so every cost number below is a model, not a bill.

## 1. Executive summary

TabLodge has little to cut. The extension already lazy loads its dialogs, renders long lists in batches with `content-visibility`, defers search, opens its state read before React loads, and syncs over a hibernating WebSocket. The Cloudflare Worker already answers `OPTIONS`, `/health`, and bad tokens without waking the Durable Object. The site is static on GitHub Pages with system fonts, no third party scripts, and responsive WebP.

Cloudflare is not a cost center for the project. It runs only the optional self hosted sync Worker (`apps/server/wrangler.jsonc`), deployed by each user to their own account. The site is not on Cloudflare (`.github/workflows/pages.yml`). "Monthly savings" therefore means savings per self hoster, and for one person's devices that is cents or zero.

Top 5 wins, in order:

1. **Minify the service worker (F1).** 414,534 B to 201,937 B (-51%) for the script the browser parses on every worker start. Effort: one line. Needs a store review check.
2. **Cut the 5 minute alarm to a real catch up only when the socket is down (F2).** Removes about 288 Worker plus Durable Object wakes per device per day. Needs care: it is the safety net for missed live messages.
3. **Measure and, if needed, reduce rows written per push (F3).** Each upsert touches the table plus two indexes, and the Workers Free plan caps rows written at 100,000 per day. A first upload of a large library could hit that cap. Unmeasured, so verify before acting.
4. **Trim eager JS on the new tab page (F4).** `newtab.html` loads 45 files, 781,011 B of JS before first render. A 470 KB shared chunk (`common`) is the bulk. Needs a bundle analyzer run to split by cause.
5. **Serve `/v1/icon` from the Cache API before the Durable Object (F5).** Icon requests wake the object and fetch third party sites. Small gain, real security care needed.

Estimated UI gain: service worker parse and start about 200 KB less script; new tab JS potentially 100 to 250 KB less if F4 pans out. These are file sizes, not measured CWV. All extension pages load from disk, so LCP and CLS depend on parse and execution, not the network. No Lighthouse baseline was taken (see section 6).

Estimated cost saving: for a three device self hoster, under 1% of the Free plan limits is used today (F2 math below). Realistic saving is $0 per month. F3 is the only item that could matter, and only on the Free plan for large libraries.

## 2. Architecture snapshot

pnpm workspace (`pnpm-workspace.yaml`), tasks through Vite+ (`vp run`). 509 tracked files.

| Package | Purpose | Stack |
| --- | --- | --- |
| `apps/extension` | Chrome, Brave, Firefox MV3 extension | React 19, Radix, Tailwind 4, lucide-react, fflate. Multi page Vite build (`vite.pages.config.ts`) plus four script builds (`scripts/build.ts:36`). Pages: newtab, popup, options, help, sidepanel, name-session, add-bookmark, palette. Targets `chrome116` and `firefox140` (`scripts/vite-shared.ts:89`) |
| `apps/server` | Self hosted sync server | Hono. Node plus `node:sqlite` in Docker, or a Worker plus one SQLite Durable Object (`SyncLibrary`). Same API in `src/api.ts` |
| `apps/mobile` | Android app | Expo, React Native. Shares extension `src/shared` |
| `apps/site` | tablodge.bbay.dev | Astro 7, static output, GitHub Pages |

Cloudflare surface: one Worker (`apps/server/src/worker.ts`) and one Durable Object class with two instances (`default` and `private`). No KV, D1, R2, Queues, AI, Hyperdrive, or Cache API. One alarm (the 10 s auth timeout for unauthenticated sockets). Observability on (`wrangler.jsonc:7`). Vars: `MAX_RECORDS` 500000, `RETENTION_DAYS` 90, `RATE_LIMIT_PER_MINUTE` 300. A second copy of the config for the Deploy button is kept in step by a test.

Client to API: a hand written sync client (`apps/extension/src/shared/sync/client.ts`) over `fetch` and a WebSocket. A 20 s `ping` keepalive (`client.ts:65`), a pull of up to 500 changes per page, and a 5 minute fallback alarm (`client.ts:47`).

Pricing used (Cloudflare docs, fetched today): Durable Objects paid plan includes 1M requests and 400,000 GB-s per month, then $0.15 per million requests and $12.50 per million GB-s. SQLite rows read 25B included then $0.001 per million; rows written 50M included then $1.00 per million. Free plan, per day: 100,000 requests, 13,000 GB-s, 5M rows read, 100,000 rows written. Source: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## 3. Findings

Impact and effort: H, M, L. "Measured" means I ran it; "read" means from code only.

| ID | Area | Location | Problem | Evidence | Recommended fix | Impact | Effort | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | UI | `apps/extension/scripts/vite-shared.ts:229` | The service worker is built with `minify: false`. | Measured: `dist/tablodge/service-worker.js` is 414,534 B; esbuild `--minify` gives 201,937 B. Source is 10,731 lines (`shell/service-worker.ts`). The worker is parsed on every cold start of an MV3 worker. | Set `minify: true` (or `'esbuild'`) for `service-worker.js`. | M | S | Low to medium. Check Chrome Web Store and AMO reviewer rules: Firefox accepts minified code with source upload. Stack traces get harder to read, so keep an unminified debug build for `dev:*`. |
| F2 | CF | `apps/extension/src/shared/sync/client.ts:1026-1032`, `shell/service-worker.ts:1530`, `:8428` | The fallback alarm calls `wake()`, which always runs `openLive()` then `syncNow()`, even when the live socket is already open and authenticated. | Read: `wake()` has no "socket is live" shortcut. Model: 288 alarms per day per device = about 8,600 per month per device. Each is a Worker request plus a Durable Object wake (billed request, a few ms of duration, row reads). Three devices: about 26,000 per month, which is under 1% of the Free plan's 100,000 per day. | When the socket is open and the last `ready` or `cursor` message is recent, skip the HTTP pull and only verify the socket. Keep the pull when the socket is down. | L for cost, M for battery and wake count | S | Medium. The alarm is the safety net for a dropped or silently dead socket. Skipping it must still pull after the socket closes and after a long gap. Needs a test for a missed `cursor` message. |
| F3 | CF | `apps/server/src/sql-change-log.ts:40-48, 123-142` | Each upserted record writes the table row plus the `key` primary key index and the unique `seq` index, and a delete adds the partial tombstone index. Rows written also count `meta` updates for `seq` and `count`. | Read: schema has `key TEXT PRIMARY KEY`, `seq INTEGER NOT NULL UNIQUE`, and `records_tombstones`. Cloudflare bills SQLite rows written including index rows ([D1 rules apply](https://developers.cloudflare.com/durable-objects/platform/pricing/)). If an upsert costs 3 rows, a 500 change push is about 1,500 rows written, and 33,000 records would pass the Free plan's 100,000 per day. Not measured. | First measure: `storage.sql.exec(...)` returns a cursor with `rowsWritten` and `rowsRead`. Log them in `cf:dev` for a 500 change push. If high: use `WITHOUT ROWID` with `key` as the key (needs a migration, see risk), and stop storing `h`, `d`, `deleted` twice (they also sit inside `change`). | M on Free plan with big libraries, L otherwise | M | High for the schema change: `docs/agents/server.md` warns never to drop the stored library, so any change needs an in place migration and a rollback plan. Measure first. |
| F4 | UI | `apps/extension/dist/tablodge/newtab.html` (45 `modulepreload` and script files), `assets/common-*.js` | The new tab page loads a lot of JS before it can render. | Measured: newtab 45 files, 781,011 B; popup 23 files, 512,001 B; sidepanel 26 files, 514,526 B; options 28 files, 691,553 B. Largest chunks: `common` 470.47 kB (gzip 144), `newtab` 127.79 kB, `column-select` 98.81 kB. Dialogs are already lazy (`src/app/lazy-dialogs.tsx:43-73`). `finder`, `private-storage`, and `lazy-dialogs` still appear in the newtab preload list. | Run a bundle visualizer to see what is in `common`. Likely react-dom, Radix, lucide icons. Then check why `finder-*.js` (20.97 kB) and `private-storage-*.js` (15.73 kB) are statically reachable from newtab, and make them load on use. | M | M | Low. Risk is regressions in first paint ordering that `newtab-preload.ts` depends on. |
| F5 | CF | `apps/server/src/api.ts:198-246`, `apps/server/src/worker.ts:199` | `/v1/icon` and `/v1/preview` always go through the Durable Object. Their cache is an in memory `Map` (`api.ts:169`) that is lost when the object is evicted. Replies are `Cache-Control: private`, so the edge never caches them. | Read. A screen of links asks for a dozen icons at once (comment at `api.ts:166`). Each wakes the object, and a cache miss makes outbound `fetch` calls that bill duration. | After the Worker's token check, look up `caches.default` keyed by the host, and store icon bytes there. Keep preview in the object. | L | S | Medium. The cache must sit after the token check, key only on a validated host, and not store error pages. Icons are public data, so the leak risk is low. |
| F6 | CF | `apps/server/src/sql-change-log.ts:121-126` | A push issues one `SELECT` per change inside the transaction. | Read: `changes.map(... this.sql.all('SELECT h, d FROM records WHERE key = ?'))`. A 500 change push runs 500 point reads. | Read the current stamps with chunked `WHERE key IN (...)` queries. | L | S | Low. At $0.001 per million rows read this saves almost nothing in money, but it removes 499 statements of CPU per push. |
| F7 | CF | `apps/server/wrangler.jsonc:7` | `"observability": {"enabled": true}` with no sampling. | Read. The Worker has no `console.log` on hot paths (grep), so volume is only the automatic request logs. | Add `head_sampling_rate` if a user sees logs volume cost. | L | S | Low. Hides some errors from the logs. |
| F8 | Monorepo | `.github/workflows/test.yml:24-31` | CI caches the pnpm store only, no build or test cache. | Read. `check` runs `xo`, `tsc -b`, and `vp test run` each time. | Measure CI time first. Cache `tsc -b` incremental output if it is the long step. | L | S | Low. |
| F9 | Monorepo | repo root | No unused code or dependency check (knip, depcheck). | No config in the repo. | Run `npx knip` once and review. Do not add it to CI before reading the first report. | L | S | Low. |
| F10 | UI | `apps/extension/src/shared/accents.ts:127` | A `setInterval(refresh, WATCH_INTERVAL_MS)` runs while an extension page is open, besides the focus, visibility, and media query listeners it already has. | Read. | Check `WATCH_INTERVAL_MS`. If the listeners cover all cases, drop the interval. | L | S | Low to medium. It may exist for forced color changes that fire no event. |

## 4. Prioritized roadmap

**Quick wins (under 1 day)**

- F1: minify the service worker, run `vp run check:build`, `check:startup`, and `check:firefox`, and confirm the stores accept it.
- F6: batch the stamp reads in `push`.
- F3 step 1: log `rowsWritten` and `rowsRead` for a 500 change push. This only measures.
- F9: run knip once.
- F10: read the interval and decide.

**Medium (1 to 5 days)**

- F2: skip the pull while the live socket is healthy, with tests for a dead socket and a missed cursor.
- F4: bundle visualizer, then split what the analysis shows.
- F5: Cache API for icons behind the token check.

**Strategic**

- F3 step 2: only if the measurement shows high rows written. A schema migration for `records`, tested against a copy of a large library, with the `docs/agents/server.md` rule that the stored library is never deleted.

Not recommended: Smart Placement (the object is placed near its first caller and there is no separate data store), Hyperdrive, KV, R2, Queues, or Workers AI (none are used), and any framework migration. The numbers do not justify them.

## 5. Measurement plan

| Fix | Metric | How |
| --- | --- | --- |
| F1 | Service worker bytes, worker cold start time | `ls -l dist/tablodge/service-worker.js` before and after (414,534 B baseline). Time worker start in `chrome://serviceworker-internals` or a Playwright trace via `check:startup`. |
| F2 | Requests per device per day | Workers dashboard requests for `/v1/changes` and `/v1/status`, or `wrangler tail`, with one device idle for an hour (baseline 12 pulls per hour). |
| F3 | `rowsWritten` per push | Log the cursor values in a test for 1, 100, and 500 changes. Compare after any schema change. |
| F4 | JS bytes and files per page, first paint | Same `grep` count as above (newtab 781,011 B, 45 files). Lighthouse or a Chrome performance trace on `chrome-extension://.../newtab.html` with a seeded library (`scripts/build.ts --seed-data`). |
| F5 | Object requests per icon screen | Worker analytics before and after, plus a test that a wrong token never reads the cache. |
| F6 | CPU ms per push | `wrangler dev` timing for a 500 change push. |
| F7 | Log events per day | Workers observability dashboard. |
| F8 | CI minutes | GitHub Actions run history. |

## 6. Open questions

- **Real usage.** No Cloudflare dashboard access, so no request, CPU, or error numbers per route. Every cost figure above is modeled.
- **Lighthouse and Core Web Vitals.** Not run. The extension pages are local files and need a loaded extension. I did not drive a browser.
- **Bundle composition.** I counted bytes per chunk but did not run a visualizer, so what fills `common` (470 KB) is inferred. The root cause of `finder` and `private-storage` loading on the new tab is not confirmed.
- **Store rules for a minified worker.** Chrome Web Store and AMO policy should be checked before F1 ships.
- **Rows written per upsert.** F3 depends on how Cloudflare counts index writes for SQLite Durable Objects. The docs say it matches D1, but I did not measure it.
- **Mobile app.** Not audited (Hermes bundle size and list virtualization were out of reach without a device build).
- **Site.** Static, system fonts, no third party scripts, 844 KB of WebP across 12 screenshots with `srcset` and lazy loading (`apps/site/src/components/Screenshot.astro`). Build output is 1.5 MB. Nothing actionable found.
- **Duplicate dependency versions.** Not checked with `pnpm dedupe --check`.

## 7. Outcome after approval

Measured on a local `wrangler dev` (workerd) run of `apps/server/src/worker.ts`, with a temporary counter on `rowsRead` and `rowsWritten` that was reverted.

| ID | Result |
| --- | --- |
| F1 | Shipped. `service-worker.js` went from 414,534 B to 197,949 B (-52%), identical for Chromium and Firefox. `check:startup`, `check:dev-browser`, and `vp run check` pass. The pages were already minified, so the stores already review minified code. |
| F3 | Measured, no change. A new record costs 3 rows written (table, `key` index, `seq` index). An update of an existing record costs about 2 rows. A 100 record push wrote about 300 rows plus 2 for `meta`. The Free plan's 100,000 rows per day is therefore about 33,000 new records per day, and a larger first upload only has to continue the next day. A `WITHOUT ROWID` table would save one row in three, but needs a migration of every stored library, so it is not worth the risk. |
| F6 | Not done. A lookup of a missing key reads 0 rows and of an existing key reads 1, so batching the `SELECT`s would save statements, not billed rows. The saving is below what a reviewer could measure. |
| F9 | Inconclusive. `knip` without a per app entry config lists 192 files as unused, because it does not know the extension's HTML, manifest, and script entries. A useful run needs a config written first. |
| F10 | Dropped. The 2 s interval is intentional: the browser fires no event for a system accent change (`accents.ts:97-100`), and it already returns while the page is hidden. |
| F2, F4, F5 | Not done. F2 trades a safety net for about 26,000 requests per month, under 1% of the Free plan. For F4, `finder` (21 kB) and `private-storage` (16 kB) are imported directly by `newtab.tsx:132,193`, which is about 5% of the 781 kB, and the rest is the shared React and Radix chunk. F5 saves little and adds an auth sensitive cache. Each can be reopened with traffic data or a profiler trace showing a real cost. |
