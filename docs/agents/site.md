# Website (`apps/site`)

The website at <https://tablodge.bbay.dev> is static [Astro](https://astro.build) site. Use scoped CSS, system fonts, ship no JavaScript to browser.

## Local development

Install Vite+ CLI once as described in [Contributing Development](../CONTRIBUTING.md#development), then run these commands from repository root:

```sh
pnpm install
vp run site:dev
```

Development server runs at `http://localhost:4321`. `vp run site:build` writes static site to `apps/site/dist/`. Use `vp run site:preview` to serve that build locally.

## Where to edit

Paths below relative to `apps/site/`.

| Path | Contents |
| --- | --- |
| `src/pages/index.astro` | Main page, features, FAQ, structured data |
| `src/pages/alternatives.astro` | Comparison with OneTab, Session Buddy, Toby |
| `src/pages/alternatives/android.astro` | Android app compared with Raindrop.io, Linkwarden, Karakeep, wallabag, Instapaper, with dated source list |
| `src/components/AlternativesSwitch.astro` | Two-way switch at top of both comparison pages (browser extensions, Android app). Add third comparison here |
| `src/pages/privacy.astro` | Website and extension privacy policy |
| `src/pages/terms.astro` | Terms of use, linked from footer and Google OAuth consent screen |
| `src/pages/404.astro` | Page not found |
| `src/components/DownloadButtons.astro` | One download button with menu for other two (Chrome Web Store, Firefox Add-ons, Android), used on home and alternatives pages. Small script puts one suiting visitor's device on button, rest in menu |
| `src/lib/downloads.ts`, `src/components/DownloadLink.astro` | List of downloads (label, link, icon) and single button component for one of them. Add platform here, in `ButtonIcon.astro`, and in `platform.ts`; never hand-write download button |
| `src/lib/platform.ts` | Works out visitor's device from user agent: Chromium and Firefox on computer, Android, iPhone and iPad, Safari, anything else. Tested in `apps/site/tests/site-platform.test.ts` |
| `src/layouts/Base.astro` | Shared layout, header, footer, metadata, structured data |
| `src/assets/` | Extension screenshots in light and dark themes |
| `public/` | Icons, social image, web manifest, `robots.txt`, custom domain file |
| `src/site.ts` | Shared site values. Version comes from `SITE_VERSION`, which deployment sets to latest release; local builds fall back to extension manifest version |

Follow [documentation style](documentation.md) for website copy. Keep extension privacy details consistent with [PRIVACY.md](../PRIVACY.md). Check TabLodge comparisons against current app, competitor claims against their own documentation. [Comparison notes](https://github.com/bberka/TabLodge/issues/21#issuecomment-6470138750) are background, not live feature checklist.

## Download buttons

Page carries all three downloads, so works without scripts and search engines see every link. In browser, `DownloadButtons.astro` runs `detectPlatform`, moves first choice onto button and others into its menu:

| Visitor | On the button | Under the button |
| --- | --- | --- |
| Chrome, Edge, Brave, Vivaldi, Opera, or ChromeOS | Chrome Web Store | Nothing, or note to update when older than Chrome 116 |
| Firefox on a computer | Firefox Add-ons | Nothing, or note to update when older than Firefox 140 |
| Android phone or tablet, any browser | Android app | The extensions are for a computer |
| iPhone or iPad, any browser | Nothing highlighted | There is no iPhone app, and Safari cannot run the extension |
| Safari on a Mac | Nothing highlighted | Safari is not supported, use Chrome or Firefox |
| Anything else | Nothing highlighted | We could not tell which browser you use |

Only matched download is filled button; with no match button is outlined. To change rules, edit `src/lib/platform.ts` and its test, keep table above in step.

## Screenshots

Use synthetic data, never personal browser profile. Run `vp run dev:chrome --seed-data` to load repeatable sample sessions and bookmarks in isolated `.dev/chrome-profile`. Existing screenshots captured with Playwright at twice display resolution in both themes.

After changing UI shown in screenshot:

1. Run `vp run dev:chrome --seed-data` to build extension and load sample data.
2. Capture affected dashboard, search palette, Settings, or side panel in light and dark themes from opened dev browser.
3. Save WebP files in `apps/site/src/assets/`, keeping existing names: for example, `dashboard-light.webp` and `dashboard-dark.webp`.

Android section shows `android-bookmarks` and `android-sessions` in both themes. Capture from app's release build on emulator syncing from server holding same synthetic fixture (development build shows dev menu button over screen), set theme with `adb shell cmd uimode night yes` or `no`, save as WebP in `apps/site/src/assets/` at screen's own size. Use app's defaults, so floating tab bar shows: clear app's data first (`adb shell pm clear com.bberka.tablodge`) and leave settings alone. Without server, fresh build with development seed (`apps/mobile/src/library/seed.ts`, which release build leaves out unless its `__DEV__` checks are lifted for capture, and that change is never committed) holds same fixture. Set status bar to 9:41 with system UI demo mode.

Fixture is synthetic and deterministic. Seeding replaces TabLodge data in isolated dev profile and loads local icons from `~/.cache/tablodge/dev-favicons.json`, machine wide cache shared by worktrees. First run fetches missing icons from sample sites. Delete cache file to fetch them again. Network activity happens only when you run `vp run dev:chrome --seed-data`. Extension itself does not fetch favicons or gain extra permissions. Capture is manual, no screenshot command. Astro optimizes images during site build.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` deploys site only when release is published, not when change reaches `master`. Release workflow dispatches deployment after publishing each release, which also sets version shown on landing page. Other builds read latest GitHub release version. To publish site changes without release, run **Actions › Website › Run workflow**. Every pull request runs build job without deploying, so broken site fails required `Build site` check.

For initial setup:

1. In repository, open **Settings › Pages › Build and deployment** and choose **GitHub Actions** as source.
2. At DNS provider for `bbay.dev`, add `CNAME` record named `tablodge` pointing to `bberka.github.io`. Don't add `A` record for that name.
3. Run website workflow. `apps/site/public/CNAME` sets custom domain to `tablodge.bbay.dev`.
4. In **Settings › Pages**, confirm domain and wait for DNS check. Enable **Enforce HTTPS** when certificate ready. Issuance can take up to hour.
