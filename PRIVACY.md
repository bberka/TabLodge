# Privacy

TabLodge keeps your sessions, bookmarks, and settings in your browser profile. It has no accounts or backend, and does not collect or upload your data.

## What it doesn't do

- No analytics, telemetry, crash reporting, or advertising.
- No cloud sync or sale of data.
- No network requests of its own. Code, styles, fonts, and icons are bundled with the extension.
- No website host permissions or content scripts. TabLodge reads tab metadata through browser APIs, not the contents of web pages.

Opening a saved link loads that website normally. An optional setting removes common tracking parameters from the destination URL when opening saved links or restoring sessions and snapshots. It is off by default and does not change the URLs stored in your library. Choosing **Search the web** sends your query to the browser's default search engine. These are actions you request, not background reporting by TabLodge.

## What is stored

Data stays in local extension storage within your browser profile.

| Storage key                                                                | Contents                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tablodge.state`                                                           | Saved sessions, titles, URLs, notes, pinned state, tab groups, split view pairs, folders, bookmarks, columns, settings, and excluded sites |
| `uiTheme`                                                                  | Your system, light, or dark theme choice                                                                                                   |
| `tablodge.snapshots`, `tablodge.snapshots.live`, `tablodge.snapshots.meta` | Snapshots of open windows and flags used to detect a possible browser crash                                                                |
| `tablodge.backups`                                                         | Automatic, manual, and safety backups of sessions, bookmarks, and settings                                                                 |
| `tablodge.trash`                                                           | Deleted sessions, saved links, bookmarks, and columns                                                                                      |
| `tablodge.undo`                                                            | Temporary copies used to undo recent actions, kept for up to two minutes                                                                   |

These keys use `chrome.storage.local`. A copy of the theme choice also lives in the extension's `localStorage` under `tablodge.uiTheme` so pages can apply it before rendering. A temporary flag in `chrome.storage.session` helps ignore bulk browser bookmark imports.

Snapshots contain tab titles, URLs, pinned state, tab groups, split view pairs, the active tab, and window layout information. They skip incognito windows, excluded sites, and pages other than ordinary HTTP or HTTPS websites. Snapshots are enabled by default; you can turn them off in **Settings › Recovery & backups**.

TabLodge reads tab metadata to save and restore sessions, detect duplicates, show and search open tabs, and capture recovery snapshots. It reads your browser's bookmark tree only when you ask to import it. If you enable **When you bookmark a page in the browser**, it also watches for newly created bookmarks to offer to add that page, or add it automatically. That setting is off by default. Site icons come from the browser's local favicon cache.

## Retention and deletion

Your saved sessions and bookmarks stay until you delete them. Deleted items go to the trash bin for 7, 30, or 90 days, depending on your setting. Snapshots, backups, trash, and Undo records have retention or size limits. You can clear recovery data from **Settings › Recovery & backups**.

Use **Settings › Data** to erase sessions, bookmarks, or both. Erasing data creates a safety backup and offers Undo, so check the backup history too if you want to remove retained copies. Removing the extension deletes its browser storage.

If you enable **Also save a copy to Downloads**, TabLodge writes backup JSON files to `Downloads/TabLodge/`. It doesn't upload them. Turning the option off or uninstalling the extension doesn't delete files already written there; you must remove those yourself.

Exports are not encrypted. JSON, HTML, CSV, Markdown, URL lists, and full backup ZIP files may contain sensitive titles, URLs, or notes. The full backup also includes settings, excluded sites, theme, snapshot history, and trash. Keep these files private and remember that a folder you sync through another app may upload them.

## Permissions

The [README permissions table](README.md#permissions-and-privacy) explains each required permission. TabLodge requests no website access.

The only optional permission is `downloads`. The browser asks for it when you turn on backup copies in Downloads. Turning that setting off removes the permission.

## Contact

For questions or concerns, [open an issue on GitHub](https://github.com/bberka/TabLodge/issues). Please leave private URLs, titles, and exported data out of public reports.
