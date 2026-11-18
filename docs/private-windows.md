# Private windows

In Chromium, turn on **Allow in Incognito** for TabLodge. The first private dashboard asks whether private windows use the regular library, a separate saved one, or a separate temporary one that clears when the browser restarts. Change it later in **Settings › Private windows**.

## Lock a separate saved library

A separate saved library always has a PIN (4 to 8 digits) or a password (8 to 128 characters). Private windows ask you to set one before the library opens (when your sync server already holds a private library, the first choice is its PIN or password, which becomes this library's lock and merges the server's data in; **Keep only on this device instead** sets a separate one; with a server that holds no private library yet, the same screen has a **Sync private windows** switch, on by default), and TabLodge encrypts the library on this device and shows a lock screen until you enter it. Change it, or remove it, from **Settings › Private windows** in a private window; after a removal the next private page asks for a new one, or you can switch to another library. It locks again on **Lock now**, after an idle time, when you lock your screen, and when the last private window or the browser closes. Nothing can recover a lost PIN or password, and a short PIN is easy to guess for someone with a copy of your profile. If you forget it, **Erase private data** on the lock screen (and in Settings) deletes the separate private library, its PIN or password, and its sync key from this device, and asks for a new PIN or password. Regular windows and the sync server are not touched, and a library that synced still holds its encrypted copy on the server under the old PIN or password. See [Privacy](PRIVACY.md#private-windows) for details.

## Sources in private windows

Sites are added to and removed from **Settings › Sources** in a regular window. A save on a site you added in Sources, made in a private window, is added only when private windows use the regular library. With a separate library, private windows save nothing from sources.
