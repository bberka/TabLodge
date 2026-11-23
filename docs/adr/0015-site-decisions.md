# 15. Website decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/site` carried a few non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so they live here with the symbol that carries each. How to edit the site is in [Website](../agents/site.md).

## Decisions

* **The page names the download that suits the visitor.** `src/lib/platform.ts`, `detectPlatform`, is pure, so `tests/site-platform.test.ts` covers every case without a browser. The page runs it in the visitor's browser; without scripts it shows every option in `DEFAULT_ORDER`. A new platform is an entry in `src/lib/downloads.ts`, a path in `ButtonIcon.astro`, and a case in `detectPlatform`.
* **Minimum versions.** `MIN_CHROMIUM` is 116, the oldest Chrome the extension supports. `MIN_FIREFOX` is 140, the first Firefox with the tab group support it needs.
* **An iPad is a Mac with a touch screen.** An iPad asks for the desktop site, so its user agent names a Mac. `detectPlatform` treats a `Macintosh` agent with more than one touch point (`Hints.touchPoints`) as iOS. `tests/site-platform.test.ts` covers it.
* **Other phones and tablets get no download.** They cannot run an extension and the site has no app for them, so `detectPlatform` returns `other` with no primary when `Hints.mobile` is true.
* **Chromium is matched by `Chrome/<major>`.** Every Chromium browser, reduced user agent or not, still says `Chrome/<major>` (or `Edg/`, `OPR/`) in its user agent string.
* **PostCSS loads no plugins.** The site uses plain CSS; `postcss.config.cjs` stops PostCSS from loading the extension's Tailwind config from the repository root.
* **The domain.** `astro.config.mjs` builds a static site for `https://tablodge.bbay.dev` on GitHub Pages, with the custom domain set by `public/CNAME`.
