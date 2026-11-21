# Privacy

TabLodge keeps your sessions, bookmarks, and settings in your browser profile. It has no accounts or backend, and does not collect your data. It uploads your library only to a sync server you run yourself, and only after you connect one.

## What it doesn't do

- No analytics, telemetry, crash reporting, or advertising.
- No classifier and no lookups for tags. A bookmark's automatic tag (movie, video, repo, and so on) is worked out on the device from its address alone; only the tags you type and the automatic tags you remove are stored.
- No TabLodge cloud and no sale of data. There is no TabLodge operated sync service.
- No network requests of its own unless you turn on sync (see [Sync with your own server](#sync-with-your-own-server)) or ask for one with **Import › From a link** (see Shared pages below). Code, styles, fonts, and icons are bundled with the extension.
- No website access until you add a site in **Settings › Sources**, and no declared content scripts. To save sessions and bookmarks, TabLodge reads tab metadata through browser APIs, not the contents of web pages. A source reads only the site you added (see [Sources](#sources)). By default the search palette appears over the current page, so the shortcut injects the palette into that one page when you press it. Choosing **Window** in Settings turns this off. The injected code only draws the palette. It reads nothing from the page, and the page cannot read your library. Apart from Sources, **Keep a copy** is the one action that reads a page: when you choose it from the toolbar popup, the page's right-click menu, the side panel, or the search palette shown over that page, TabLodge reads the text of that one open tab once (see [Page copies](#page-copies)). **Save quote** in the right-click menu on selected text reads nothing from the page: the browser hands TabLodge the selected text and the page address, and the code injected into that one page only shows the confirmation.
- A web page can detect that TabLodge is installed by requesting `palette.html`, which the manifest exposes so the palette can be framed over pages. Nothing else of the extension is exposed. On a site you added in **Settings › Sources**, that site's page can also see the notice TabLodge shows after a save, or on the site's saved page.

Opening a saved link loads that website normally. An optional setting removes common tracking parameters from the destination URL when opening saved links or restoring sessions and snapshots. It is off by default and does not change the URLs stored in your library. Choosing **Search the web** sends your query to the browser's default search engine. Choosing **Open in Internet Archive** on a saved link opens the Internet Archive's page for that address (`web.archive.org/web/<address>`) in a new tab, so the address goes to archive.org when you choose it and TabLodge sends and stores nothing else; with the tracking parameter setting on, those parameters are removed first. In **Settings › Sync**, **Generate token** makes the token in the browser without any request, and **Deploy to Cloudflare** opens Cloudflare's page in a new tab. These are actions you request, not background reporting by TabLodge.

## What is stored

Data stays in local extension storage within your browser profile.

| Storage key                                                                | Contents                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tablodge.state`, `tablodge.session.*`, `tablodge.bookmarks.*`             | Saved sessions, titles, URLs, notes, pinned state, tab groups, split view pairs, saved window size and position, folders, bookmarks with their notes and tags, columns, settings, and excluded sites. `tablodge.state` is a small index; each session has its own key and the bookmarks share one |
| `tablodge.state.premigration`, `tablodge.migration`                        | For one week after an update that moves the library to this layout, an exact copy of the library as it was; a short progress note while that move is unfinished |
| `uiTheme`, `uiAccent`                                                      | Your system, light, or dark theme choice and your accent color (a preset name, `browser`, or a hex color)                                                                             |
| `tablodge.snapshots`, `tablodge.snapshots.live`, `tablodge.snapshots.meta` | Snapshots of open windows and flags used to detect a possible browser crash                                                                |
| `tablodge.backups`                                                         | Automatic, manual, and safety backups of sessions, bookmarks, and settings                                                                 |
| `tablodge.trash`                                                           | Deleted sessions, saved links, bookmarks, and columns, which sync when a server is connected                                                                                   |
| `tablodge.undo`                                                            | Temporary copies used to undo recent actions, kept for up to two minutes                                                                   |
| `tablodge.copies`, `tablodge.copy.*`                                       | Readable copies of pages you chose **Keep a copy** for: the page's address, title, author when the page names one, the time it was kept, and its text as headings, paragraphs, list items, quotes, and code. `tablodge.copies` lists them; each copy has its own key |
| `tablodge.sources`                                                         | Which sites in **Settings › Sources** are added, the column each saves to, and its save mode, which sync with your own server (see [Sources](#sources)). Also, for this browser only: whether each site runs here, whether it was turned off because the browser removed its access or saved nothing because its page could not be read, and whether the bookmarks page already said it is on in another browser |
| `tablodge.sourceCatchUp`                                                   | For each site in **Settings › Sources** that has a saved page TabLodge reads, the addresses you answered **Not now** to, so the offer to add them comes back only for something new. **Remove** clears them. It stays on this device and never syncs |

These keys use `chrome.storage.local`. A copy of the theme and accent choices also lives in the extension's `localStorage` under `tablodge.uiTheme` and `tablodge.uiAccent` so pages can apply it before rendering. The same `localStorage` holds `tablodge.focusHintDismissed`, a flag set when you dismiss the suggestion to use Focus view. In `chrome.storage.session`, a temporary flag helps ignore bulk browser bookmark imports, and `newTabClaims` holds the ids of new tabs being sent on to another page while the TabLodge new tab page is off.

Snapshots contain tab titles, URLs, pinned state, tab groups, split view pairs, the active tab, and window layout information. They skip incognito windows, excluded sites, and pages other than ordinary HTTP or HTTPS websites. Snapshots are enabled by default; you can turn them off in **Settings › Recovery & backups**.

TabLodge reads tab metadata to save and restore sessions, detect duplicates, close duplicate open tabs when you ask, show and search open tabs, show the **Settings › Data › Statistics** summary, and capture recovery snapshots. It reads your browser's bookmark tree only when you ask to import it. If you enable **When you bookmark a page in the browser**, it also watches for newly created bookmarks to offer to add that page, or add it automatically. That setting is off by default. The **Bookmark … to** items in the right-click menus of an image, a video, or audio read only the media's address (or, for a stream with no address of its own, the page's address and title) when you choose one, and never download anything. The marks on links to images, PDFs, and videos are read from the saved address, so they fetch nothing. Site icons come from the browser's local favicon cache. Firefox gives extensions no such cache, so there TabLodge shows an open tab's own icon where the browser provides one, and remembers the icon address of each site you open, as a small image, by host, on this device only (up to 300 sites, never from private windows), to show it for saved links to that site. Showing it asks no site for anything. With a sync server connected, icons the browser does not have come from your server (see [Icons and previews](#sync-with-your-own-server)). Any other site gets a letter tile, or on Chromium the browser's default icon.

## Sources

**Settings › Sources** can save a link to TabLodge when you save it on a site. No site is on until you add it with **Add a site**. Adding one asks the browser for access to that site only, as an optional permission; nothing is asked at install, and TabLodge runs nothing on the site before you allow it. Only then does TabLodge register its script for that site. **Remove** takes the site out of the list, removes the script, and gives the permission back. Removing the site's access in the browser's extension settings also turns it off in that browser, and Settings says so next to the site.

With your own sync server connected, the list of added sites, each one's column, and its save mode sync to your other browsers, through that server only. The browser's permission does not: another browser shows such a site as **On in another browser** until you click **Turn on** there and allow access, and a browser that already allows the site turns it on by itself. **Remove** in one browser turns the site off in all of them and gives the permission back in each.

The script reads the page when you click, and only acts on a click on the site's own save control. On the site's own saved page, for the sites listed below as reading it, it also reads the list of saved items the page shows and counts those not in TabLodge. If any are missing, a notice offers **Add them** and **Not now**; nothing is added until you choose **Add them**. It never clicks anything there or unsaves anything. It never sends a request to the site or anywhere else and never reads the site's network traffic. It leaves the site's own save alone, unless you set the site to **Save to TabLodge only** (every site but Medium offers it): then it stops that one click before the site sees it, so the site never learns of the save, and the item goes only into your library. It blocks no requests, hides nothing on the site, and doesn't stop the site learning from anything else you do there. If TabLodge can't read or save the item, the click goes on to the site. The link goes into your library like any other bookmark, so it syncs only if you connected your own server. In a private window, a save is added only when private windows use the regular library.

### YouTube Watch later

Access: `https://www.youtube.com/*`. When you add a video to Watch later, by the button on a thumbnail, **Save to Watch later** in a video's menu, or the Watch later box in the **Save** dialog, TabLodge reads that video's address and title from the page and bookmarks `https://www.youtube.com/watch?v=<id>` in a YouTube column. On your Watch later playlist (`/playlist?list=WL`), TabLodge reads the address and title of each video the page has loaded, to count those not in TabLodge and add them when you choose **Add them**. Nothing else on the page is read or kept.

### Reddit saved

Access: `https://www.reddit.com/*` and `https://old.reddit.com/*`. When you click **Save** on a post or comment, TabLodge reads its permalink and the post title or the comment's author from the page and bookmarks `https://www.reddit.com/<permalink>` in a Reddit column. On your saved page (`/user/<name>/saved/`, new and old Reddit), TabLodge reads the permalink and title of each saved post the page has loaded, and on old Reddit each saved comment's permalink and author, to count those not in TabLodge and add them when you choose **Add them**. Nothing else on the page is read or kept.

### X bookmarks

Access: `https://x.com/*` and `https://twitter.com/*`. When you click **Bookmark** on a post, in its row of buttons or in its **Share** menu, TabLodge reads the post's address and the start of its text from the page and bookmarks `https://x.com/<user>/status/<id>` in an X column. On your bookmarks page (`/i/bookmarks`, which X shows at `/i/history`), TabLodge reads the address and the start of the text of each bookmarked post the page holds, to count those not in TabLodge and add them when you choose **Add them**. Nothing else on the page is read or kept.

### Instagram saved

Access: `https://www.instagram.com/*`. When you tap **Save** on a post or reel, TabLodge reads its address and the start of its caption from the page and bookmarks `https://www.instagram.com/p/<id>/` (a reel too, since Instagram opens it at that address) in an Instagram column. On your saved page (**All posts** or a collection under `/<user>/saved/`), TabLodge reads the address and the start of the caption of each saved post the page has loaded, to count those not in TabLodge and add them when you choose **Add them**. It only notices your own taps: it never scrolls, opens, or clicks anything on Instagram. Nothing else on the page is read or kept.

### GitHub stars

Access: `https://github.com/*`. When you click **Star** on a repository, on its page or in a list such as search results or Trending, TabLodge reads the repository's name and description from the page and bookmarks `https://github.com/<owner>/<repo>` in a GitHub column, titled with the name and the description. On your own stars (`/stars`, `/stars/<you>`, or your profile's Stars tab), TabLodge reads the name and description of each starred repository the page lists, and the signed-in user's name to tell your stars from someone else's, to count those not in TabLodge and add them when you choose **Add them**. Nothing else on the page is read or kept.

### Hacker News favorites

Access: `https://news.ycombinator.com/*`. When you click **favorite** on a story, TabLodge reads the story's title, the address it links to, and its Hacker News page from the page. It bookmarks the linked address in a Hacker News column, with `https://news.ycombinator.com/item?id=<id>` in the bookmark's note. An Ask HN or other text post has no link of its own, so its Hacker News page is bookmarked. Favorites on comments are not saved. Nothing else on the page is read or kept.

### Stack Overflow bookmarks

Access: `https://stackoverflow.com/*`. When you click the bookmark button on a question, TabLodge reads the question's address and title from the page and bookmarks `https://stackoverflow.com/questions/<id>/<slug>` in a Stack Overflow column. Bookmarks on answers and on other Stack Exchange sites are not saved. Nothing else on the page is read or kept.

### dev.to reading list

Access: `https://dev.to/*`. When you click **Save** on an article, on its page or in a feed, TabLodge reads the article's address and title from the page and bookmarks `https://dev.to/<author>/<slug>` in a dev.to column. Nothing else on the page is read or kept.

### Lobsters saved

Access: `https://lobste.rs/*`. When you click **save** on a story, TabLodge reads the story's title, the address it links to, and its Lobsters page from the page. It bookmarks the linked address in a Lobsters column, with `https://lobste.rs/s/<id>/<slug>` in the bookmark's note; a text post with no link of its own is bookmarked at its Lobsters page. Nothing else on the page is read or kept.

### Bluesky saved posts

Access: `https://bsky.app/*`. When you save a post, with its bookmark button or the item in its **...** menu, TabLodge reads the post's address and the start of its text from the page and bookmarks `https://bsky.app/profile/<handle>/post/<id>` in a Bluesky column. Nothing else on the page is read or kept.

### SoundCloud likes

Access: `https://soundcloud.com/*` and `https://m.soundcloud.com/*`. When you click **Like** on a track or playlist, TabLodge reads its address and title from the page and bookmarks `https://soundcloud.com/<artist>/<track>` (or `.../sets/<name>`) in a SoundCloud column. Nothing else on the page is read or kept.

### Spotify library

Access: `https://open.spotify.com/*`. When you save a song, album, playlist, show, or episode to Your Library in the web player, TabLodge reads its address and name from the page and bookmarks `https://open.spotify.com/<kind>/<id>` in a Spotify column. Nothing else on the page is read or kept.

### Letterboxd watchlist

Access: `https://letterboxd.com/*`. When you add a film to your watchlist, on its page or from a poster's menu, TabLodge reads the film's address and title from the page and bookmarks `https://letterboxd.com/film/<slug>/` in a Letterboxd column. Nothing else on the page is read or kept.

### IMDb watchlist

Access: `https://www.imdb.com/*` and `https://m.imdb.com/*`. When you add a film or show to your watchlist, on its page or from a poster, TabLodge reads its address and title from the page and bookmarks `https://www.imdb.com/title/<id>/` in an IMDb column. Nothing else on the page is read or kept.

### Goodreads Want to Read

Access: `https://www.goodreads.com/*`. When you mark a book **Want to Read**, TabLodge reads the book's address and title from the page and bookmarks `https://www.goodreads.com/book/show/<id>` in a Goodreads column. Other shelves are not saved. Nothing else on the page is read or kept.

### Medium reading list

Access: `https://medium.com/*` and `https://*.medium.com/*`, which covers publications at medium.com addresses. Publications on their own domains are not covered. When you click the bookmark on a story, TabLodge reads the story's address and title from the page and bookmarks `https://medium.com/p/<id>` in a Medium column. Nothing else on the page is read or kept.

### Substack saved

Access: `https://substack.com/*` and `https://*.substack.com/*`, which covers publications at substack.com addresses. Publications on their own domains are not covered. When you click **Save** on a post, TabLodge reads the post's address and title from the page and bookmarks it in a Substack column. Nothing else on the page is read or kept.

## Sync with your own server

Sync is off until you enter a server address and token in **Settings › Sync**. The server is one you run yourself ([Self hosting](self-hosting.md)); TabLodge runs no server of its own and receives nothing.

- **What is sent.** Sessions (name, folder, description, dates, and the name of the window they were saved from), saved tabs (title, URL, notes, pinned state, tab group, split view pair), folders, bookmark columns, bookmarks with their notes and tags (notes only to a server that lists `notes` among its features, tags only to one that lists `tags`; an older one never receives them), the trash bin (each deleted item with the data needed to put it back, so what you delete on one device can be restored on another; an item larger than about 200 KB stays where it was deleted, and a server that is not up to date does not receive the trash), the sites you added in **Settings › Sources** with their column and save mode (only to a server that lists `sources` among its features), and your settings (all but recovery snapshots, automatic backups, and browser bookmark monitoring, unless you turn **Sync settings** off, and including, as one entry the extension never reads, the Android app's look and gesture settings, each with the time it was last changed), each with a time stamp and a random id for this browser. Deletes are sent so other devices remove the item too.
- **Device names.** Each session and each bookmark records the name of the device that saved it (the name set in **Settings › Sync**, or by default the browser and system, or the phone's make and model) and whether that is a computer or a phone. It travels with the session or bookmark like the rest of its data, including exports and backups, but not into a shared page. The name you set for a device stays on that device. Renaming it does not change what was already saved.
- **What stays here.** Page copies, recovery snapshots, automatic and safety backups, the id of the window a session was saved from, that window's size and position, when the session was last opened, the settings in [What stays on each device](#what-stays-on-each-device), and a separate private library unless you turn on its sync (below). Every other setting is sent while **Settings › Sync › Sync settings** is on; the ones added since 0.3.0 only to a server that lists `settings` among its features.
- **How it travels.** HTTPS to the address you enter (plain HTTP only to `localhost`, `127.0.0.1`, or `[::1]`), with the token in each request. The server stores the library in plain text, not encrypted end to end, so whoever runs it can read your URLs, titles, and notes.
- **What this browser keeps.** The server address and token, the sync position, and a list of what it last agreed with the server, in extension storage under `tablodge.sync.config`, `tablodge.sync.state`, and `tablodge.sync.status`. The status includes what the server reports about itself (protocol, version, and features), and `tablodge.sync.dismissed` remembers the server version and missing features of a banner you dismissed, so it stays hidden until they change. The token is stored there in plain text, like the rest of the library. A private window that saves to the shared library writes a time stamp to `tablodge.sync.nudge` so the regular worker sends the change at once.
- **Preview when saving (on by default, Android).** While you save a link, the app shows the page's icon and fills in its title. **Preview links when saving** turns it off, and the choice syncs with your other phones. With a server connected, the server fetches the page, so the site sees your server and not your device. Without one, the phone fetches the page and its `/favicon.ico` itself, so that one site sees your IP address and the address you are saving. Only the link in the save drawer is asked for, once you stop typing, and nothing is stored.
- **Icons and previews.** The Android app's **Site icons** has three choices, and the default is **Through my server**: with a server connected, the app asks it for the icon of each site that is on screen, and the server fetches it, so the site sees your server and never your device. **From the sites too** also lets a phone without a server load `https://<site>/favicon.ico` itself, which shows your IP address and the site name to that site, and **Off** shows letter tiles. The extension's **Site icons** works the same way with two choices, also **Through my server** by default, and with **Sync settings** on the choice follows your library to your other browsers: with a server connected, it asks the server for the icon of a site on screen that the browser has no icon for, sending only the host name. It keeps each icon, or for a day the fact that the server has none, by host in `tablodge.siteIcons` and `tablodge.siteIcons.missing` on this device (up to 300 sites each), so a site is asked for once and its icon shows offline. **Browser only** shows just the browser's own icons, and without a server nothing is asked. Private windows ask only when they use the regular library. The extension never asks a site for its icon. The extension's **Preview links on hover** is a separate switch, off by default, that syncs like the other settings: with a server it asks for a page's title, description, and image the same way. Nothing is asked for a site that is not on screen, and nothing is stored on the server beyond a day's memory cache.
- **Shared pages, public by your choice.** This is the one way TabLodge puts data in front of people you did not pick. Nothing is uploaded until you choose **Get a link** in **Share › HTML page**, in the extension or the Android app. Then the page that **Share** would otherwise save as a file (its title, the date, the column or session names, descriptions, link titles and addresses, save dates, and pinned and tab group labels, shown on the page and repeated as data inside it for import) goes to your server, which serves it without the token to anyone who has its link. A server new enough to list `shared-page-import` also keeps an id of the one column or session the page came from, so that column's or session's **Share** can list its links. A page made from several columns or sessions, or kept by an older server, has none; it is listed only in **Shared pages**. The page loads nothing from anywhere: site icons on it are letters, not images. The link holds 22 random characters, so it cannot be guessed, but whoever has it can open the page, keep a copy, and pass the link on. The server keeps the page until you delete it in **Settings › Sync › Shared pages**, and it sends no referrer, so sites opened from the page do not learn its address. Visitors' requests reach your server, which sees their IP addresses like any web server.
- **Import from a link.** When you paste a shared page's address into **Import › From a link**, or open one with **Add this shared page** or the page's **Open in the TabLodge app** button, the app fetches that address once, from your device, with no token or cookies, and reads its links into the import preview. If the address redirects, the app follows it, so each server along the way sees your IP address too. A link another app or page hands to the Android app (`tablodge://import?url=`) is fetched without a tap only when its address has the shared page form (`…/p/` and a 22-character id); any other address waits in the field for **Read link**. The server that holds the page, which may be someone else's, sees your IP address. Nothing is saved until you choose **Import**. The extension's toolbar popup checks the active tab's address, which it already reads, to offer **Add this shared page** on a page whose address looks like one; it sends nothing until you choose it. Private windows and the Android app's private library never upload a page: the option does not appear there. TabLodge keeps nothing about shared pages on the device; the list comes from the server.
- **Stopping.** **Disconnect** removes those keys and stops all requests. Site icons already kept on this device stay. The library on this device stays as it is. Data already on the server stays there until you delete it on the server.
- **Before the first sync,** TabLodge takes a safety backup if the server has data to bring in.
- **Private windows.** When private windows use the regular library, their changes are part of it and sync with it. A separate saved private library syncs only after you turn on **Sync private windows** from Settings in a private window, and then goes to the same server as a second library. Every item is encrypted in the browser (AES-GCM) with a random key, and the server keeps that key only wrapped with the library's password (PBKDF2, the same as the lock), so it cannot read the items. It can still see how many there are and when they change, and a short or number-only password can be guessed by whoever holds the server's data. A separate saved library always has a password, and it is the one secret for the lock and the server: changing it rewraps the server's key before the change is accepted. A temporary private library never syncs. Turning private sync off stops it and removes the key from this browser; what is on the server stays there.

### Android app

The Android app in `apps/mobile/` (in development) uses the same sync and sends the same data to the same server, and nothing to anyone else except the update check described below and a shared page you import from a link. It keeps the server token in the Android keystore (through `expo-secure-store`) and the library on the phone in an app private SQLite database. When you dismiss the banner about a sync server that lacks features, the app keeps that server's version and missing features there too, so the banner stays hidden until they change; this never syncs. It never reads other apps or your browser. It asks Android which browsers are installed so Settings and **Open in…** can list them, and for **Open with…** which apps can open that one link; those lists stay on the phone. If you set up the private library on the phone, it keeps that library in the same private database and, when you give it a password, only a copy of its random data key wrapped by that password. The unwrapped key lives in memory while the library is open and is forgotten by Lock now or when the app closes. The private library is stored on the phone unsealed, so its password controls access in the app and on the server, not the file on the phone. With a server connected, the private library syncs to the server's separate private library with every value sealed by that key; the server sees which records exist and when they change, not what they hold. A library an older version left without a password keeps its data key in the Android keystore until a password is set or the library is erased. Delete from this phone removes it from the phone, with its lock, its key, and the safety copy a restore leaves. Restoring a backup keeps a copy of the library it replaces in the app's private storage until the next restore, so Undo can bring it back; that copy is as unsealed as the library. It reads a file only when you pick one to import or restore, or share one to TabLodge from another app, and writes one only when you export or share, handing it to the app you choose in Android's share sheet; the app has no other storage access. It sees a link only when you type it, paste it, import it, or share it to TabLodge from another app, or when you tap the **Save link** Quick Settings tile, which reads the clipboard once to fill the save drawer. For a shared file, the share library copies it into the app's cache. An export file or a backup is read once into the import preview or Restore, which keep nothing until you confirm, and the copy is deleted straight away. TabLodge also appears in the share menu for images and files of unknown type, so it can say it cannot use them; it deletes those copies without reading them. The Quick Settings tiles and launcher shortcuts store nothing and make no network requests. While a server is connected and **Settings › Sync › Sync in the background** is on (the default), Android's WorkManager runs one sync with that server about every 15 minutes, also with the app closed, sending and receiving the same data as when the app is open; the private library is not part of it. To schedule that work, Android's WorkManager library adds the permissions to run after a restart, to check for a network, to keep the phone awake while the work runs, and to run a foreground service, which WorkManager uses on its own; TabLodge's code holds no wake lock. Turning the setting off or disconnecting cancels it. For the Bookmarks home screen widget, the app keeps a copy of the regular library's bookmark columns and its All list (names, and up to 50 links each with title and address) and your **Open links** choice in `widgets/bookmarks.json` in its private files, and which column each placed widget shows in its private preferences. The private library is never copied there. The copy is rewritten when the regular library changes, including after a background sync, deleted when the library has no bookmarks left (so **Erase** removes it), and removed with the app; the widget reads only that file and makes no network requests. Deleted sessions, links, bookmarks, columns, and folders are kept in a trash in the same private database, for the retention period set in the extension's settings (7, 30, or 90 days, 30 by default), and are removed then, or sooner when you delete them for good or empty the trash. They sync with the server like the rest of the library, so an item deleted on another device can be restored here and the other way round. The private library has its own separate trash, which syncs only with the private library, is listed only while that library is open, and is removed with it. Erase does not use the trash. Disconnect removes the token and the sync position and leaves the library and the trash on the phone. Page copies you keep are stored in the same private database and never leave the phone except in a backup you make; [Page copies](#page-copies) says how the page is fetched. **Check for updates** in Settings is a request you make: it asks `api.github.com` for TabLodge's latest release, at most once an hour, so GitHub sees your IP address, and sends no library data. **Download and install** then fetches `tablodge.apk` from the release on github.com and gives it to Android's installer. The app declares Android's permission to request app installs for that one file, and Android asks you to allow it. Nothing checks in the background.

### Page copies

**Keep a copy** saves the readable text of a page on this device, so you can read it after the page changes or disappears. In the extension it reads the open tab when you choose it from the toolbar popup, the page's right-click menu, a saved link's menu in the side panel while TabLodge may read that tab, or **Keep a copy of this page** in the search palette over that page (the shortcut that opened the palette grants access to that tab). It uses the `activeTab` and `scripting` permissions, so it reads only the tab you chose, only when you choose it, and asks for no website access. If the page is not saved yet, it is bookmarked so the copy has a link. On Android, **Keep a copy** on a saved link's menu fetches the page: with a server connected, the server fetches it (`/v1/page-source`) and passes the page on without storing it, so the site sees your server and not your phone; without a server, or with a server too old to have that route, the phone fetches it itself, so that site sees your IP address. The phone cannot copy a page that needs a sign-in.

A copy is text only: no images, scripts, styles, or links from the page, and it is never shown as HTML. Copies stay on the device that made them and never sync. They are kept for the regular library only, never from a private window, and never for the phone's private library. Each copy holds up to 1 MB of text and a device up to 25 MB of copies; when either limit is reached, TabLodge says so and keeps nothing. A copy belongs to its link's address: it goes to the trash with the link, comes back when you restore the link, and is deleted when the trash is emptied or purged, or when no saved link has that address any more (editing a link's address drops its copy). **Delete copy** in the reader removes one without touching the link. A full backup ZIP includes the copies in `copies.json`.

## What stays on each device

Every setting syncs while **Settings › Sync › Sync settings** is on, in the extension and in the Android app, except the ones below. Each one stays on its device for the reason given. The list lives in the code in `apps/extension/src/shared/local-settings.ts`, and a test fails when a setting stays local without being listed here. A setting added later syncs unless it joins this list with its reason.

The extension:

| Setting | Stored in | Why it stays |
| --- | --- | --- |
| Theme and accent | `uiTheme`, `uiAccent`, with copies in `tablodge.uiTheme` and `tablodge.uiAccent` | Theme and appearance: each device keeps its own |
| Private window accent | `tablodge.privateAccent`, `tablodge.private.config` | Theme and appearance |
| Device name | `tablodge.device` | It names this device on the sessions it saves |
| Sync server address and token, and the **Sync settings** switch | `tablodge.sync.config`, `tablodge.sync.settings` | They connect this device and decide what it takes |
| Private storage mode, its setup, and its new tab redirect | `tablodge.private.config` | They follow this browser's private library |
| Private library password lock and its wait before locking | `tablodge.private.lock` | It protects this browser's private library |
| **Copy backups to Downloads** | `autoBackupToDownloads` in the library's settings | It needs the optional `downloads` permission, which only a click in that browser can grant |
| Whether a **Settings › Sources** site runs here | `tablodge.sources` | It follows the site access this browser granted; the site choices themselves sync |
| **Not now** answers about a Sources saved page | `tablodge.sourceCatchUp` | A dismissal on this device |
| A dismissed banner about missing server features | `tablodge.sync.dismissed` | A dismissal on this device |
| The Focus view and session folder hints | `tablodge.focusHintDismissed`, `tablodge.sessionFolderHintDismissed` | Per-screen hints dismissed on this device |
| Keyboard shortcuts | The browser's own shortcut settings | The browser keeps them, not TabLodge |

The Android app (its own preferences, separate from the extension's):

| Setting | Key | Why it stays |
| --- | --- | --- |
| Look, theme, accent, floating bar, bar size, bar labels, glass effect | `look`, `theme`, `accent`, `floatingBar`, `barSize`, `barLabels`, `glassEffect` | Theme and appearance: each device keeps its own, and the glass effect depends on what the phone can draw |
| Device name | `deviceName` | It names this phone on the sessions it saves |
| **Sync settings** | `syncSettings` | It decides what this phone takes |
| Private library sync, its button, and when it locks | `syncPrivate`, `showPrivateButton`, `privateLockMode`, `privateLockMinutes` | They follow this phone's private library |
| **Sync in the background** | `backgroundSync` | It uses this phone's battery |
| Where links open | `openWith`, `openApp`, `privateOpenWith`, `privateOpenApp` | They name browsers installed on this phone |
| The column offered first when saving | `lastColumnId` | What this phone saved to last, not a choice |
| Which column each home screen widget shows | The widget's Android preferences | Each placed widget is on this phone |

Settings that a newer version of either app syncs and this one does not know yet are kept as they arrived, in `heldSettings` in the library's settings, so they go back unchanged.

## Retention and deletion

### Private windows

The Firefox version of TabLodge does not run in private windows, so it cannot read or save them, and the rest of this section applies to Chromium browsers only.

Private access requires the browser's **Allow in Incognito** permission. The first private dashboard visit requires a storage choice, also available in **Settings › Private windows**. By default, private windows use the same library as regular windows. Private saves then remain in the shared library after private windows close. New private tabs redirect to the TabLodge dashboard by default; you can turn this off in **Settings › Private windows**.

**Use a separate saved library** stores private data in `chrome.storage.local`. **Use a separate temporary library** stores private data in `chrome.storage.session`, which clears on browser restart, not when the last private window closes or the extension worker stops. Each separate library includes its sessions, bookmarks, preferences, trash, backups, and Undo records under keys prefixed with `tablodge.private.`. The mode, setup completion, and the optional private window accent color are stored in `chrome.storage.local` under `tablodge.private.config`, and the accent is also copied to the private window's `localStorage` as `tablodge.privateAccent`. Light and dark appearance is shared.

Separate libraries start empty. Switching modes does not copy, merge, or delete any library. To erase one, select that mode, open Settings from its private dashboard, and clear its data and recovery copies. For the saved one, **Erase private data** on the lock screen or in Settings deletes everything in it, including the password. Removing the extension deletes all its browser storage. The redirect preference is stored with the private mode and setup preference in `tablodge.private.config`; it does not record private browsing activity. Saved private storage is encrypted with the password you set before it opens (below). Automatic snapshots, automatic backups, and browser bookmark monitoring do not run in private windows, and private windows cannot list, restore, or delete snapshots, even in shared mode. Explicit exports and manual backup downloads can still write private data to disk and are not removed on browser restart.

The saved separate library is locked with a password (see [Private windows](private-windows.md#lock-a-separate-saved-library)). Every value of the private library is then encrypted with AES-GCM under a random key, and that key is wrapped with your password through PBKDF2-SHA-256 (at least 600,000 iterations). Storage key names, their sizes, the storage mode, and the lock settings stay readable, and the data is encrypted only on this device. The key sits in `chrome.storage.session`, which the browser keeps in memory and never writes to disk. It is removed when you lock, when the idle time passes, when you lock your screen (through the `idle` permission, which reports only that state), when the last private window has closed, and when the browser closes, reloads, or disables the extension. The browser does not tell TabLodge when the last private window closes, so after that the key stays in memory until a private window opens again. TabLodge then removes it before showing any private data. To find this out it keeps the ids of the private windows that were open in session storage beside the key. The ids are numbers only, and they go when the key does. Session storage also holds the time the library was last used, for the idle lock, and a count of recent wrong entries, which makes the next attempt wait. TabLodge stores no copy of the password and no hint, so a lost one cannot be recovered. Someone who copies your profile files can try passwords offline, and a short or number-only one does not hold up to that, so choose a long one for anything sensitive. Changing the password wraps the same key again and does not encrypt the data again. Exports and backups made from an unlocked private library are plain unless you protect a full backup.

Temporary private data also clears if the extension is disabled, reloaded, or updated. This is different from a background worker restart, which keeps browser session storage.

Two temporary coordination keys, `tablodge.lock.normal` and `tablodge.lock.private`, hold only write order numbers and flags in browser session storage. They prevent concurrent saves from overwriting one another and contain no browsing data.

### Saved data

Your saved sessions and bookmarks stay until you delete them. The optional **Archive sessions not opened for** setting only moves old sessions into an Archived folder; it never deletes them. Deleted items go to the trash bin for 7, 30, or 90 days, depending on your setting. Snapshots, backups, trash, and Undo records have retention or size limits. You can clear recovery data from **Settings › Recovery & backups**.

Use **Settings › Data** to erase sessions, bookmarks, or both. Erasing data creates a safety backup and offers Undo, so check the backup history too if you want to remove retained copies. After an update that changes how the library is stored, TabLodge keeps a full copy of the old library for seven days and takes a safety backup, so the copy can hold items you deleted soon afterwards. Removing the extension deletes its browser storage.

If you enable **Also save a copy to Downloads**, TabLodge writes backup JSON files to `Downloads/TabLodge/`. It doesn't upload them. Turning the option off or uninstalling the extension doesn't delete files already written there; you must remove those yourself.

Exports are not encrypted unless you choose to protect a full backup. JSON, HTML, CSV, Markdown, and URL list exports, and full backup ZIP files you leave unprotected, may contain sensitive titles, URLs, or notes. The full backup also includes settings, excluded sites, theme and accent, snapshot history, trash, and page copies. Keep these files private and remember that a folder you sync through another app may upload them.

When you back up everything, you can protect the file with a password. TabLodge then encrypts it on your device with AES-256 in GCM mode, using a key derived from your entry with PBKDF2 (SHA-256, 600,000 iterations) and a random salt and nonce per file. The password is never stored, sent, or saved as a hint, so a lost one cannot be recovered. A number-only password has few combinations, so anyone who copies the file can try them all offline; use a long one with letters for sensitive data. Encryption protects only the file you export. The automatic backups kept in the extension's storage, the Downloads copies, safety backups, snapshots, and the library itself are not encrypted. Only the full backup ZIP can be protected.

## Permissions

TabLodge has no website access until you add a site in [Sources](#sources), declares no content scripts, and makes no network requests unless you turn on sync, which talks only to your server, or import a shared page from a link, which fetches only the address you give.

| Permission | Why |
| --- | --- |
| `tabs`, `tabGroups` | Save and restore tabs and their groups |
| `bookmarks` | Import browser bookmarks and offer to add new ones |
| `favicon` | Show icons from the browser's own cache (Chromium) |
| `storage`, `unlimitedStorage` | Keep the library on this device |
| `contextMenus` | Save and bookmark pages, links, images, and videos from right click menus |
| `clipboardWrite` | Copy links when you ask |
| `sidePanel` | The side panel (Chromium; Firefox uses its sidebar) |
| `search` | **Search the web** with your default engine |
| `alarms` | Snapshots, backups, trash cleanup, archiving, sync, and the private lock |
| `idle` | Lock the private library when you lock your screen |
| `activeTab`, `scripting` | Show the search palette over the current page when you press its shortcut, read the open tab when you choose **Keep a copy**, and show the confirmation with Undo after **Save quote** |

This table explains each required permission. None of them gives access to websites. `activeTab` and `scripting` let the palette shortcut show the palette over the current page, which is the default and can be changed to a window in Settings, let **Keep a copy** read the one tab you chose it for, and let **Save quote** show its confirmation on the page you right-clicked. **Save quote** stores only the text you selected and the page's address, in that page's bookmark note (or saved tab notes); it reads nothing else from the page and sends nothing anywhere. Browsers show no install warning for them and no prompt appears when they are used. The Firefox version leaves out `favicon` and `sidePanel`, which only Chromium has, and declares in its manifest that it collects no data.

Optional permissions are asked for only when you turn on the feature that needs them, and turning it off removes them:

| Optional permission | Why |
| --- | --- |
| `downloads` | Copy backups to your Downloads folder |
| `https://www.youtube.com/*` | **Settings › Sources › YouTube Watch later** |
| `https://www.reddit.com/*`, `https://old.reddit.com/*` | **Settings › Sources › Reddit saved** |
| `https://x.com/*`, `https://twitter.com/*` | **Settings › Sources › X bookmarks** |
| `https://www.instagram.com/*` | **Settings › Sources › Instagram saved** |
| `https://github.com/*` | **Settings › Sources › GitHub stars** |
| `https://news.ycombinator.com/*` | **Settings › Sources › Hacker News favorites** |
| `https://stackoverflow.com/*` | **Settings › Sources › Stack Overflow bookmarks** |
| `https://dev.to/*` | **Settings › Sources › dev.to reading list** |
| `https://lobste.rs/*` | **Settings › Sources › Lobsters saved** |
| `https://bsky.app/*` | **Settings › Sources › Bluesky saved posts** |
| `https://soundcloud.com/*`, `https://m.soundcloud.com/*` | **Settings › Sources › SoundCloud likes** |
| `https://open.spotify.com/*` | **Settings › Sources › Spotify library** |
| `https://letterboxd.com/*` | **Settings › Sources › Letterboxd watchlist** |
| `https://www.imdb.com/*`, `https://m.imdb.com/*` | **Settings › Sources › IMDb watchlist** |
| `https://www.goodreads.com/*` | **Settings › Sources › Goodreads Want to Read** |
| `https://medium.com/*`, `https://*.medium.com/*` | **Settings › Sources › Medium reading list** |
| `https://substack.com/*`, `https://*.substack.com/*` | **Settings › Sources › Substack saved** |

## Contact

For questions or concerns, [open an issue on GitHub](https://github.com/bberka/TabLodge/issues). Please leave private URLs, titles, and exported data out of public reports.
