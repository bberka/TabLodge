# TabLodge website

The landing page for [TabLodge](https://github.com/bberka/TabLodge), published at <https://tablodge.bbay.dev>. It is a static [Astro](https://astro.build) site: no client-side JavaScript, plain scoped CSS, and a system font stack.

## Develop

From the repository root:

```sh
pnpm install
pnpm site:dev      # http://localhost:4321
pnpm site:build    # static output in site/dist
pnpm site:preview  # serve the build
```

## Layout

| Path                            | What it is                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/pages/index.astro`         | Landing page (hero, features, privacy, install, import, FAQ) and its SoftwareApplication/FAQ JSON-LD |
| `src/pages/alternatives.astro`  | OneTab / Session Buddy / Toby comparison                                                          |
| `src/pages/privacy.astro`       | Privacy policy, adapted from the root `PRIVACY.md`                                                |
| `src/layouts/Base.astro`        | `<head>` SEO: title, description, canonical, Open Graph, Twitter card, WebSite/Organization/Breadcrumb JSON-LD |
| `src/assets/*.webp`             | UI screenshots (dark and light), optimized by `astro:assets` at build time                        |
| `public/`                       | Favicon, `og.png` (1200x630), touch icons, web manifest, `robots.txt`, `CNAME`                    |
| `src/site.ts`                   | Site constants; the version comes from the root `package.json`                                    |

Keep the privacy page in sync with `PRIVACY.md` and the comparison table with `docs/tab-management-research.md`.

## Screenshots

The screenshots show the built extension rendered with mock data (no personal data), captured at 2x with Playwright in dark and light themes. Re-capture them after big UI changes: run `pnpm build`, serve the built pages with a mocked `chrome.*` API, take the shots, and save them as WebP in `src/assets/` as `dashboard|palette|settings|sidepanel-(dark|light).webp`.

## Deploy (GitHub Pages)

`.github/workflows/pages.yml` builds and deploys the site on every push to `master` that touches `site/**`, and can be run manually (Actions > Website > Run workflow).

One-time setup:

1. **GitHub:** repository **Settings > Pages > Build and deployment > Source: GitHub Actions**.
2. **DNS** (at the provider for `bbay.dev`): add a `CNAME` record, name `tablodge`, value `bberka.github.io`. Do not add an `A` record for it.
3. Run the workflow once (push a change under `site/` or use **Run workflow**). `public/CNAME` makes Pages serve the site at `tablodge.bbay.dev`.
4. In **Settings > Pages**, confirm the custom domain `tablodge.bbay.dev` and wait for the DNS check to pass, then tick **Enforce HTTPS** once the certificate has been issued (this can take up to an hour).
