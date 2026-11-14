# Website (`apps/site`)

The website at <https://tablodge.bbay.dev> is a static [Astro](https://astro.build) site. It uses scoped CSS and system fonts and ships no JavaScript to the browser.

## Local development

Install the Vite+ CLI once as described in [README Development](../README.md#development), then run these commands from the repository root:

```sh
pnpm install
vp run site:dev
```

The development server runs at `http://localhost:4321`. `vp run site:build` writes the static site to `apps/site/dist/`. Use `vp run site:preview` to serve that build locally.

## Where to edit

Paths below are relative to `apps/site/`.

| Path | Contents |
| --- | --- |
| `src/pages/index.astro` | Main page, features, FAQ, and structured data |
| `src/pages/alternatives.astro` | Comparison with OneTab, Session Buddy, and Toby |
| `src/pages/privacy.astro` | Website and extension privacy policy |
| `src/pages/terms.astro` | Terms of use, linked from the footer and the Google OAuth consent screen |
| `src/pages/404.astro` | Page not found |
| `src/components/DownloadButtons.astro` | The Chrome Web Store, Firefox Add-ons, and Android buttons used on the home and alternatives pages. A small script picks the one that suits the visitor's device and puts it first |
| `src/lib/platform.ts` | Works out the visitor's device from the user agent: Chromium and Firefox on a computer, Android, iPhone and iPad, Safari, and anything else. Tested in `apps/site/tests/site-platform.test.ts` |
| `src/layouts/Base.astro` | Shared layout, header, footer, metadata, and structured data |
| `src/assets/` | Extension screenshots in light and dark themes |
| `public/` | Icons, social image, web manifest, `robots.txt`, and custom domain file |
| `src/site.ts` | Shared site values. The version comes from `SITE_VERSION`, which deployment sets to the latest release, and local builds fall back to the extension manifest version |

Follow the [documentation style](documentation.md) for website copy. Keep extension privacy details consistent with [PRIVACY.md](../PRIVACY.md). Check TabLodge comparisons against the current app, and competitor claims against their own documentation. The [comparison notes](https://github.com/bberka/TabLodge/issues/21#issuecomment-6470138750) are background, not a live feature checklist.

## Download buttons

The page carries all three downloads in a fixed order, so it works without scripts and search engines see every link. In a browser, `DownloadButtons.astro` runs `detectPlatform` and reorders them:

| Visitor | Shown first | Under the buttons |
| --- | --- | --- |
| Chrome, Edge, Brave, Vivaldi, Opera, or ChromeOS | Chrome Web Store | Nothing, or a note to update when older than Chrome 116 |
| Firefox on a computer | Firefox Add-ons | Nothing, or a note to update when older than Firefox 140 |
| Android phone or tablet, any browser | Android app | The extensions are for a computer |
| iPhone or iPad, any browser | Nothing highlighted | There is no iPhone app, and Safari cannot run the extension |
| Safari on a Mac | Nothing highlighted | Safari is not supported, use Chrome or Firefox |
| Anything else | Nothing highlighted | We could not tell which browser you use |

Only the matched download is a filled button; the others stay outlined. To change the rules, edit `src/lib/platform.ts` and its test, and keep the table above in step.

## Screenshots

Use synthetic data, never a personal browser profile. Run `vp run dev:chrome:seed` to load the repeatable sample sessions and bookmarks in the isolated `.dev/chrome-profile`. Existing screenshots were captured with Playwright at twice the display resolution in both themes.

After changing UI shown in a screenshot:

1. Run `vp run dev:chrome:seed` to build the extension and load the sample data.
2. Capture the affected dashboard, search palette, Settings, or side panel in light and dark themes from the opened dev browser.
3. Save WebP files in `apps/site/src/assets/`, keeping the existing names: for example, `dashboard-light.webp` and `dashboard-dark.webp`.

The Android section shows `android-bookmarks` and `android-sessions` in both themes. Capture them from the app's release build on an emulator that syncs from a server holding the same synthetic fixture (a development build shows the dev menu button over the screen), set the theme with `adb shell cmd uimode night yes` or `no`, and save them as WebP in `apps/site/src/assets/` at the screen's own size.

The fixture is synthetic and deterministic. Seeding replaces TabLodge data in the isolated dev profile and loads local icons from `~/.cache/tablodge/dev-favicons.json`, a machine wide cache shared by worktrees. The first run fetches missing icons from sample sites. Delete the cache file to fetch them again. This network activity happens only when you run `vp run dev:chrome:seed`. The extension itself does not fetch favicons or gain extra permissions. Capture is manual, and there is no screenshot command. Astro optimizes the images during the site build.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` builds and deploys the site when a push to `master` changes `apps/site/`, the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or the workflow itself. The release workflow dispatches a website build after publishing each release, so the version shown on the landing page stays current. Other builds read the latest GitHub release version. You can also run **Actions › Website › Run workflow**. Every pull request runs the build job without deploying, so a broken site fails the required `Build site` check.

For the initial setup:

1. In the repository, open **Settings › Pages › Build and deployment** and choose **GitHub Actions** as the source.
2. At the DNS provider for `bbay.dev`, add a `CNAME` record named `tablodge` pointing to `bberka.github.io`. Don't add an `A` record for that name.
3. Run the website workflow. `apps/site/public/CNAME` sets the custom domain to `tablodge.bbay.dev`.
4. In **Settings › Pages**, confirm the domain and wait for the DNS check. Enable **Enforce HTTPS** when the certificate is ready. Issuance can take up to an hour.
