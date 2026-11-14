# CI and releases

Workflows are in `.github/workflows/`: `test.yml` (checks on every pull request and push), `pages.yml` (website), `mobile.yml` (debug APK), `sync-server.yml` (server image), `release.yml` (release), and `store-publish.yml` (Chrome Web Store and Firefox Add-ons). `test.yml` keeps one required gate job named like the branch ruleset expects; keep that name when you rename or split jobs.


TabLodge uses [ZeroVer](https://0ver.org): `0.<minor>.<patch>`.

The root `VERSION` file holds the minor number. The release workflow computes the patch from the latest `v0.<minor>.*` tag. For example, with `VERSION` set to `1` and a latest release of `0.1.1`, the next release is `0.1.2`. Set `VERSION` to `2` and the next release is `0.2.0`. The minor number cannot go below the latest released minor.

Run **Actions › Release › Run workflow** on `master` to publish a release. The workflow stamps the version into `apps/extension/shell/manifest.json` (the source holds `0.0.0`, so a local build never claims a release version), runs the checks and build, and publishes the Chromium and Firefox ZIPs with their SHA256 checksums under a `v0.x.y` tag. It then sends one `tablodge-release-published` dispatch, which starts the website deployment and the Store publishing workflow. That workflow runs two independent jobs. The Chrome job verifies the release ZIP against its checksum, uploads it to the existing listing, and submits it for publication, and Google review may delay when the update becomes available. The Firefox job verifies the Firefox ZIP, packages the source at the release tag, and submits both to the listed add-on, and the job finishes once AMO has queued the version, not after review. The unsigned Firefox ZIP is also published as a release asset. To build and package the extension locally, follow the [README build steps](../README.md#build-from-source). The same workflow then builds the Android app from the release tag, signs it, and attaches `tablodge.apk` and `tablodge.apk.sha256` to the release (see [Android app](#android-app)).

## Android app

The app has its own workflow, **Mobile**. Pull requests and pushes to `master` that touch `apps/mobile/` or the code it shares (`apps/extension/src/shared/`, the types, the private library and link helpers, the mobile tests, the lockfile) run the app's tests, bundle its JavaScript, build the debug APK with Gradle, and keep the APK as a build artifact named `tablodge-debug-apk` for 14 days. Both the debug and the release APK carry the 64 bit and 32 bit ARM libraries that phones use, so they do not run on an x86 emulator; use `pnpm run mobile:android` there. To try the current checkout on a phone without waiting for CI, run `pnpm run mobile:apk` (see the [README](../README.md#android-app)). The **Test** workflow still runs lint, typecheck, every test, and the JavaScript bundle on every change, so a mobile change is checked even when the path filter skips **Mobile**.

The **Release** workflow adds an `android` job after the release is published. It checks out the release tag, writes the release version and a version code into `apps/mobile/app.json` (`scripts/release-version.ts set-android`; the code is `minor * 1000 + patch`, so 0.2.5 is 2005, and it only goes up), builds a release APK for `arm64-v8a` and `armeabi-v7a`, signs it with the release key, verifies the signature, and uploads `tablodge.apk` and its checksum to the release.

Android installs an update only when it is signed with the same key as the app it replaces, so create the release key once and keep it safe: losing it means people must uninstall the app and lose their local copy before installing a new APK.

1. Create the key: `keytool -genkeypair -v -keystore tablodge-release.keystore -alias tablodge -keyalg RSA -keysize 4096 -validity 36500`. Use a strong password and keep the file and the password somewhere private and backed up.
2. Add four repository secrets under **Settings › Secrets and variables › Actions**: `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 tablodge-release.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`tablodge`), and `ANDROID_KEY_PASSWORD`.

Without the secrets the `android` job prints a warning and the release has no APK; nothing else is affected. To retry a failed APK build, re-run that job from the release run. The APK is not published to Google Play yet.

## Sync server image

The sync server image shares the extension's version. Pull requests that touch `apps/server/` or the shared sync code build it, and every such push to `master` publishes `ghcr.io/bberka/tablodge-sync:edge`. After the release ZIPs, the **Release** workflow calls the **Sync server image** workflow, which publishes `ghcr.io/bberka/tablodge-sync:<version>` and `:latest`. The package must be public on GitHub for others to pull it. New packages start private, so make it public once in the package's settings. Bump `PROTOCOL_VERSION` in `apps/extension/src/shared/sync/change-log.ts`, which the server and the extension share, only for a change old extensions cannot use, because the extension refuses a server with a different protocol version.

The **Deploy to Cloudflare** button copies only `apps/server/cloudflare-deploy/`, so that folder holds a prebuilt `worker.js` instead of the source. After changing `apps/server/src` or `apps/extension/src/shared/sync`, run `pnpm run cf:bundle` and commit the new `worker.js`. A test in `apps/server/tests/cloudflare-deploy.test.ts` fails while it is out of date. Keep `name`, `compatibility_date`, the Durable Object binding and class, `migrations`, and `vars` in its `wrangler.jsonc` the same as in `apps/server/wrangler.jsonc`, so a button deploy and `cf:setup` can take over from each other. Another test in the same file checks this.

## Chrome Web Store publishing

Before the first release, enable the Chrome Web Store API in a Google Cloud project and create OAuth credentials authorized with the `https://www.googleapis.com/auth/chromewebstore` scope. Generate a refresh token for the Google account that owns the existing listing. If the OAuth consent screen remains in Testing, Google may expire the refresh token after seven days, so configure a production consent screen for ongoing automation.

In GitHub repository **Settings › Secrets and variables › Actions**, add the `CWS_PUBLISHER_ID` repository variable using the publisher ID from the Chrome Web Store Developer Dashboard. Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

The workflow already has TabLodge's extension ID. It runs after each GitHub release. If a submission needs to be retried, run **Actions › Store publishing › Run workflow**, enter the published version, such as `0.1.4`, and choose `chrome`.

## Firefox Add-ons publishing

Submit the first version of `tablodge@bbay.dev` by hand on addons.mozilla.org, with the source ZIP and build notes, and fill in the listing. After that, create API credentials under **Developer Hub › Manage API Keys** and add these repository secrets in **Settings › Secrets and variables › Actions**:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

The workflow runs after each GitHub release and submits the Firefox ZIP with `web-ext sign --channel=listed`. If a submission needs to be retried, run **Actions › Store publishing › Run workflow**, enter the published version, such as `0.2.2`, and choose `firefox`. AMO rejects a version number it has already received, so a retry only helps when the earlier run failed before the upload.

`vp run version:next` shows the next version based on your local tags.

