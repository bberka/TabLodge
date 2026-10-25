# Privacy

_Last updated: 2026-10-25_

TabLodge is built to keep your data on your device. In short: **no data leaves your device, and nothing is collected.**

## What TabLodge does not do

- No accounts, servers, or cloud sync. TabLodge has no backend.
- No analytics, telemetry, crash reporting, or advertising.
- No network requests of its own. All code, styles, fonts, and icons are bundled in the extension; nothing is loaded from a CDN.
- No website access. TabLodge requests no host permissions, injects no content scripts, and never reads page contents.
- No sale or sharing of data with anyone.

## What TabLodge stores, and where

Everything is stored locally in your browser profile:

| Storage                                                                                             | Contents                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chrome.storage.local` (`tablodge.state`)                                                           | Your saved sessions (tab titles, URLs, notes, pinned/tab-group/split-view info), folders, bookmark columns and bookmarks, settings, and excluded websites.                                                                                                                                                                     |
| `chrome.storage.local` (`uiTheme`)                                                                  | Your Light/Dark/System appearance choice.                                                                                                                                                                                                                                                                                      |
| The extension's `localStorage` (`tablodge.uiTheme`)                                                 | A copy of the appearance choice, used to paint each page in the right theme before it loads.                                                                                                                                                                                                                                   |
| `chrome.storage.local` (`tablodge.snapshots`, `tablodge.snapshots.live`, `tablodge.snapshots.meta`) | Crash-recovery snapshots: the titles and URLs of your open web tabs per window (pinned state, tab groups, split view, active tab), plus a few flags used to tell whether the last browser run ended cleanly. Excluded sites, incognito windows, and non-web pages are left out. Turn off in **Settings › Recovery & backups**. |
| `chrome.storage.local` (`tablodge.backups`)                                                         | Automatic, manual, and safety backups: full copies of your sessions, bookmarks, and settings in the regular JSON export format.                                                                                                                                                                                                |
| `chrome.storage.local` (`tablodge.trash`)                                                           | Deleted sessions, saved links, bookmarks, columns, and folders, kept for the retention period you choose (7, 30, or 90 days).                                                                                                                                                                                                  |

TabLodge reads tab details (URL, title, pinned state, tab group, window) only when you save a session, check for duplicates, or restore. It reads your browser bookmarks only when you explicitly import them. Site icons come from the browser's own local favicon cache.

Snapshots, backups, and the trash are ordinary local data like everything else: they never leave your device, are capped in number and size, and can be cleared at any time from **Settings › Recovery & backups**. If you turn on **Also save a copy to Downloads**, backups are additionally written as JSON files to `Downloads/TabLodge/` on your computer; those files are yours to keep or delete, and are not uploaded anywhere by TabLodge.

Data stays until you delete it: delete individual items, use **Settings › Data** to erase sessions, bookmarks, or both, or remove the extension (the browser then deletes its storage). Exported JSON and HTML files are plain, unencrypted text that you control; keep them private if their URLs, titles, or notes are sensitive.

When you restore a session or open a bookmark, your browser loads those web pages as usual, and those sites see a normal visit. TabLodge itself sends nothing to them.

## Permissions

| Permission                    | Used for                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`                        | Reading tab URLs, titles, and placement to save sessions; opening tabs to restore them.                                                                                       |
| `tabGroups`                   | Saving and recreating native tab groups.                                                                                                                                      |
| `bookmarks`                   | Importing your browser bookmarks, only when you ask.                                                                                                                          |
| `favicon`                     | Showing site icons from the browser's local cache.                                                                                                                            |
| `storage`, `unlimitedStorage` | Keeping your data in local extension storage without the default size cap.                                                                                                    |
| `contextMenus`                | Optional right-click save and bookmark actions.                                                                                                                               |
| `clipboardWrite`              | Copying bookmark URLs and session links when you ask.                                                                                                                         |
| `sidePanel`                   | The optional bookmark list in the browser's Side Panel.                                                                                                                       |
| `search`                      | Running a web search with your default engine, only when you choose "Search the web".                                                                                         |
| `alarms`                      | Scheduling local snapshots, automatic backups, and trash cleanup.                                                                                                             |
| `downloads` (optional)        | Only if you enable "Also save a copy to Downloads": writing backup files to `Downloads/TabLodge/`. The browser asks first, and turning the option off removes the permission. |

## Contact

Questions or concerns: open an issue on the project's GitHub repository (linked from TabLodge's Help page).
