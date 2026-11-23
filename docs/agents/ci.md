# CI and releases

Workflows in `.github/workflows/`: `test.yml` (checks on every pull request and push), `pages.yml` (website), `mobile.yml` (debug APK), `sync-server.yml` (server image), `release.yml` (release), `store-publish.yml` (Chrome Web Store and Firefox Add-ons). `agent-context.yml` separate small workflow: runs `node scripts/agent-context.ts --base FETCH_HEAD` on every pull request, fails when agent instructions grew past master's `scripts/agent-context-budget.json` (`agent-context-increase` label allows it). Not in gate job below, so add to branch ruleset's required checks to enforce.

`test.yml` keeps one required gate job named like branch ruleset expects. Keep that name when you rename or split jobs.

`test.yml` runs these jobs in parallel. Gate job `test` needs every one, so add new job to its `needs`. On pull request, first job `changes` lists touched files through GitHub API, turns off jobs they cannot affect. Gate counts skipped job as passed, failed or cancelled one as failed. Pushes to `master` run everything.

| Touched | Jobs that run |
| --- | --- |
| Only `docs/`, `*.md`, `LICENSE`, `apps/site/`, issue templates | none (the website has its own workflow) |
| `apps/mobile/` | `lint`, `typecheck`, `unit`, `mobile` |
| `apps/server/` | `lint`, `typecheck`, `unit`, `cloudflare` |
| `apps/extension/src/shared/` | all of them |
| other `apps/extension/` | `lint`, `typecheck`, `unit`, and the browser jobs (`extension`, `a11y`, `browser`, `private-storage`) |
| anything else, including `package.json`, the lockfile, and this workflow | all of them |

Path `changes` job does not know runs everything, so add rule there when new top level folder should skip jobs. The jobs:

| Job | Runs |
| --- | --- |
| `lint` | `xo` on three groups of files, one job each (extension `src`; mobile; everything else) |
| `comments` | `node scripts/comment-ratchet.ts` on the touched files; runs for every change ([Code comments](comments.md)) |
| `typecheck` | `tsgo -b` (the native TypeScript compiler, about ten times faster than `tsc -b` with the same errors) |
| `unit` | `vp test run` |
| `extension` | `vp run build`, `vp run pack`, `vp run check:firefox` |
| `a11y` | `vp run build`, `vp run check:a11y` in four shards |
| `browser` | `vp run build`, then `check:startup`, `check:dev-browser` |
| `private-storage` | `vp run build`, `vp run check:private-storage` (one long scenario, so not sharded) |
| `cloudflare` | `pnpm run cf:bundle`, then `git diff --exit-code` on `apps/server/cloudflare-deploy` |
| `mobile` | `pnpm run mobile:export`, which first lists licences of every package in bundle, fails on one with no licence |

Jobs run side by side, so slowest sets wait. Split a job before it becomes longest. Every tracked source file must belong to exactly one `lint` group, so add new top level folder to third. `check:a11y` runs every fourth check when `A11Y_SHARD=<index>/4` set, each shard seeds own profile, so a check must not rely on state an earlier check left.

Browser jobs install Playwright Chromium with `vp run browser:install`, cache `~/.cache/ms-playwright`. What CI does not run: Android Gradle build (only **Mobile** does, behind path filter), Docker image build (only **Sync server image**, behind path filter), website build (**Pages** runs on every pull request, because its check is required). Nothing runs app on emulator or checks Store publishing steps.


TabLodge uses [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

Root `VERSION` file holds minor number. Release workflow computes patch from latest `v0.<minor>.*` tag. Example: `VERSION` set to `1`, latest release `0.1.1`, next release `0.1.2`. Set `VERSION` to `2`, next release `0.2.0`. Minor number cannot go below latest released minor.

Run **Actions › Release › Run workflow** on `master` to publish release. Workflow stamps version into `apps/extension/shell/manifest.json` (source holds `0.0.0`, so local build never claims release version), runs checks and build, publishes Chromium and Firefox ZIPs with SHA256 checksums under `v0.x.y` tag. Then sends one `tablodge-release-published` dispatch, which starts website deployment and Store publishing workflow. That workflow runs two independent jobs. Chrome job verifies release ZIP against checksum, uploads to existing listing, submits for publication; Google review may delay when update becomes available. Firefox job verifies Firefox ZIP, packages source at release tag, submits both to listed add-on; job finishes once AMO has queued version, not after review. Unsigned Firefox ZIP also published as release asset. To build and package extension locally, follow [README build steps](../install.md#build-from-source). Same workflow then builds Android app from release tag, signs it, attaches `tablodge.apk` and `tablodge.apk.sha256` to release (see [Android app](#android-app)).

## Android app

App has own workflow, **Mobile**. Pull requests and pushes to `master` touching `apps/mobile/` or code it shares (`apps/extension/src/shared/`, types, private library and link helpers, mobile tests, lockfile) run app's tests, generate Android project, write Open source licences list (`pnpm run mobile:export`, after prebuild so list covers native libraries), bundle its JavaScript, build debug APK with Gradle, keep APK as build artifact named `tablodge-debug-apk` for 14 days. Debug and release APK both carry 64 bit and 32 bit ARM libraries phones use, so they do not run on x86 emulator; use `pnpm run mobile:android` there. To try current checkout on phone without waiting for CI, run `pnpm run mobile:apk` (see [Android app](../android.md)). **Test** workflow still runs lint, typecheck, every test, JavaScript bundle on every change, so mobile change is checked even when path filter skips **Mobile**.

**Release** workflow adds `android` job after release published. It checks out release tag, writes release version and version code into `apps/mobile/app.json` (`scripts/release-version.ts set-android`; code is `minor * 1000 + patch`, so 0.2.5 is 2005, only goes up), writes Open source licences list from bundle and release classpath (`licences --native`, fails when package has no licence), builds release APK for `arm64-v8a` and `armeabi-v7a`, signs with release key, verifies signature, uploads `tablodge.apk` and checksum to release.

Android installs update only when signed with same key as app it replaces, so create release key once and keep it safe: losing it means people must uninstall app and lose local copy before installing new APK.

1. Create key: `keytool -genkeypair -v -keystore tablodge-release.keystore -alias tablodge -keyalg RSA -keysize 4096 -validity 36500`. Use strong password, keep file and password somewhere private and backed up.
2. Add four repository secrets under **Settings › Secrets and variables › Actions**: `ANDROID_KEYSTORE_BASE64` (output of `base64 -w0 tablodge-release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`tablodge`), `ANDROID_KEY_PASSWORD`.

Without secrets `android` job fails, release has no APK; extension zips and image still published. After adding secrets, re-run that job from release run to attach APK. Same re-run retries failed APK build. APK not published to Google Play yet. App's **Check for updates** reads latest release and its `tablodge.apk` asset, so keep that asset name and `v0.x.y` tag format. Play Store build must drop that button, `app-update` module, `REQUEST_INSTALL_PACKAGES` permission in `app.json`, because Play does not allow app to install updates from outside store; it would open store listing instead.

## Sync server image

Sync server image shares extension's version. Pull requests touching `apps/server/` or shared sync code build it, every such push to `master` publishes `ghcr.io/bberka/tablodge-sync:edge`. After release ZIPs, **Release** workflow calls **Sync server image** workflow, which publishes `ghcr.io/bberka/tablodge-sync:<version>`, `:0.<minor>`, `:latest`. New packages start private; make package public once in its settings. Image job stamps release version into `apps/server/package.json` (`node scripts/release-version.ts set-server`), which `/v1/status` reports; `edge` and committed Worker say `0.0.0`, so release check never finds stamped `worker.js` stale. Release also attaches stamped `tablodge-sync-worker.js` for update workflow in `cloudflare-deploy/`. For `PROTOCOL_VERSION`, see [Sync server](server.md#rules).

**Deploy to Cloudflare** button copies only `apps/server/cloudflare-deploy/`, so folder holds prebuilt `worker.js` instead of source. After changing `apps/server/src` or `apps/extension/src/shared/sync`, run `pnpm run cf:bundle` and commit new `worker.js`. Test in `apps/server/tests/cloudflare-deploy.test.ts` fails while out of date. Keep its `wrangler.jsonc` (`name`, `compatibility_date`, Durable Object binding and class, `migrations`, `vars`) same as `apps/server/wrangler.jsonc`, so button deploy and `cf:setup` can take over from each other; same test file checks it.

Button copies `release` branch, which **Release** workflow's last step rebuilds with `scripts/release-branch.sh`: one commit, no shared history, stamped folder at same path (a `GITHUB_TOKEN` push cannot add root `.github/workflows` file), force pushed. One ruleset targets default branch. Button links use `tree/release/apps/server/cloudflare-deploy`.

## Chrome Web Store publishing

Before first release, enable Chrome Web Store API in Google Cloud project, create OAuth credentials authorized with `https://www.googleapis.com/auth/chromewebstore` scope. Generate refresh token for Google account owning existing listing. If OAuth consent screen stays in Testing, Google may expire refresh token after seven days, so configure production consent screen for ongoing automation.

In GitHub repository **Settings › Secrets and variables › Actions**, add `CWS_PUBLISHER_ID` repository variable using publisher ID from Chrome Web Store Developer Dashboard. Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

Workflow already has TabLodge's extension ID. Runs after each GitHub release. Google rejects upload while earlier version in review. Job then ends green with warning, scheduled retry (below) submits release later. To retry by hand, run **Actions › Store publishing › Run workflow**, enter published version, such as `0.1.4`, choose `chrome`.

## Firefox Add-ons publishing

Submit first version of `tablodge@bbay.dev` by hand on addons.mozilla.org, with source ZIP and build notes, fill in listing. After that, create API credentials under **Developer Hub › Manage API Keys**, add these repository secrets in **Settings › Secrets and variables › Actions**:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Workflow runs after each GitHub release, submits Firefox ZIP with `web-ext sign --channel=listed`. To retry submission, run **Actions › Store publishing › Run workflow**, enter published version, such as `0.2.2`, choose `firefox`. AMO rejects version number it already received, so retry only helps when earlier run failed before upload.

## Store permission justifications

Workflows upload packages only; permission texts in Chrome Web Store dashboard (**Privacy practices**) and AMO reviewer notes filled in by hand. Release adding permission needs maintainer to update them before submit, from [permissions table](../PRIVACY.md#permissions). Host permission text for both stores:

> Optional host permissions for www.youtube.com, www.reddit.com, old.reddit.com, x.com, twitter.com, www.instagram.com, github.com, news.ycombinator.com, stackoverflow.com, dev.to, lobste.rs, bsky.app, soundcloud.com, m.soundcloud.com, open.spotify.com, letterboxd.com, www.imdb.com, m.imdb.com, www.goodreads.com, medium.com and substack.com with their publication subdomains, requested only when the user adds the site in Settings › Sources, given back on removal. While granted, a content script notices the user's own click on the site's save control (Watch later, Save, Bookmark, Star, favorite, Like, Watchlist, Want to Read) and bookmarks it locally. It reads only that item's link and title (on Hacker News and Lobsters also the discussion page address), sends and intercepts no requests. It changes nothing on the site, except on a site set to Save to TabLodge only, where it stops that click so the item stays local. On the user's own saved page (Reddit, YouTube, X, Instagram, GitHub) it reads listed links, titles, and old Reddit comment authors, and adds missing ones only on confirmation.

`vp run version:next` shows next version based on local tags.

## Store publishing retries

**Store publishing** also runs every six hours. Looks at latest release, skips it when older than seven days, starts store job only when no earlier run reached that job's "accepted" step (`Chrome accepted the package`, `Firefox accepted the package`) for that version. Job names carry version, so keep `Submit v<version> to ...` and step names as they are. Failed Firefox upload also retries this way, though AMO refuses version it already received.
