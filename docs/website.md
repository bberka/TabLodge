# TabLodge website

The website at <https://tablodge.bbay.dev> is a static [Astro](https://astro.build) site. It uses scoped CSS and system fonts, with no JavaScript shipped to the browser.

## Local development

Install the Vite+ CLI once as described in [README Development](README.md#development), then run these commands from the repository root:

```sh
pnpm install
vp run site:dev
```

The development server runs at `http://localhost:4321`. `vp run site:build` writes the static site to `site/dist/`. Use `vp run site:preview` to serve that build locally.

## Where to edit

Paths below are relative to `site/`.

| Path | Contents |
| --- | --- |
| `src/pages/index.astro` | Main page, features, installation, imports, FAQ, and structured data |
| `src/pages/alternatives.astro` | Comparison with OneTab, Session Buddy, and Toby |
| `src/pages/privacy.astro` | Website and extension privacy policy |
| `src/layouts/Base.astro` | Shared layout, metadata, and structured data |
| `src/assets/` | Extension screenshots in light and dark themes |
| `public/` | Icons, social image, web manifest, `robots.txt`, and custom domain file |
| `src/site.ts` | Shared site values; deployment uses the latest release version and local builds fall back to `package.json` |

Follow the [documentation style](CONTRIBUTING.md#writing-documentation) for website copy. Keep extension privacy details consistent with [PRIVACY.md](PRIVACY.md). Check TabLodge comparisons against the current app, and competitor claims against their own documentation. The [comparison notes](tab-management-research.md) are background, not a live feature checklist.

## Screenshots

Use synthetic data, never a personal browser profile. Run `vp run dev:seed` to load the repeatable sample sessions and bookmarks in the isolated `.dev/chrome-profile`. Existing screenshots were captured with Playwright at twice the display resolution in both themes.

After changing UI shown in a screenshot:

1. Run `vp run dev:seed` to build the extension and load the sample data.
2. Capture the affected dashboard, search palette, Settings, or side panel in light and dark themes from the opened dev browser.
3. Save WebP files in `site/src/assets/`, keeping the existing names: for example, `dashboard-light.webp` and `dashboard-dark.webp`.

The fixture is synthetic and deterministic. Seeding replaces TabLodge data in the isolated dev profile and loads local icons from `~/.cache/tablodge/dev-favicons.json`, a machine wide cache shared by worktrees. The first run fetches missing icons from sample sites. Delete the cache file to fetch them again. This network activity only happens when you explicitly run `vp run dev:seed`; the extension itself does not fetch favicons or gain extra permissions. This is a manual capture process; there is no dedicated screenshot command. Astro optimizes the images during the site build.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` builds and deploys changes to `site/**` on `master`. The release workflow dispatches a website build after publishing each release, so the version shown on the landing page stays current. Other builds read the latest GitHub release version. You can also run **Actions › Website › Run workflow**.

For the initial setup:

1. In the repository, open **Settings › Pages › Build and deployment** and choose **GitHub Actions** as the source.
2. At the DNS provider for `bbay.dev`, add a `CNAME` record named `tablodge` pointing to `bberka.github.io`. Don't add an `A` record for that name.
3. Run the website workflow. `site/public/CNAME` sets the custom domain to `tablodge.bbay.dev`.
4. In **Settings › Pages**, confirm the domain and wait for the DNS check. Enable **Enforce HTTPS** when the certificate is ready; issuance can take up to an hour.
