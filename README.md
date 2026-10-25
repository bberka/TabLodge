<h1 align="center">
  <img src="extension/icons/tablodge.svg" alt="" width="72" height="72"><br>
  TabLodge
</h1>

<p align="center"><strong>A cozy, local-only home for your tabs: save sessions, restore them, and keep a bookmark board on your new tab.</strong></p>

<p align="center"><a href="https://tablodge.bbay.dev">Website: https://tablodge.bbay.dev</a></p>

<p align="center">
  <a href="https://github.com/bberka/TabLodge/actions/workflows/test.yml"><img src="https://github.com/bberka/TabLodge/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Chromium%20browsers-Manifest%20V3-4285F4" alt="Manifest V3">
</p>

TabLodge is a Manifest V3 extension for Chromium-based browsers (Chrome, Brave, Edge, Vivaldi, Opera, and others). It turns open windows into named sessions you can restore later, and replaces the new-tab page with a local bookmark board. There are no accounts, servers, or tracking: everything stays in your browser's extension storage.

## Features

- **Sessions that remember how you worked.** Save a window, selected tabs, a tab group, everything left or right of a tab, or all windows. Restores bring back native tab groups (title, color, collapsed state), pinned tabs (opt-in), and split-view pairs side by side on Chromium 155+.
- **Bookmark board on the new tab.** Columns of bookmarks with search, drag-and-drop reordering, and drop-a-link-to-save. Session links can be dragged straight into a column.
- **Organize sessions.** Folders, descriptions, search and sorting, multi-select, archive, and lock (a locked session keeps its tabs no matter how you restore it).
- **Flexible restores.** Restore into the current or a new window; keep, remove, or archive the saved tabs afterward; skip duplicates; optionally unload background tabs. Ctrl/Cmd-, Alt-, and Shift-click give one-off overrides.
- **Import and export.** Session and bookmark JSON backups, a full-backup ZIP (everything, including settings) you can import back, a shareable HTML page of selected sessions, and a one-time import of your browser bookmarks.
- **Crash recovery, backups and undo.** Rolling snapshots of your open windows offer to restore your last session after an unclean exit; optional automatic backups (with an optional copy in Downloads) and safety backups before risky actions; a trash with retention, and an Undo toast instead of a confirmation for deletes, erasing data, restoring backups, and imports. All local. See [docs/architecture.md](docs/architecture.md#recovery-snapshots-backups-and-trash).
- **Everywhere you need it.** A toolbar popup with a quick chooser, a side panel (bookmarks, sessions and open tabs), keyboard shortcuts, and page and toolbar context menus.
- **Local-only and private.** No host permissions, no content scripts, no network requests, no analytics. See [PRIVACY.md](PRIVACY.md).
- **Light, dark, and system themes** with no flash on load.

## Screenshots

<!-- TODO: add screenshots, for example docs/screenshots/newtab.png, popup.png, sidepanel.png, settings.png. -->

_Screenshots coming soon._

## Install

TabLodge isn't in the extension stores yet. Install it in any Chromium-based browser (Chrome 116+, Brave, Edge, Vivaldi, Opera, …) in one of two ways.

### Option 1: Download a release (no tools needed)

1. Download the latest **`tablodge-0.x.y.zip`** from [Releases](https://github.com/bberka/TabLodge/releases/latest).
2. Unzip it into a folder you'll keep, for example `~/Extensions/tablodge`. The browser loads the extension from this folder, so don't delete it.
3. Open your browser's extensions page: `chrome://extensions`, `brave://extensions`, `edge://extensions`, …
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Pin TabLodge from the extensions menu (puzzle icon) for quick access.

**Updating:** download the new zip, replace the folder's contents with it, then click the reload button (↻) on TabLodge's card. Always reuse the same folder: the browser ties your saved sessions and bookmarks to the folder the extension is loaded from.

### Option 2: Build from source

Requirements: [Git](https://git-scm.com), [Node.js](https://nodejs.org) 22.18+ or 24.11+, and [pnpm](https://pnpm.io) (`corepack enable` installs the version pinned in `package.json`).

```sh
git clone https://github.com/bberka/TabLodge.git
cd TabLodge
corepack enable
pnpm install
pnpm build
```

Then load the build:

1. Open your browser's extensions page and turn on **Developer mode** (same as Option 1).
2. Click **Load unpacked** and select the **`dist/tablodge/`** folder inside the clone. Don't select the repository root or `extension/`, which hold sources.

**Updating:**

```sh
git pull
pnpm install
pnpm build
```

Then click the reload button (↻) on TabLodge's card.

### After installing

- Open a new tab to see the dashboard, or click the toolbar icon for the quick popup.
- Open the side panel with the "Open side panel" shortcut or the toolbar icon's right-click menu, or make the toolbar icon open it (Settings > Side Panel > Toolbar icon opens). In Brave, right-click the sidebar and add TabLodge, or pick it from the sidebar's extensions panel.
- Change keyboard shortcuts at `chrome://extensions/shortcuts` (or your browser's equivalent).

## Development

TabLodge is written in TypeScript (strict) with React 19, Radix primitives in local shadcn-style components, Lucide icons, and Tailwind CSS 3, built with [Vite+](https://viteplus.dev) (`vite-plus`: Vite 8/Rolldown and Vitest) and managed with [pnpm](https://pnpm.io). Code is linted and formatted with [XO](https://github.com/xojs/xo) (ESLint + Prettier). Every dependency is bundled; no page loads code, styles, fonts, or icons from a CDN.

| Command                               | What it does                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                          | Build the extension into `dist/tablodge/`, then run `scripts/verify-build.ts`                                |
| `pnpm dev` (alias `pnpm watch`)       | Build, then rebuild whenever sources, the manifest, or icons change; reload the extension to pick up changes |
| `pnpm test`                           | Run the Vitest suites once (`pnpm test:watch` keeps watching)                                                |
| `pnpm typecheck`                      | `tsc -b` over all TypeScript projects (pages, service worker, tests, build tooling)                          |
| `pnpm lint`                           | Lint with XO (type-aware TypeScript and React rules)                                                         |
| `pnpm lint:fix` (alias `pnpm format`) | Fix lint issues and format the code with XO's Prettier style                                                 |
| `pnpm check`                          | XO, `tsc -b`, and the tests: run this before a pull request                                                  |
| `pnpm verify`                         | Re-run the package verification on an existing `dist/tablodge/`                                              |
| `pnpm clean`                          | Remove `dist/` and the TypeScript build-info cache                                                           |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and code style, and [docs/architecture.md](docs/architecture.md) for the build pipeline, data model, and detailed feature behavior.

## Project structure

```text
extension/              manifest.json, icons/, HTML shells, and scripts the manifest loads directly
  service-worker.ts     background logic: saving, restoring, storage, menus, shortcuts
  theme-boot.ts         applies the saved theme before first paint
src/
  app/                  extension pages: newtab, popup, options (Settings), help, sidepanel
    types.ts            data model and the page <-> service worker message protocol
    project.ts          project metadata (name, version, repository links)
  components/ui/        local shadcn-style primitives (Radix + Tailwind)
  shared/               UI helpers and the theme provider
  lib/                  small utilities
styles/                 Tailwind entry and theme tokens
tests/                  Vitest suites (service worker in a VM with a mocked chrome.* API)
scripts/                build.ts, verify-build.ts, shared Vite config helpers
docs/                   architecture notes, naming research, and tab-manager research
site/                   Astro landing page for https://tablodge.bbay.dev (see site/README.md)
vite.pages.config.ts    page build; vite.config.ts holds lint, format, and test settings
```

`tsconfig.json` references `tsconfig.app.json` (DOM pages), `tsconfig.worker.json` (service worker, no DOM), `tsconfig.test.json`, and `tsconfig.node.json` (build tooling).

## Permissions

TabLodge requests no website (host) permissions and injects nothing into web pages. Each permission in `extension/manifest.json` has one job:

| Permission         | Why TabLodge needs it                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `tabs`             | Read tab URLs, titles, pinned state, selection, and window placement to save sessions, and open tabs to restore them. |
| `tabGroups`        | Read native tab-group titles, colors, and collapsed state when saving, and recreate the groups on restore.            |
| `bookmarks`        | Read the browser's bookmark tree, only when you explicitly import your browser bookmarks.                             |
| `favicon`          | Show site icons from the browser's local favicon cache instead of a third-party favicon service.                      |
| `storage`          | Keep sessions, bookmarks, and settings in local extension storage (`chrome.storage.local`).                           |
| `unlimitedStorage` | Lift the default local-storage quota so large session and bookmark libraries fit; disk space is still finite.         |
| `contextMenus`     | Add optional "Save…" and "Bookmark this page" actions to the page and toolbar right-click menus.                      |
| `clipboardWrite`   | Copy bookmark URLs and session links in the format you choose.                                                        |
| `sidePanel`        | Show the optional searchable bookmark list in the browser's Side Panel.                                               |
| `search`           | Run a normal web search with your default search engine when you pick "Search the web" in TabLodge's finder.          |
| `alarms`           | Schedule crash-recovery snapshots, automatic backups, and the daily trash cleanup while the browser runs.             |

One **optional** permission, `downloads`, is requested only if you turn on _Settings › Recovery & backups › Also save a copy to Downloads_. It lets TabLodge write backup JSON files to `Downloads/TabLodge/`; turning the option off gives the permission back.

The manifest also overrides the new-tab page with TabLodge's local page (you can switch its session area off in Settings) and declares the keyboard shortcuts.

## Privacy

TabLodge has no servers, accounts, analytics, or telemetry, and makes no network requests. Your sessions, bookmarks, and settings never leave your device unless you export a file yourself. Details: [PRIVACY.md](PRIVACY.md).

## Roadmap

[docs/tab-management-research.md](docs/tab-management-research.md) compares TabLodge with OneTab, Session Buddy, Tab Session Manager, Toby, Workona, BroTab, and the browsers' built-in features. The biggest fear in this category is losing saved tabs, so the top recommendations focus on safety first:

- **Automatic local backups** with rotating snapshots, a backup before every migration or bulk action, and a "Restore from backup" screen.
- **Trash and undo** for every destructive action (sessions, tabs, bookmarks, columns), with an Undo toast and 30-day retention. (Done: actions on the dashboard run immediately and offer Undo; the Settings page asks first for erase, restore defaults, clearing snapshots, emptying the trash, and restoring or deleting a backup.)
- **Auto-saved window history** so crashes and accidentally closed windows can be recovered without relying on the browser.
- **A live open-tabs manager:** list every window and tab, then filter, activate, close, move, group, pin, mute, discard, or deduplicate.
- **Keyboard-first search and a command palette** (Ctrl/Cmd+K) across open tabs, sessions, bookmarks, and recently closed tabs.
- **Portable import and export:** OneTab text, Session Buddy, Tab Session Manager, Toby, and bookmark HTML in; Markdown, CSV, URL lists, and bookmark HTML out.
- **Scale and robustness:** per-session storage instead of one large value, resumable migrations, virtualized lists, and testing with 10,000+ saved tabs.
- **Session editing** (replace or append the current window, merge and split, tags, an "already saved" badge) and **tab hygiene that never loses data** (optional auto-discard and auto-archive of idle tabs, with undo).

The research file has the full priority list, MV3 implementation sketches, and the evidence behind each item.

## Website

The landing page at <https://tablodge.bbay.dev> lives in [`site/`](site) (Astro, deployed to GitHub Pages by `.github/workflows/pages.yml`). `pnpm site:dev` and `pnpm site:build` run it; setup steps for Pages and DNS are in [site/README.md](site/README.md).

## Contributing

Bug reports, ideas, and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first; for larger changes, open an issue so we can agree on the approach.

## License

[MIT](LICENSE) © 2026 Berkay
