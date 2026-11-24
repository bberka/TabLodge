# Private windows

In Chromium, turn on **Allow in Incognito** for TabLodge. The first private dashboard asks whether private windows use the regular library, a separate saved one, or a separate temporary one that clears when the browser restarts. Change it later in **Settings › Private windows**.

## Lock a separate saved library

A separate saved library always has a password, 4 to 128 characters of any kind. While you type, a short or number-only one gets a small note that it is easy to guess; it is still accepted. Private windows ask you to set one before the library opens (when your sync server already holds a private library, the first choice is its password, which becomes this library's lock and merges the server's data in; **Keep only on this device instead** sets a separate one; with a server that holds no private library yet, the same screen has a **Sync private windows** switch, on by default), and TabLodge encrypts the library on this device and shows a lock screen until you enter it. Change it, or remove it, from **Settings › Private windows** in a private window; after a removal the next private page asks for a new one, or you can switch to another library. A 4-digit PIN an older version accepted is just a short password now: it keeps opening what it protected. Update every browser and phone you sync before you choose a password of 4 to 7 characters: an older build cannot set or join a lock with one, though it keeps opening locks that already exist. It locks again on **Lock now**, after an idle time, when you lock your screen, and when the last private window or the browser closes. Nothing can recover a lost password, and a short or number-only password is easy to guess for someone with a copy of your profile. If you forget it, **Erase private data** on the lock screen (and in Settings) deletes the separate private library, its password, and its sync key from this device, and asks for a new password. Regular windows and the sync server are not touched, and a library that synced still holds its encrypted copy on the server under the old password. See [Privacy](PRIVACY.md#private-windows) for details.

## Send links to private storage

With a separate saved library, the menu of a link in a session or a bookmark column, and the bar above selected links, offer **Send to private storage** in regular windows. The link leaves the regular library and lands in the private library's **Sent from regular windows** column with its title, address, note, and tags. A saved tab's pinned state, tab group, and split view are not kept, and a session left with no links goes too. The regular library drops it without the trash, because the trash syncs: other devices see only a delete.

The private library does not have to be unlocked. The regular window encrypts the link to the private library's public key, so only the private library can read it, and it waits on this device until a private window unlocks the library. It then syncs with the private library if that syncs. **Undo** in the toast brings the link back until the toast closes. A library set up before this version has to be unlocked once in a private window before regular windows can send to it. Snapshots and backups taken before the send still hold the link, and **Erase private data** also drops links still on their way. The Android app has the same action; see [Android app](android.md).

## Send a whole column or session

The menu of a bookmark column and the menu of a session offer **Send to private storage** under the same conditions as a link, and an empty column offers nothing. One send is one action with one toast and one **Undo**, however many links it holds, up to 20,000.

- **A column** keeps its name, color, icon, bookmark order, notes, and tags. When the private library has a column with that name, ignoring case, the bookmarks are added to it; a bookmark identical to one already there (same address, title, note, and tags) is not added again. Otherwise the column is new. The column and its bookmarks leave the regular library without the trash.
- **A column with a site source**, such as the column YouTube saves into or one you picked under **Settings › Sources**, sends its bookmarks and stays in the regular library, empty, with its source on. The toast says so. On the phone only the sites' own columns count, because the phone has no Sources settings.
- **A session** keeps its name, the order of its links, its saved date, its color, and its description, and arrives in the private library outside any folder. A saved tab's pinned state, tab group, and split view are not kept.

A column or session is sealed in the same kind of entry as links, in a newer payload version. A build older than this one keeps such an entry without opening or deleting it, and takes it in once it is updated. Entries for single links are unchanged.

## Sources in private windows

Sites are added to and removed from **Settings › Sources** in a regular window. A save on a site you added in Sources, made in a private window, is added only when private windows use the regular library. With a separate library, private windows save nothing from sources, and a site set to **Save to TabLodge only** saves on the site as usual there.
