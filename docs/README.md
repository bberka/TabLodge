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

- **Sessions.** Save tabs, a tab group, a window, or all windows, and restore them with their groups and pinned tabs. Organize sessions in folders, archive old ones, and replace, extend, or split a session from the current window.
- **Bookmark board.** Columns of links on every new tab, in a Board or Focus view, each with its own icon and color. Drag or use the keyboard to reorder, paste lists of links, and find duplicates.
- **Search.** A palette (`Ctrl+Shift+K` on any page, `Ctrl+K` or `/` on the dashboard) and the `tl` address bar keyword find open tabs, bookmarks, saved tabs, and sessions.
- **Import and export.** Bring data from OneTab, Session Buddy, Tab Session Manager, Toby, Raindrop.io, or browser bookmarks. Imports add to what you have and skip links you already saved; a full backup can be added or can replace everything. Export as JSON, HTML, CSV, Markdown, or links, or save a full backup ZIP, optionally protected with a password.
- **Recovery.** Crash snapshots, a trash bin, Undo, and optional automatic backups.
- **Sync with your own server.** Keep the library the same in all your browsers through a server you run yourself, with Docker or on your Cloudflare account. On Cloudflare, a Deploy to Cloudflare button sets it up without installing anything. See [Self hosting](self-hosting.md).
- **Private windows.** Use the regular library or a separate one, optionally locked with a PIN or password. See [Private windows](#private-windows).
- **Popup, dashboard, and side panel**, with light and dark themes and your choice of accent color.

The in app Help page explains every feature and setting.

## Screenshots

<p align="center">
  <img src="../site/src/assets/dashboard-light.webp" alt="TabLodge dashboard with saved sessions above a board of bookmark columns" width="800">
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

In Firefox, TabLodge always replaces the new tab page, the side panel is Firefox's sidebar, saved items show letter tiles instead of site icons, private windows are not supported, and split view tabs reopen as neighboring tabs. See [Browser support](architecture.md#browser-support).

**Android:** Android 7 or newer. Download `tablodge.apk` from the [latest release](https://github.com/bberka/TabLodge/releases/latest), open it on your phone, and allow your browser or file manager to install apps when Android asks. There is no store listing yet, and the app does not update itself: install the next release's APK over the old one, and your data stays. Compare the file with `tablodge.apk.sha256` if you want to check the download. The app saves links and shows your bookmarks and sessions from your [sync server](self-hosting.md); see [Android app](#android-app).

### Build from source

You need Git, Node.js 22.18+ or 24.11+, and the [Vite+ CLI](https://viteplus.dev/).

```sh
git clone https://github.com/bberka/TabLodge.git
cd TabLodge
corepack enable
pnpm install
vp run build
```

Load `dist/tablodge/` with **Load unpacked**, or `dist/tablodge-firefox/manifest.json` as a temporary add-on in Firefox. `vp run pack` makes the release ZIPs under `release/`. To update, run `git pull`, `pnpm install`, and `vp run build`, then reload TabLodge.

## Private windows

In Chromium, turn on **Allow in Incognito** for TabLodge. The first private dashboard asks whether private windows use the regular library, a separate saved one, or a separate temporary one that clears when the browser restarts. Change it later in **Settings › Private windows**.

### Lock a separate saved library

A separate saved library can be locked with a PIN (4 to 8 digits) or a password (8 to 128 characters) from **Settings › Private windows** in a private window. TabLodge then encrypts it on this device and shows a lock screen until you enter it. It locks again on **Lock now**, after an idle time, when you lock your screen, and when the last private window or the browser closes. Nothing can recover a lost PIN or password, and a short PIN is easy to guess for someone with a copy of your profile. See [Privacy](PRIVACY.md#private-windows) for details.

## Development

Install the [Vite+ CLI](https://viteplus.dev/) once, run `pnpm install`, then use `vp run <task>` from the repository root.

| Command | What it does |
| --- | --- |
| `vp run dev:chrome` | Build, watch, and open a test browser with TabLodge loaded (`:seed` adds sample data) |
| `vp run dev:firefox` | The same in Firefox |
| `vp run check` | Lint, type checks, and tests |
| `vp run a11y` | Accessibility and keyboard checks on the built extension |
| `vp run build` / `vp run pack` | Build and verify both browsers, then package them |
| `vp run lint:fix` | Fix lint issues and format with XO |
| `pnpm run mobile:start` | Start Metro for the Android app in `mobile/` (needs a development build; see [Android app](#android-app)) |
| `pnpm run mobile:export` | Bundle the Android app's JavaScript to check that it builds |
| `pnpm run cf:setup` | Deploy the sync server to Cloudflare (see [Self hosting](self-hosting.md)) |
| `pnpm run cf:bundle` | Rebuild `server/cloudflare-deploy/worker.js` after changing the server or the sync code |

The test browser keeps its own profile in `.dev/`, apart from your regular one. After a rebuild, reload TabLodge on the extensions page. Headless variants (`dev:chrome:headless`, `dev:firefox:headless`) are for automated checks; see [Agent validation](agent-validation.md#browser-access).

Read [Contributing](CONTRIBUTING.md) for conventions, tests, and releases, and [Architecture](architecture.md) for storage, messages, and sync. AI agents also follow [AGENTS.md](../AGENTS.md).

### Android app

`mobile/` holds an Android app, still in development. Each [release](https://github.com/bberka/TabLodge/releases/latest) attaches a signed APK (see [Install](#install)), and pull requests that touch the app build a debug APK as a workflow artifact. It is a small link saver in the style of Raindrop:

- Bookmarks: browse columns, search, add links, and tap one to open it. Swipe a row right to open it or left to delete it (with Undo), or long press to select several, then open, move, or delete them together. Selecting one row also offers Edit for its link, title, and column. **Open all** opens every link in a column.
- Share sheet: choose TabLodge from another app's share menu and a drawer slides up with the link and title filled in. When the share started the app, saving returns you to the app you came from.
- Sessions: saved sessions are listed by folder, as in the extension: **All** (without Archived), each folder with its count, and **Archived** last. Tap a tab to open it, or **Open all** for the whole session. A phone browser cannot list its own tabs, so the app cannot capture them. Instead, share several links at once (in Chrome, select tabs in the tab switcher and choose Share tabs; in Firefox, Share all tabs) and a drawer asks whether to save them as bookmarks, as a new session, or into a session that exists.
- Private library: the eye button on Bookmarks and Sessions shows the private windows' library, read only, from the same server. If it has a PIN or password, the app asks for it once and keeps the key in the Android keystore. **Settings › Private library** forgets it on the phone.
- Device names: with sync on, **Settings › Sync** has a Device name (a computer defaults to the browser and system, a phone to its make and model). New sessions record it, and session cards show where each was saved. Each device has its own name, kept on that device; a rename does not change sessions already saved.
- Site icons: an optional switch (off by default). With sync connected, icons are loaded through your server; without it, each icon comes straight from its site. A letter tile shows until an icon arrives or when a site has none.
- Settings sync: with sync on, your settings follow your other devices, including this app's own (look, floating bar, tap and swipe actions, cleaning links on save). It is on by default and **Settings › Sync settings** turns settings sync off for one phone, the same switch the extension has. The app's own settings travel in the library's `mobileApp` setting, which the extension keeps but does not use.
- Session colors: a session can have a color, set in **Session details** in the extension (the same selector as column colors) and with **Change color** in an expanded card on Android (or a long press on the card). The color shows as a line on the top of the card in the extension and tints the card's tile on Android. It syncs with the session.
- Columns: every column selector shows the column's icon and color, and ends with **New column**, which asks for a name, an icon, and a color. The palette icon in the Bookmarks header changes the open column's name, icon, and color, or deletes it (its bookmarks move to another column, or are deleted with it). The color and icon sync with the extension, where a column's color is set in its Edit column dialog with the same selector as the accent color.
- Settings search: the box at the top of Settings filters the cards and rows as you type. It matches a setting's name or its hint, so `swipe`, `tracking`, or `private` find what you mean.
- Behavior: **Settings › Bookmarks** chooses what a tap does (open or edit) and what a swipe right and left do (open, edit, move, delete, or nothing). **Settings › Same as your extension** changes the extension settings that sync: clean titles, tracking parameters, how addresses show, bookmark spacing, and session sorting. Settings that only make sense in a desktop browser (new tab, side panel, context menus, windows, snapshots) are not shown.
- Sync: it connects to your [sync server](self-hosting.md) with the same address and token as the extension, using the shared client in `src/shared/sync/`. While the app is in front, a live connection brings changes in within a second or two. When you leave the app, it first sends any change that is still waiting, then closes that connection and its timers, so it does not keep the radio or the battery busy. When you come back it reconnects and catches up. A change made with no connection is kept and goes out by itself once the server is reachable again. There is no background sync, so changes from other devices show up when you open the app.
- Look: **Settings › Appearance** switches between an Android (Material) and an iOS look, which follows the phone by default, and turns the floating tab bar on or off.

[ADR 3](adr/0003-mobile-app-framework.md) explains the framework choice. The app is not published and is not part of the extension build.

To run it you need JDK 17 or newer and the Android SDK (`ANDROID_HOME` set). `pnpm run mobile:android` builds a development build and installs it on a connected device or emulator, and `pnpm run mobile:start` serves the JavaScript to it. `pnpm run mobile:doctor` checks the Expo setup, and `pnpm run mobile:export` bundles the JavaScript without a device. In a development build, the app starts with the same sample sessions and bookmarks as `dev:chrome:seed` (the fixture in `scripts/dev-fixture.ts`), once, when its library is empty and no server is connected. Set `EXPO_PUBLIC_SEED_DATA=0` to start empty instead. **Settings › Development** can load the samples again or clear the library. Sample data never reaches a server: those buttons are off while a server is connected, and connecting removes the samples first. Release builds do not contain the sample data. The sharing logic is tested in `tests/mobile-library.test.ts` and `tests/mobile-sync.test.ts`.

### Project structure

```text
extension/   Manifest, icons, HTML shells, service worker
styles/      Tailwind stylesheet for the extension pages
src/app/     Extension pages, data types, and messages
src/shared/  Shared helpers, library storage, and the sync protocol (src/shared/sync/)
src/components/ui/  UI primitives (Radix and Tailwind)
server/      Self hosted sync server for Docker and Cloudflare (cloudflare-deploy/ is what the Deploy to Cloudflare button copies)
mobile/      Android app (Expo and React Native), in progress
tests/       Vitest suites with mocked browser APIs
scripts/     Build, packaging, dev browser, and release tooling
site/        Website for tablodge.bbay.dev (vp run site:dev)
docs/        All documentation except AGENTS.md
.vite-hooks/ Git hooks that run the checks before commits and pushes
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
