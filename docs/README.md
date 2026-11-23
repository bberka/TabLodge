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

TabLodge is a browser extension for Chromium browsers and desktop Firefox. Save a window as a named session, close it, and bring it back later. Your new tab page becomes a board of bookmark columns. There are no accounts and no analytics, and your data stays in your browser profile.

## Features

- **Sessions:** save tabs, a tab group, or a window, and restore them with groups and pinned tabs.
- **Bookmark board:** columns of links on every new tab, each with an optional note and tags: the kind of link (movie, video, repo, article, and others) read from its address, plus your own. A tag filter and `tag:` search find them, and links to images, PDFs, and videos get a mark on their icon.
- **Quotes:** select text on a page, right-click, and **Save quote** keeps it in that page's bookmark note with a link back to the passage. The Android app does the same for text shared to it.
- **Search:** one palette for open tabs, bookmarks (notes included), saved tabs, sessions, commands, and Settings sections. Operators such as `"exact phrase"`, `-word`, `site:`, `in:`, and `tag:` narrow it, the dashboard searches, and the Android app's search; Help lists them all.
- **Sources:** when you save something on a site you use, such as YouTube Watch later, a Reddit or Instagram save, an X bookmark, a GitHub star, a Hacker News favorite, a Stack Overflow bookmark, the dev.to reading list, a Lobsters save, a Bluesky save, a SoundCloud like, your Spotify library, a Letterboxd or IMDb watchlist, Goodreads Want to Read, a Medium bookmark, or a Substack save, the same link lands in your bookmarks, in a column you pick. The saved pages of Reddit, YouTube Watch later, X bookmarks, Instagram, and GitHub stars also add saves made elsewhere, unless you choose Ask first in Settings or answered Not now to them before. Off until you add a site in Settings, and it reads only the sites you added. On every site but Medium you can choose Save to TabLodge only, which keeps the save off the site.
- **Import and export:** OneTab, Session Buddy, Toby, Raindrop.io, Linkwarden, Karakeep, Omnivore, wallabag, Pinboard, Mastodon bookmarks, browser bookmarks, and backups.
- **Recovery:** crash snapshots, a trash bin, and Undo.
- **Sync:** keep every browser the same with a server you run yourself ([Self hosting](self-hosting.md)).
- **Private windows:** a separate library, optionally locked, that regular windows can send links to without unlocking it ([Private windows](private-windows.md)).
- **Android app:** your bookmarks and sessions on your phone ([Android app](android.md)).

The in app Help page explains every feature and setting.

<p align="center">
  <img src="../site/src/assets/dashboard-light.webp" alt="TabLodge dashboard with a board of bookmark columns above saved sessions" width="800">
</p>

## Install

- Chrome, Brave, Edge, and other Chromium browsers: [Chrome Web Store](https://chromewebstore.google.com/detail/tablodge-%E2%80%93-tab-session-ma/ekidoclgpdfhpdlidlkcjccgihbndoib)
- Firefox 140 or newer: [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tab-lodge/)
- Android: `tablodge.apk` from the [latest release](https://github.com/bberka/TabLodge/releases/latest)

Manual installs and building from source are in [Install](install.md).

## Set up sync with an AI agent

This sets up the optional sync server, not TabLodge itself. Install TabLodge from the links above. To sync, paste this into a coding agent (Claude Code, Codex, Cursor). It follows [Self hosting](self-hosting.md) and asks you for anything only you can give, such as a domain or a login.

```text
Set up the TabLodge sync server (https://github.com/bberka/TabLodge) with Option <A, B, or C> in docs/self-hosting.md. Ask me for anything you need, check /health, then show me the address and token once.
```

## More

- [Install](install.md): manual installs and building from source
- [Self hosting](self-hosting.md): the sync server
- [Privacy and permissions](PRIVACY.md)
- [Architecture](architecture.md)
- [Contributing](CONTRIBUTING.md): bug reports and pull requests are welcome, so open an issue before larger changes
- [AGENTS.md](../AGENTS.md): rules for AI agents

[MIT](../LICENSE) © 2026 Berkay
