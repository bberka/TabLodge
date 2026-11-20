# CI and releases

Workflows are in `.github/workflows/`: `test.yml` (checks on every pull request and push), `pages.yml` (website), `mobile.yml` (debug APK), `sync-server.yml` (server image), `release.yml` (release), and `store-publish.yml` (Chrome Web Store and Firefox Add-ons). `agent-context.yml` is a separate small workflow: it runs `node scripts/agent-context.ts --base FETCH_HEAD` on every pull request, docs only ones too, and fails when the agent instructions grew past master's `scripts/agent-context-budget.json` (the `agent-context-increase` label allows it; it is separate so a label change does not rerun the tests). It is not in the gate job below, so add it to the branch ruleset's required checks to enforce it.

`test.yml` keeps one required gate job named like the branch ruleset expects; keep that name when you rename or split jobs.

`test.yml` runs these jobs in parallel, and the gate job `test` needs every one of them, so add a new job to its `needs`. On a pull request, a first job named `changes` lists the touched files through the GitHub API and turns off the jobs they cannot affect; the gate counts a skipped job as passed and a failed or cancelled one as failed. Pushes to `master` run everything.

| Touched | Jobs that run |
| --- | --- |
| Only `docs/`, `*.md`, `LICENSE`, `apps/site/`, issue templates | none (the website has its own workflow) |
| `apps/mobile/` | `lint`, `typecheck`, `unit`, `mobile` |
| `apps/server/` | `lint`, `typecheck`, `unit`, `cloudflare` |
| `apps/extension/src/shared/` | all of them |
| other `apps/extension/` | `lint`, `typecheck`, `unit`, and the browser jobs (`extension`, `a11y`, `browser`, `private-storage`) |
| anything else, including `package.json`, the lockfile, and this workflow | all of them |

A path the `changes` job does not know runs everything, so add a rule there when a new top level folder should skip jobs. The jobs:

| Job | Runs |
| --- | --- |
| `lint` | `xo` on three groups of files, one job each (extension `src`; mobile; everything else) |
| `typecheck` | `tsgo -b` (the native TypeScript compiler, about ten times faster than `tsc -b` with the same errors) |
| `unit` | `vp test run` |
| `extension` | `vp run build`, `vp run pack`, `vp run check:firefox` |
| `a11y` | `vp run build`, `vp run check:a11y` in four shards |
| `browser` | `vp run build`, then `check:startup`, `check:dev-browser` |
| `private-storage` | `vp run build`, `vp run check:private-storage` (one long scenario, so it is not sharded) |
| `cloudflare` | `pnpm run cf:bundle`, then `git diff --exit-code` on `apps/server/cloudflare-deploy` |
| `mobile` | `pnpm run mobile:export`, which first lists the licences of every package in the bundle and fails on one with no licence |

The jobs run side by side, so the slowest one sets how long a pull request waits. Split a job before it becomes the longest. Every tracked source file must belong to exactly one `lint` group, so add a new top level folder to the third. `check:a11y` runs every fourth check when `A11Y_SHARD=<index>/4` is set (a check's position in the fixed run order decides its shard), and each shard seeds its own profile, so a check must not rely on state an earlier check left. Locally, `vp run check` still runs lint, typecheck, and tests in one command.

The browser jobs install Playwright Chromium with `vp run browser:install` and cache `~/.cache/ms-playwright`. What CI does not run: the Android Gradle build (only **Mobile** does, behind a path filter), the Docker image build (only **Sync server image**, behind a path filter), and the website build (**Pages** runs on every pull request, because its check is required). Nothing runs the app on an emulator or checks the Store publishing steps.


TabLodge uses [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

The root `VERSION` file holds the minor number. The release workflow computes the patch from the latest `v0.<minor>.*` tag. For example, with `VERSION` set to `1` and a latest release of `0.1.1`, the next release is `0.1.2`. Set `VERSION` to `2` and the next release is `0.2.0`. The minor number cannot go below the latest released minor.

Run **Actions › Release › Run workflow** on `master` to publish a release. The workflow stamps the version into `apps/extension/shell/manifest.json` (the source holds `0.0.0`, so a local build never claims a release version), runs the checks and build, and publishes the Chromium and Firefox ZIPs with their SHA256 checksums under a `v0.x.y` tag. It then sends one `tablodge-release-published` dispatch, which starts the website deployment and the Store publishing workflow. That workflow runs two independent jobs. The Chrome job verifies the release ZIP against its checksum, uploads it to the existing listing, and submits it for publication, and Google review may delay when the update becomes available. The Firefox job verifies the Firefox ZIP, packages the source at the release tag, and submits both to the listed add-on, and the job finishes once AMO has queued the version, not after review. The unsigned Firefox ZIP is also published as a release asset. To build and package the extension locally, follow the [README build steps](../install.md#build-from-source). The same workflow then builds the Android app from the release tag, signs it, and attaches `tablodge.apk` and `tablodge.apk.sha256` to the release (see [Android app](#android-app)).

## Android app

The app has its own workflow, **Mobile**. Pull requests and pushes to `master` that touch `apps/mobile/` or the code it shares (`apps/extension/src/shared/`, the types, the private library and link helpers, the mobile tests, the lockfile) run the app's tests, generate the Android project, write the Open source licences list (`pnpm run mobile:export`, after prebuild so the list covers the native libraries), bundle its JavaScript, build the debug APK with Gradle, and keep the APK as a build artifact named `tablodge-debug-apk` for 14 days. Both the debug and the release APK carry the 64 bit and 32 bit ARM libraries that phones use, so they do not run on an x86 emulator; use `pnpm run mobile:android` there. To try the current checkout on a phone without waiting for CI, run `pnpm run mobile:apk` (see [Android app](../android.md)). The **Test** workflow still runs lint, typecheck, every test, and the JavaScript bundle on every change, so a mobile change is checked even when the path filter skips **Mobile**.

The **Release** workflow adds an `android` job after the release is published. It checks out the release tag, writes the release version and a version code into `apps/mobile/app.json` (`scripts/release-version.ts set-android`; the code is `minor * 1000 + patch`, so 0.2.5 is 2005, and it only goes up), writes the Open source licences list from the bundle and the release classpath (`licences --native`, which fails when a package has no licence), builds a release APK for `arm64-v8a` and `armeabi-v7a`, signs it with the release key, verifies the signature, and uploads `tablodge.apk` and its checksum to the release.

Android installs an update only when it is signed with the same key as the app it replaces, so create the release key once and keep it safe: losing it means people must uninstall the app and lose their local copy before installing a new APK.

1. Create the key: `keytool -genkeypair -v -keystore tablodge-release.keystore -alias tablodge -keyalg RSA -keysize 4096 -validity 36500`. Use a strong password and keep the file and the password somewhere private and backed up.
2. Add four repository secrets under **Settings › Secrets and variables › Actions**: `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 tablodge-release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`tablodge`), and `ANDROID_KEY_PASSWORD`.

Without the secrets the `android` job fails and the release has no APK; the extension zips and the image are still published. After adding the secrets, re-run that job from the release run to attach the APK. The same re-run retries a failed APK build. The APK is not published to Google Play yet. The app's **Check for updates** reads the latest release and its `tablodge.apk` asset, so keep that asset name and the `v0.x.y` tag format. A Play Store build must drop that button, the `app-update` module, and the `REQUEST_INSTALL_PACKAGES` permission in `app.json`, because Play does not allow an app to install updates from outside the store; it would open the store listing instead.

## Sync server image

The sync server image shares the extension's version. Pull requests that touch `apps/server/` or the shared sync code build it, and every such push to `master` publishes `ghcr.io/bberka/tablodge-sync:edge`. After the release ZIPs, the **Release** workflow calls the **Sync server image** workflow, which publishes `ghcr.io/bberka/tablodge-sync:<version>` and `:latest`. The package must be public on GitHub for others to pull it. New packages start private, so make it public once in the package's settings. The image job stamps the release version into `apps/server/package.json` (`node scripts/release-version.ts set-server`), which the server reports at `/v1/status`; the `edge` image and the committed Cloudflare Worker say `0.0.0`, because the release check would find a stamped `worker.js` stale. Bump `PROTOCOL_VERSION` in `apps/extension/src/shared/sync/change-log.ts`, which the server and the apps share, only for a change old clients cannot use, because both apps stop syncing with a server on another protocol. Add its first release to `PROTOCOL_RELEASES` in `compat.ts` beside it.

The **Deploy to Cloudflare** button copies only `apps/server/cloudflare-deploy/`, so that folder holds a prebuilt `worker.js` instead of the source. After changing `apps/server/src` or `apps/extension/src/shared/sync`, run `pnpm run cf:bundle` and commit the new `worker.js`. A test in `apps/server/tests/cloudflare-deploy.test.ts` fails while it is out of date. Keep `name`, `compatibility_date`, the Durable Object binding and class, `migrations`, and `vars` in its `wrangler.jsonc` the same as in `apps/server/wrangler.jsonc`, so a button deploy and `cf:setup` can take over from each other. Another test in the same file checks this.

## Chrome Web Store publishing

Before the first release, enable the Chrome Web Store API in a Google Cloud project and create OAuth credentials authorized with the `https://www.googleapis.com/auth/chromewebstore` scope. Generate a refresh token for the Google account that owns the existing listing. If the OAuth consent screen remains in Testing, Google may expire the refresh token after seven days, so configure a production consent screen for ongoing automation.

In GitHub repository **Settings › Secrets and variables › Actions**, add the `CWS_PUBLISHER_ID` repository variable using the publisher ID from the Chrome Web Store Developer Dashboard. Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

The workflow already has TabLodge's extension ID. It runs after each GitHub release. Google rejects an upload while an earlier version is in review. The job then ends green with a warning, and the scheduled retry (below) submits the release later. To retry by hand, run **Actions › Store publishing › Run workflow**, enter the published version, such as `0.1.4`, and choose `chrome`.

## Firefox Add-ons publishing

Submit the first version of `tablodge@bbay.dev` by hand on addons.mozilla.org, with the source ZIP and build notes, and fill in the listing. After that, create API credentials under **Developer Hub › Manage API Keys** and add these repository secrets in **Settings › Secrets and variables › Actions**:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

The workflow runs after each GitHub release and submits the Firefox ZIP with `web-ext sign --channel=listed`. If a submission needs to be retried, run **Actions › Store publishing › Run workflow**, enter the published version, such as `0.2.2`, and choose `firefox`. AMO rejects a version number it has already received, so a retry only helps when the earlier run failed before the upload.

## Store permission justifications

The workflows upload packages only; the permission texts in the Chrome Web Store dashboard (**Privacy practices**) and the AMO reviewer notes are filled in by hand. A release that adds a permission needs the maintainer to update them before it is submitted, from the [permissions table](../PRIVACY.md#permissions). The current host permission text, for both stores:

> Optional host permissions for www.youtube.com, www.reddit.com, old.reddit.com, x.com, twitter.com, www.instagram.com, github.com, news.ycombinator.com, stackoverflow.com, dev.to, lobste.rs, bsky.app, soundcloud.com, m.soundcloud.com, open.spotify.com, letterboxd.com, www.imdb.com, m.imdb.com, www.goodreads.com, medium.com and substack.com with their publication subdomains, requested only when the user adds the site in Settings › Sources, given back on removal. While granted, a content script notices the user's own click on the site's save control (Watch later, Save, Bookmark, Star, favorite, Like, Watchlist, Want to Read) and bookmarks it locally. It reads only that item's link and title (on Hacker News and Lobsters also the discussion page address, for the note), sends and intercepts no requests. It changes nothing on the site, except on X and Reddit set to Save to TabLodge only, where it stops that click so the item stays local. On the user's Reddit saved page it reads listed links, titles, and old Reddit comment authors, and adds missing ones only on confirmation.

`vp run version:next` shows the next version based on your local tags.

## Store publishing retries

**Store publishing** also runs every six hours. It looks at the latest release, skips it when it is older than seven days, and starts a store job only when no earlier run reached that job's "accepted" step (`Chrome accepted the package`, `Firefox accepted the package`) for that version. Job names carry the version, so keep `Submit v<version> to ...` and the step names as they are. A failed Firefox upload also retries this way, though AMO refuses a version it already received.

