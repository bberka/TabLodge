# Privacy

TabLodge keeps your sessions, bookmarks, and settings in your browser profile. It has no accounts or backend, and does not collect or upload your data.

## What it doesn't do

- No analytics, telemetry, crash reporting, or advertising.
- No cloud sync or sale of data.
- No network requests of its own. Code, styles, fonts, and icons are bundled with the extension.
- No website host permissions and no declared content scripts. TabLodge reads tab metadata through browser APIs, not the contents of web pages. By default the search palette appears over the current page, so the shortcut injects the palette into that one page when you press it. Choosing **Window** in Settings turns this off. The injected code only draws the palette. It reads nothing from the page, and the page cannot read your library.
- A web page can detect that TabLodge is installed by requesting `palette.html`, which the manifest exposes so the palette can be framed over pages. Nothing else of the extension is exposed.

Opening a saved link loads that website normally. An optional setting removes common tracking parameters from the destination URL when opening saved links or restoring sessions and snapshots. It is off by default and does not change the URLs stored in your library. Choosing **Search the web** sends your query to the browser's default search engine. These are actions you request, not background reporting by TabLodge.

## What is stored

Data stays in local extension storage within your browser profile.

| Storage key                                                                | Contents                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tablodge.state`, `tablodge.session.*`, `tablodge.bookmarks.*`             | Saved sessions, titles, URLs, notes, pinned state, tab groups, split view pairs, saved window size and position, folders, bookmarks, columns, settings, and excluded sites. `tablodge.state` is a small index; each session has its own key and the bookmarks share one |
| `tablodge.state.premigration`, `tablodge.migration`                        | For one week after an update that moves the library to this layout, an exact copy of the library as it was; a short progress note while that move is unfinished |
| `uiTheme`, `uiAccent`                                                      | Your system, light, or dark theme choice and your accent color (a preset name, `browser`, or a hex color)                                                                             |
| `tablodge.snapshots`, `tablodge.snapshots.live`, `tablodge.snapshots.meta` | Snapshots of open windows and flags used to detect a possible browser crash                                                                |
| `tablodge.backups`                                                         | Automatic, manual, and safety backups of sessions, bookmarks, and settings                                                                 |
| `tablodge.trash`                                                           | Deleted sessions, saved links, bookmarks, and columns                                                                                      |
| `tablodge.undo`                                                            | Temporary copies used to undo recent actions, kept for up to two minutes                                                                   |

These keys use `chrome.storage.local`. A copy of the theme and accent choices also lives in the extension's `localStorage` under `tablodge.uiTheme` and `tablodge.uiAccent` so pages can apply it before rendering. A temporary flag in `chrome.storage.session` helps ignore bulk browser bookmark imports.

Snapshots contain tab titles, URLs, pinned state, tab groups, split view pairs, the active tab, and window layout information. They skip incognito windows, excluded sites, and pages other than ordinary HTTP or HTTPS websites. Snapshots are enabled by default; you can turn them off in **Settings › Recovery & backups**.

TabLodge reads tab metadata to save and restore sessions, detect duplicates, close duplicate open tabs when you ask, show and search open tabs, show the **Settings › Data › Statistics** summary, and capture recovery snapshots. It reads your browser's bookmark tree only when you ask to import it. If you enable **When you bookmark a page in the browser**, it also watches for newly created bookmarks to offer to add that page, or add it automatically. That setting is off by default. Site icons come from the browser's local favicon cache.

## Retention and deletion

### Private windows

The Firefox version of TabLodge does not run in private windows, so it cannot read or save them, and the rest of this section applies to Chromium browsers only.

Private access requires the browser's **Allow in Incognito** permission. The first private dashboard visit requires a storage choice, also available in **Settings › Private windows**. By default, private windows use the same library as regular windows. Private saves then remain in the shared library after private windows close. New private tabs redirect to the TabLodge dashboard by default; you can turn this off in **Settings › Private windows**.

**Use a separate saved library** stores private data in `chrome.storage.local`. **Use a separate temporary library** stores private data in `chrome.storage.session`, which clears on browser restart, not when the last private window closes or the extension worker stops. Each separate library includes its sessions, bookmarks, preferences, trash, backups, and Undo records under keys prefixed with `tablodge.private.`. The mode, setup completion, and the optional private window accent color are stored in `chrome.storage.local` under `tablodge.private.config`. Light and dark appearance is shared.

Separate libraries start empty. Switching modes does not copy, merge, or delete any library. To erase one, select that mode, open Settings from its private dashboard, and clear its data and recovery copies. Removing the extension deletes all its browser storage. The redirect preference is stored with the private mode and setup preference in `tablodge.private.config`; it does not record private browsing activity. Saved private storage is not encrypted or hidden from someone who can access your browser profile, unless you lock it with a PIN or password (below). Automatic snapshots, automatic backups, and browser bookmark monitoring do not run in private windows, and private windows cannot list, restore, or delete snapshots, even in shared mode. Explicit exports and manual backup downloads can still write private data to disk and are not removed on browser restart.

The saved separate library can also be locked with a PIN or password (see the [README](README.md#lock-a-separate-saved-library)). Every value of the private library is then encrypted with AES-GCM under a random key, and that key is wrapped with your PIN or password through PBKDF2-SHA-256 (at least 600,000 iterations). Storage key names, their sizes, the storage mode, and the lock settings stay readable, and the data is encrypted only on this device. The key sits in `chrome.storage.session`, which the browser keeps in memory and never writes to disk. It is removed when you lock, when the idle time passes, when the last private window has closed, and when the browser closes, reloads, or disables the extension. The browser does not tell TabLodge when the last private window closes, so after that the key stays in memory until a private window opens again. TabLodge then removes it before showing any private data. To find this out it keeps the ids of the private windows that were open in session storage beside the key. The ids are numbers only, and they go when the key does. TabLodge stores no copy of the PIN or password and no hint, so a lost one cannot be recovered. Someone who copies your profile files can try PINs offline, and a 4 to 8 digit PIN does not hold up to that, so choose a password for anything sensitive. Changing the PIN or password wraps the same key again and does not re-encrypt the data. Exports and backups made from an unlocked private library are plain unless you protect a full backup.

Temporary private data also clears if the extension is disabled, reloaded, or updated. This is different from a background worker restart, which keeps browser session storage.

Two temporary coordination keys, `tablodge.lock.normal` and `tablodge.lock.private`, hold only write order numbers and flags in browser session storage. They prevent concurrent saves from overwriting one another and contain no browsing data.

### Saved data

Your saved sessions and bookmarks stay until you delete them. The optional auto-archive setting only moves old sessions into an Archived folder; it never deletes them. Deleted items go to the trash bin for 7, 30, or 90 days, depending on your setting. Snapshots, backups, trash, and Undo records have retention or size limits. You can clear recovery data from **Settings › Recovery & backups**.

Use **Settings › Data** to erase sessions, bookmarks, or both. Erasing data creates a safety backup and offers Undo, so check the backup history too if you want to remove retained copies. After an update that changes how the library is stored, TabLodge keeps a full copy of the old library for seven days and takes a safety backup, so the copy can hold items you deleted soon afterwards. Removing the extension deletes its browser storage.

If you enable **Also save a copy to Downloads**, TabLodge writes backup JSON files to `Downloads/TabLodge/`. It doesn't upload them. Turning the option off or uninstalling the extension doesn't delete files already written there; you must remove those yourself.

Exports are not encrypted unless you choose to protect a full backup. JSON, HTML, CSV, Markdown, and URL list exports, and full backup ZIP files you leave unprotected, may contain sensitive titles, URLs, or notes. The full backup also includes settings, excluded sites, theme and accent, snapshot history, and trash. Keep these files private and remember that a folder you sync through another app may upload them.

When you back up everything, you can protect the file with a PIN or a password. TabLodge then encrypts it on your device with AES-256 in GCM mode, using a key derived from your entry with PBKDF2 (SHA-256, 600,000 iterations) and a random salt and nonce per file. The PIN or password is never stored, sent, or saved as a hint, so a lost one cannot be recovered. A PIN has at most 100 million combinations, so anyone who copies the file can try them all offline; use a password for sensitive data. Encryption protects only the file you export. The automatic backups kept in the extension's storage, the Downloads copies, safety backups, snapshots, and the library itself are not encrypted. Only the full backup ZIP can be protected.

## Permissions

The [README permissions table](README.md#permissions-and-privacy) explains each required permission. TabLodge requests no website access. `activeTab` and `scripting` let the palette shortcut show the palette over the current page, which is the default and can be changed to a window in Settings. Browsers show no install warning for them and no prompt appears when they are used. The Firefox version leaves out `favicon` and `sidePanel`, which only Chromium has, and declares in its manifest that it collects no data.

The only optional permission is `downloads`. The browser asks for it when you turn on backup copies in Downloads. Turning that setting off removes the permission.

## Contact

For questions or concerns, [open an issue on GitHub](https://github.com/bberka/TabLodge/issues). Please leave private URLs, titles, and exported data out of public reports.
