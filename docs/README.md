<h1 align="center">
  <img src="../extension/icons/tablodge.svg" alt="" width="72" height="72"><br>
  TabLodge
</h1>

<p align="center"><strong>Save your tabs for later. Keep your bookmarks on every new tab.</strong></p>

<p align="center"><a href="https://tablodge.bbay.dev">tablodge.bbay.dev</a></p>
<p align="center"><a href="https://chromewebstore.google.com/detail/tablodge-%E2%80%93-tab-session-ma/ekidoclgpdfhpdlidlkcjccgihbndoib"><img src="https://img.shields.io/badge/Chrome_Web_Store-Install_TabLodge-4285F4?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Install TabLodge from the Chrome Web Store"></a></p>
<p align="center"><a href="https://addons.mozilla.org/firefox/addon/tab-lodge/"><img src="https://img.shields.io/badge/Firefox_Add--ons-Install_TabLodge-FF7139?style=for-the-badge&amp;logo=firefoxbrowser&amp;logoColor=white" alt="Install TabLodge from Firefox Add-ons"></a></p>

<p align="center">
  <a href="https://github.com/bberka/TabLodge/actions/workflows/test.yml"><img src="https://github.com/bberka/TabLodge/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Chromium%20browsers-Manifest%20V3-4285F4" alt="Manifest V3">
</p>

TabLodge is a browser extension for Chromium browsers (Chrome, Brave, Edge, Vivaldi, Opera) and desktop Firefox. Save a window as a named session, close it, and bring it back later. Your new tab page becomes a board of bookmark columns.

TabLodge has no accounts and no analytics. Your data stays in your browser profile, and TabLodge talks to no server unless you turn on sync with one you run yourself.

## Features

- **Sessions.** Save tabs, a tab group, a window, or all windows, and restore them with their groups and pinned tabs. Organize sessions in folders (a row of chips, or a vertical list beside the sessions: automatic past nine folders, or chosen with the view button in the Sessions toolbar or **Settings › Session board › Session folder view**), archive old ones, and replace, extend, or split a session from the current window.
- **Bookmark board.** Columns of links on every new tab, in a Focus view (the default: a column list that starts with **All**, a system item listing every bookmark, next to one open column; **Settings › Bookmark board › Show All in the bookmark list** turns All off, here and on the phone, as does **Hide All from this list** in the menu of its header or list item, which has Open all, Add bookmark, and Share too) or a Board view, each column with its own icon and color. Drag or use the keyboard to reorder (also from the Focus column list), paste lists of links, and find duplicates.
- **Search.** A palette (`Ctrl+Shift+K` on any page, `Ctrl+K` or `/` on the dashboard) and the `tl` address bar keyword find open tabs, bookmarks, saved tabs, and sessions.
- **Import and export.** Bring data from OneTab, Session Buddy, Tab Session Manager, Toby, Raindrop.io, or browser bookmarks. Imports add to what you have and skip links you already saved; a full backup can be added or can replace everything. Share or save one session, column, or selection from a single **Share** dialog (links, Markdown, a web page, rich text, JSON, CSV, or a browser bookmarks file), or save a full backup ZIP, optionally protected with a password.
- **Recovery.** Crash snapshots, a trash bin, Undo, and optional automatic backups.
- **Sync with your own server.** Keep the library the same in all your browsers through a server you run yourself, with Docker or on your Cloudflare account. On Cloudflare, a Deploy to Cloudflare button sets it up without installing anything. See [Self hosting](self-hosting.md).
- **Private windows.** Use the regular library or a separate one, optionally locked with a PIN or password. See [Private windows](#private-windows).
- **Popup, dashboard, and side panel**, with light and dark themes and your choice of accent color.

The in app Help page explains every feature and setting.

## Screenshots

<p align="center">
  <img src="../site/src/assets/dashboard-light.webp" alt="TabLodge dashboard with a board of bookmark columns above saved sessions" width="800">
</p>
<p align="center">
  <img src="../site/src/assets/palette-dark.webp" alt="Search results for sessions, saved tabs, and bookmarks" width="420">
  <img src="../site/src/assets/sidepanel-light.webp" alt="Bookmark columns in the TabLodge side panel" width="210">
</p>

## Install

**Chromium browsers:** [install from the Chrome Web Store](https://chromewebstore.google.com/detail/tablodge-%E2%80%93-tab-session-ma/ekidoclgpdfhpdlidlkcjccgihbndoib). It works in Chrome, Brave, Edge, Vivaldi, Opera, and other Chromium browsers, and updates itself.

**Manual install:** download `tablodge-0.x.y.zip` from the [latest release](https://github.com/bberka/TabLodge/releases/latest) and unzip it into a folder you keep. Open your browser's extensions page, turn on **Developer mode**, choose **Load unpacked**, and select the folder. To update, replace the folder's contents and reload TabLodge. A manual copy and the store copy keep separate data, so move between them with a full backup (**Settings › Data › Back up › Everything**).

**Firefox:** desktop Firefox 140 or newer. [Install from Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tab-lodge/). It updates itself.

**Manual Firefox install:** use the unsigned `tablodge-0.x.y-firefox.zip` from the [latest release](https://github.com/bberka/TabLodge/releases/latest):

- To try it, open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on**. Firefox removes it on restart, but keeps its data.
- To keep it, use Firefox ESR, Developer Edition, Nightly, or an unbranded build, set `xpinstall.signatures.required` to `false` in `about:config`, and install the ZIP from `about:addons`.

In Firefox, TabLodge always replaces the new tab page, the side panel is Firefox's sidebar, saved items show the icon of a site you have opened in a tab and a letter tile for any other, private windows are not supported, and split view tabs reopen as neighboring tabs. See [Browser support](architecture.md#browser-support).

**Android:** Android 7 or newer. Download `tablodge.apk` from the [latest release](https://github.com/bberka/TabLodge/releases/latest), open it on your phone, and allow your browser or file manager to install apps when Android asks. There is no store listing yet. **Settings › Check for updates** looks for a newer release and offers to download and install it; installing the next release's APK over the old one by hand works too. Your data stays either way. Compare the file with `tablodge.apk.sha256` if you want to check the download. The app saves links and shows your bookmarks and sessions from your [sync server](self-hosting.md); see [Android app](#android-app).

### Build from source

You need Git, Node.js 22.18+ or 24.11+, and the [Vite+ CLI](https://viteplus.dev/).

```sh
git clone https://github.com/bberka/TabLodge.git
cd TabLodge
corepack enable
pnpm install
vp run build
```

Load `apps/extension/dist/tablodge/` with **Load unpacked**, or `apps/extension/dist/tablodge-firefox/manifest.json` as a temporary add-on in Firefox. `vp run pack` makes the release ZIPs under `release/`. To update, run `git pull`, `pnpm install`, and `vp run build`, then reload TabLodge.

## Set up with an AI agent

Paste a prompt into a coding agent (Claude Code, Codex, Cursor) on the machine you are setting up. It follows the linked doc and asks you for anything only you can give, such as a domain or a login.

- **Extension from source:**

  ```text
  Clone https://github.com/bberka/TabLodge.git and follow "Build from source" in docs/README.md. Tell me which folder to load unpacked. Change no source files.
  ```

- **Sync server:** pick one option from docs/self-hosting.md.

  ```text
  Set up the TabLodge sync server (https://github.com/bberka/TabLodge) with Option <A, B, or C> in docs/self-hosting.md. Ask me for anything you need, check /health, then show me the address and token once.
  ```

[Self hosting](self-hosting.md#choose-where-to-run-it) compares the options. Keep the token private.

## Private windows

In Chromium, turn on **Allow in Incognito** for TabLodge. The first private dashboard asks whether private windows use the regular library, a separate saved one, or a separate temporary one that clears when the browser restarts. Change it later in **Settings › Private windows**.

### Lock a separate saved library

A separate saved library can be locked with a PIN (4 to 8 digits) or a password (8 to 128 characters) from **Settings › Private windows** in a private window. TabLodge then encrypts it on this device and shows a lock screen until you enter it. It locks again on **Lock now**, after an idle time, when you lock your screen, and when the last private window or the browser closes. Nothing can recover a lost PIN or password, and a short PIN is easy to guess for someone with a copy of your profile. See [Privacy](PRIVACY.md#private-windows) for details.

## Development

Install the [Vite+ CLI](https://viteplus.dev/) once, run `pnpm install`, then use `vp run <task>` from the repository root.

| Command | What it does |
| --- | --- |
| `vp run dev:chrome` | Build, watch, and open a test browser with TabLodge loaded. `--seed-data` adds sample data and `--headless` opens no window |
| `vp run dev:firefox` | The same in Firefox |
| `vp run check` | Lint, type checks, and tests |
| `vp run check:a11y` | Accessibility and keyboard checks on the built extension. The other `check:` tasks (`build`, `startup`, `firefox`, `dev-browser`, `private-storage`) each test one part of the built extension |
| `vp run build` / `vp run pack` | Build and verify both browsers, then package them |
| `vp run lint:fix` | Fix lint issues and format with XO |
| `pnpm run mobile:start` | Start Metro for the Android app in `apps/mobile/` (needs a development build; see [Android app](android.md)) |
| `pnpm run mobile:apk` | Build a standalone Android APK from this checkout into `apps/extension/dist/tablodge-local.apk`; add `--install` to install it with adb, or `--all-abis` to include 32 bit ARM |
| `pnpm run mobile:icons` | Redraw the Android app's launcher and splash images from the extension's mark (needs `rsvg-convert` and ImageMagick) |
| `pnpm run mobile:export` | Bundle the Android app's JavaScript to check that it builds |
| `pnpm run cf:setup` | Deploy the sync server to Cloudflare (see [Self hosting](self-hosting.md)) |
| `pnpm run cf:bundle` | Rebuild `apps/server/cloudflare-deploy/worker.js` after changing the server or the sync code |

The test browser keeps its own profile in `apps/extension/.dev/`, apart from your regular one. After a rebuild, reload TabLodge on the extensions page. Headless runs (`dev:chrome --headless`, `dev:firefox --headless`) are for automated checks; see [Agent validation](agents/validation.md#browser-access).

Read [Contributing](CONTRIBUTING.md) for conventions, tests, and releases, and [Architecture](architecture.md) for storage, messages, and sync. AI agents also follow [AGENTS.md](../AGENTS.md).

### Android app

`apps/mobile/` holds an Android app, still in development: a small link saver in the style of Raindrop that shows your bookmarks and sessions from your [sync server](self-hosting.md) and saves links from the share sheet. Each [release](https://github.com/bberka/TabLodge/releases/latest) attaches a signed APK (see [Install](#install)). Features, settings, and how to run it are in [Android app](android.md).

### Project structure

```text
apps/extension/   The browser extension (Chrome, Brave, Firefox)
  shell/            Manifest, icons, HTML shells, service worker
  src/app/          Extension pages, data types, and messages
  src/shared/       Shared helpers, library storage, and the sync protocol (src/shared/sync/), also used by the server and the Android app
  src/components/ui/  UI primitives (Radix and Tailwind)
  styles/           Tailwind stylesheet for the extension pages
  scripts/          Build, packaging, dev browser, and accessibility tooling
  tests/            Vitest suites with mocked browser APIs
apps/server/      Self hosted sync server for Docker and Cloudflare (cloudflare-deploy/ is what the Deploy to Cloudflare button copies)
apps/mobile/      Android app (Expo and React Native), in progress
apps/site/        Website for tablodge.bbay.dev (vp run site:dev)
scripts/          Repository wide tooling (release versioning)
tsconfig/         TypeScript settings shared by every app
docs/             All documentation except AGENTS.md
.hooks/           Git hooks that run the checks before commits and pushes
```

## Permissions and privacy

TabLodge has no website host permissions and no content scripts, and makes no network requests unless you turn on sync, which talks only to your server.

| Permission | Why |
| --- | --- |
| `tabs`, `tabGroups` | Save and restore tabs and their groups |
| `bookmarks` | Import browser bookmarks and offer to add new ones |
| `favicon` | Show icons from the browser's own cache (Chromium) |
| `storage`, `unlimitedStorage` | Keep the library on this device |
| `contextMenus` | Save and bookmark from right click menus |
| `clipboardWrite` | Copy links when you ask |
| `sidePanel` | The side panel (Chromium; Firefox uses its sidebar) |
| `search` | **Search the web** with your default engine |
| `alarms` | Snapshots, backups, trash cleanup, archiving, sync, and the private lock |
| `idle` | Lock the private library when you lock your screen |
| `activeTab`, `scripting` | Show the search palette over the current page when you press its shortcut |

Preview cards (**Settings › Preview links on hover**, off by default) need no extra permission: the extension asks the sync server it is already connected to, and the server fetches the page.

`downloads` is optional and requested only for backup copies in `Downloads/TabLodge/`. A web page can tell TabLodge is installed by requesting `palette.html`, which the palette needs. See [Privacy](PRIVACY.md) for everything TabLodge stores and sends.

## Contributing

Bug reports, ideas, and pull requests are welcome. Read [Contributing](CONTRIBUTING.md) first, and open an issue before larger changes.

## License

[MIT](../LICENSE) © 2026 Berkay

