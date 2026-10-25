# Tab management landscape and TabNest gap analysis

*Research date: 2026-10-25. Store counts, ratings, versions and prices are snapshots taken on or near that date. They change often.*

---

## 1. Executive summary

The tab-manager market has two halves. **Local "tab-to-list" tools** (OneTab, Session Buddy, Tab Session Manager, Tabs Outliner) are free or donation-funded. They have millions of users, and their store reviews are dominated by one fear: **losing the saved tabs**. **Cloud "workspace" tools** (Toby, Workona, Partizion, TabExtend) need accounts and subscriptions. They draw **paywall backlash**, such as Toby's 60-saved-tab free cap and Workona's 2021 apology, as well as sync complaints. Meanwhile **browsers absorbed the basics**. Chrome now has saved and synced tab groups, an AI Tab Organizer, Memory Saver, tab search, native vertical tabs (stable rollout from April 2026) and native split view, with an extension API in Chrome 155. Firefox shipped tab groups in 2025 and Edge reworked Workspaces in 2026. Several independent extensions were archived or sold: Better OneTab, Raft and The Great Suspender. Arc is in maintenance mode.

TabNest's position is local-only, with no host permissions and no remote code. It sits on the most trusted side of this market. That stance is a selling point, but only if TabNest also fixes what local tools are criticized for: **no automatic backups, no undo, and fragile restores and migrations at scale**. Its feature set already beats OneTab and is close to Session Buddy for saved sessions. Its biggest gaps are the **live open-tabs manager** (the core of BroTab), **automatic crash snapshots**, **keyboard-first global search**, and **interoperability with other tools' formats**.

### Top 10 recommendations (in priority order)

1. **Automatic local backups and snapshot history (Must).** Use rotating snapshots on `chrome.alarms`, plus optional dated JSON files written via `chrome.downloads`. Take a backup before every schema migration and before every destructive bulk action. Add a "Restore from backup" UI. This addresses the most common complaint in the category.
2. **Trash with undo for every destructive action (Must).** Soft-delete sessions, tabs, bookmarks and columns with 30-day retention. Add an "Undo" toast after delete, restore-and-remove, and close-on-save.
3. **Auto-save of open windows ("History", like Session Buddy and Tab Session Manager) (Must).** Keep a debounced live snapshot of all windows and a "closed window" capture, so crash and accidental-close recovery doesn't depend on Chrome.
4. **A live open-tabs manager covering BroTab's verbs (Must).** List every window and tab, filter on `tabs.query` properties, then activate, close, move, group, pin, mute, discard or deduplicate. Include a BroTab-style "edit as text" mode for `bt move`.
5. **A keyboard-first global search and command palette (Must).** Search open tabs, sessions, bookmarks and recently closed tabs with Ctrl/Cmd+K. Add an omnibox keyword and more `commands`. This is the browser-native equivalent of BroTab's fzf/rofi workflows.
6. **Portable import and export (Must).** Import OneTab text, Session Buddy, Tab Session Manager, Toby and Netscape bookmark HTML. Export Markdown, CSV, plain URL lists and bookmark HTML. Low cost, high trust, and it makes switching from OneTab easy.
7. **Scale and robustness work (Must).** Shard storage by session instead of rewriting one large `tabnest.state` value on every change. Make migrations chunked and resumable. Virtualize long lists. Show storage usage. Test with 10k+ saved tabs. OneTab's 2026 v2 migration timed out for heavy users.
8. **Session-editing workflows users keep requesting (Should).** "Replace session with current window", "append current window", merge or split sessions, tags, an "already saved" badge, and sort by last opened.
9. **Inactive-tab hygiene that never loses data (Should).** Optional auto-discard after N minutes via native `tabs.discard`. Optional Arc- or Tab Wrangler-style auto-stash of tabs idle for N hours into an "Auto-archived" session, with undo and exclusions.
10. **Finish tab-group and split-view fidelity and widen the Side Panel (Should).** Feature-detect the Chrome 155 split API with graceful fallback. Restore group title, colour and collapsed state reliably. Bring sessions and open tabs into the Side Panel, which now competes with native vertical tabs.

---

## 2. Scope, method and caveats

- **Sources:** primary sources (store listings, official help pages and changelogs, Chrome and Mozilla developer docs, GitHub READMEs and source), plus user voices from Chrome Web Store and Firefox Add-ons (AMO) reviews, Hacker News (via the Algolia API), Product Hunt reviews, Tildes and the Vivaldi forum.
- **Reddit was not reachable.** reddit.com blocks this research agent's fetcher and search. No Reddit thread is quoted directly. Claims attributed to Reddit in vendor blogs are marked unverified.
- **Many 2025–2026 "best tab manager" roundups are written by competitors.** Examples are SupaSidebar, SuperchargeBrowser, Rabbitpair/VertiTab, Nexasphere/TabFlow and Northlab. They are cited only for facts that can be cross-checked, and are flagged when used.
- Where I could not verify something, the text says **"unverified"** or **"?"** in the matrix.

---

## 3. Landscape at a glance

| Category | Examples | Typical model | Core promise | Typical failure |
|---|---|---|---|---|
| Tab-to-list / session savers | OneTab, Better OneTab, Session Buddy, Tab Session Manager, Tabs Outliner, Tabli, Raft | Free, donation, or one-time "pro" | Close tabs and get memory back, without losing them | Local-storage data loss, migrations, abandonment |
| Cloud workspaces / visual boards | Toby, Workona, Partizion, TabExtend | Account plus subscription, freemium caps | Projects or "spaces", sync, team sharing | Paywall changes, sync bugs, lock-in |
| Bookmark managers | Raindrop.io (plus native bookmarks) | Freemium; Pro adds full-text search, archive, dedupe | Long-term library | Overkill for transient tabs |
| New-tab dashboards | Bonjourr, Momentum, TabExtend, Toby | Free/OSS or freemium | Calm start page, quick links | Clutter, "took over my new tab" |
| Sidebars / tree tabs | Sidebery, Tree Style Tab (Firefox), Tabs Outliner, Side Space, Chrome or Edge vertical tabs | Free/OSS | Visual hierarchy for hundreds of tabs | Firefox-only APIs, now competing with native vertical tabs |
| Suspenders / auto-closers | The Great Suspender (dead), Auto Tab Discard, Marvellous Suspender, Tab Wrangler, Chrome Memory Saver | Free | RAM relief | Malware (Great Suspender), lost "suspended" tabs |
| Power-user / CLI | BroTab, TabFS | OSS | Script tabs from the shell | Setup friction (native messaging) |
| Browser-native | Chrome groups, Saved Tab Groups, Tab Organizer, split view; Edge Workspaces and vertical tabs; Firefox tab groups; Arc Spaces and auto-archive; Vivaldi stacks, tiling, workspaces and sessions | Free, tied to the browser account | Zero install | Sync semantics surprises, limited export |

---

## 4. Product profiles

Each profile lists: **Core**, **Distinctive**, **Pricing**, **Privacy/sync**, **Complaints**.

### 4.1 OneTab (OneTab Ltd)
- **Core:** Converts all tabs into a list. Restore one tab or all, name, lock and star groups. Import and export URL lists. Option to restore without deleting (per a developer reply). Chrome Web Store: 2,000,000 users, 3.8★ from 14.6K ratings, v2.24, updated 2026-10-11.
- **Distinctive:** Extreme simplicity and the "save up to 95% memory" pitch. **OneTab v2** reached all users around March 2026. It moved to a new browser database and added folders, search and "encrypted cloud sync/backup". The official troubleshooting page still says the team is "working on" sync and backup, and the store description doesn't mention sync.
- **Pricing:** Free. No paid tier verified.
- **Privacy/sync:** "Your tab URLs are never transmitted or disclosed… except 'Share as a web page'", which uploads the list. Domain icons are fetched from Google.
- **Complaints:** Data loss, constantly. 1★ AMO reviews from 2026 include "Yesterday received some update and today months of work is gone forever - no DB backup no nothing!" (Koiebe, 2026-07-06), "Lost all stored tabs over one update" (D53, 2026-03-26), "How could you forget to write a migration script…" (tim, 2026-03-24). On Chrome: "The whole point is to save your tabs and it got rid of all my saved tabs without notice" (2026-10-18). The developer blames privacy cleaners, Firefox "Refresh", disk corruption and uninstalling. The troubleshooting page admits that **Chrome timed out the v2 migration for users with very many stored tabs** and gives a console workaround. UI change backlash: "center-alligned everything without an option to revert it back".
- **Lesson for TabNest:** Simple wins users, but a list that lives only in local storage needs automatic backups, a safe migration path, and loud warnings about uninstalling.

### 4.2 "OneTab Plus"
- No official premium "OneTab Plus" could be verified. Several unrelated extensions use the name. One Firefox listing shows named groups, lock and dark mode. A Chrome "OneTab Plus (Memory Saver)" was **removed and flagged "could be malicious"** by Extension Auditor. A third-party Chrome listing is by KONOVA CO., LIMITED.
- **Lesson:** Popular names attract copycats. Users can't tell clones from originals, which is another argument for TabNest to publish clear provenance (source, permissions, no-network statement).

### 4.3 Better OneTab (cnwangjie)
- **Core:** OneTab clone with pinned lists, shortcuts, drag-and-drop, import/export, and optional sync through the author's own server.
- **Status:** **Archived 2025-03-31.** The author says "I myself have not maintained this project for a long time" and suggests Chrome's built-in tab management or Arc instead. The README also says the original OneTab "seems to have been sold" and that its owner registered a trademark and emailed about store removal. That ownership claim is **unverified**: OneTab Ltd is the current developer, and a 2024 USPTO "ONETAB" filing exists with the applicant not shown.
- **Lesson:** A server-backed sync paid for by one person is a single point of failure. Trademarked names invite takedowns.

### 4.4 Tab Session Manager (sienori, MPL-2.0)
- **Core:** Save and restore windows, names **and tags**, **auto-save on window close** (with a minimum-tab-count option) and **at intervals**. Import and export, **import from Session Buddy**, tab-group support, "switch workspaces", cloud sync. Firefox: 175,065 users, 4.2★ (1,247), v7.4.0, 2026-07-17. Chrome: ~100k users, 3.5★ (450).
- **Distinctive:** Auto-save plus open source. The changelog notes that the minimum auto-save interval rose from 0.1 to **0.5 minutes because of Manifest V3**, which is the `chrome.alarms` floor.
- **Pricing:** Free and open source.
- **Privacy/sync:** Local by default with optional cloud sync. The listing doesn't name the provider; Google Drive is commonly reported but unverified here.
- **Complaints (AMO 2★):** "there is a horrible bug, which from time to time deletes all sessions" (2026-03-06). "I can't restore them except for clicking and restoring every tab single-handedly" (2025-12). "it saves open sessions as new ones, not updates them!!" (2025-07). "the automatic backup feature stopped working" (2025-06).

### 4.5 Session Buddy
- **Core (v4, a rewrite released 2024-03-13):** "This Browser" (live open tabs), **Collections** (saved sessions as folders and links), **History** (automatic snapshots, including at shutdown and crash), relevance-ranked search, and copy and export as Title & URL, Markdown, CSV, JSON or HTML. Chrome Web Store: 1,000,000 users, 3.3★ from 25.1K ratings.
- **Distinctive:** Crash recovery through History snapshots, and export to many formats.
- **Pricing:** Free, asks for donations.
- **Privacy/sync:** Local IndexedDB. No sync; the v4 page mentions only a "foundation for cloud storage".
- **Migration history:** v4 was forced by Chrome's Web SQL deprecation. The developer warned: "if you wait until after March 1, 2024 to upgrade your browser, you will lose all of your Session Buddy saved sessions."
- **Complaints (Chrome Web Store, Sep–Oct 2026):** Restoring a large session "sometimes crashes Chrome due to a RAM spike". Backups "stopped working". Icon unresponsive. Feature requests: drag open tabs into collections, sort collections by last opened, and **an indicator when a tab is already saved**. Praise: "Saves that day when everything vanished!"

### 4.6 Toby (Launch Labs)
- **Core:** Spaces, Collections, "Next" (pin today's tabs), one-click session save, tags, notes, share links, team spaces, and **Smart Sort** (AI grouping). Clients for Chrome, Firefox, Edge, web, iOS and Android. Chrome Web Store: 300,000 users, 3.5★ (3.3K). A redesign shipped in 2026, and recent reviews are positive.
- **Pricing:** Starter is free but limited to **60 saved tabs per workspace**. Over the limit you can still view, open and export, but can't save. Productivity is $6/member/month ($4.50 billed yearly). Team is $10 ($8 yearly). Enterprise is custom.
- **Privacy/sync:** Account required. Data is synced through Toby's cloud.
- **Complaints (AMO 1★):** "60 cards limit is insane" (2025-02). "You will only be able to save 60 tabs without a subscription" (2024-10). "Right after creating the account you are prompted for a credit card" (2024-03). "it took my browser page and info, i could not unstall it like a virus" (new-tab takeover, 2025-07). Product Hunt: "One day I lost all my notes and support refused to help." Chrome Web Store request: "replace an existing collection with the current set of tabs."

### 4.7 Workona
- **Core:** Spaces (only the current space's tabs are visible), autosave of every tab, crash restore, **tab suspension**, cross-device sync, search from anywhere (including the new tab page), integrations, templates. Pro adds **90-day session backups**. Chrome Web Store: 200,000 users, 4.2★ (3.8K).
- **Pricing:** Free for up to 5 workspaces (individuals only). Pro is listed "from $7/month" on Workona pages; third parties say $8–9, so treat the exact price as unverified. Team needs 3 or more users. Enterprise is custom.
- **Privacy/sync:** Account plus cloud. Free users who go over the limit get locked out of their oldest spaces, with export still allowed.
- **Complaints:** In 2021 the CEO apologized: "Many users were caught off guard by the restrictions of the Free plan", and grandfathered old workspaces. Chrome Web Store 2026: "Killed 50+ open tabs and tab groups without possibility to recover". "it has a hard time keeping tabs synchronized across multiple devices". "Stopped working… I want my money back." Product Hunt: "there is no undo button in notes"; "There is no formal declaration of tags".

### 4.8 Tabs Outliner
- **Core:** A drag-and-drop tree where any node can contain any other, mixing live and saved windows. Close-and-save in place. Tree relations follow the opener tab. Notes, separators, to-dos. Export annotated lists. Crash recovery, reopening only what you need. Chrome Web Store: ~100,000 users, 3.2★ (3.3K), v1.4.168, 2026-07-23.
- **Pricing:** Core is free. A **one-time** Pro payment unlocks keyboard shortcuts, clipboard, frequent local backups and **daily Google Drive backups**. An earlier listing showed $14.95; current price unverified.
- **Complaints:** Chrome Web Store reviews from Dec 2024 to Jan 2025 report saved tabs increasingly failing to open after Chrome updates, empty tree windows, and Pro status lost after reinstalling. Some were fixed by workarounds.
- **Lesson:** Users accept one-time payments well. Backups are the feature people pay for.

### 4.9 Tab Manager Plus (stefanXO, MPLv2)
- **Core:** All windows and tabs in one view. Search with `t:` (title), `u:` (URL), `-word`, exact phrases and regex. Arrow-key and Space selection, Shift ranges. "Highlight duplicates", keeping the most recently used copy. Last-used hover cards. Saved windows with names and colours that persist.
- **Gaps:** **No browser tab-group support yet.** The 7.x Firefox build isn't published. 110 open issues.
- **Lesson:** A keyboard-first live tab list with a query syntax is cheap to build and much loved. TabNest should copy the query syntax.

### 4.10 BroTab (balta2ar, MIT)
- **Core:** CLI `bt` plus a Firefox, Chrome or Brave extension, connected through a **native-messaging "mediator"** that serves HTTP on localhost. `--target host:port` lets it control remote or other browsers; this is the "server" piece excluded here. Around 422 GitHub stars, last push January 2025 per ecosyste.ms.
- **Commands:** `list`, `close`, `activate [--focused]`, `active`, `query` (with flags such as `+active/-active`, `+pinned`, `+audible`, `+muted`, `+highlighted`, `+discarded`, `+autoDiscardable`, `+currentWindow`, `+lastFocusedWindow`, `+windowFocused`, `-status`, `-title`, `-url` (repeatable), `-windowId`, `-windowType`, `-index`, `-info <json>`), `index` and `search` (SQLite FTS5 over page text), `open` (URLs from stdin), `new` (Google search tab), `navigate`, `update` (tabs.update JSON or flags), `words`, `text`, `html`, `dup` (a how-to for closing duplicates), `windows`, `clients`, `move` (edit the tab list in `$EDITOR` to reorder, close or re-window tabs), `screenshot`, `install`.
- **Integrations:** fzf and rofi pickers, Albert, and Neovim completion (deoplete, coc, ncm2, cmp-brotab).
- **Section 8.4 maps every command to TabNest.**

### 4.11 Tabli (antonycourtney, MIT)
- **Core:** A popup listing every window and tab. Switch or close in one click, and save or restore sets of tabs. 413 stars, 81 open issues. Maintenance status unclear; no releases listed. It showed that a **fast popup switcher** is a feature in its own right.

### 4.12 Partizion
- **Core:** Auto-saves tabs as you open and close them, restores in any browser, optional encryption and auto-delete, or sync turned off entirely. Kanban and grid views, team pricing. Chrome Web Store 4.3★ (122).
- **Pricing:** **Paid only.** A 14-day trial, after which the account closes and server data is deleted 14 days later (per a competitor's comparison; unverified). Partizion's essay argues "Partizion is a paid model because we want to build a tab manager for the long haul", saying free tools get abandoned, lose tabs, or sell data.

### 4.13 TabExtend
- **Core:** New-tab Kanban boards of tabs, notes and to-dos. Drag to save, open or close groups in one click, right-click a site to save it. Web app and sharing.
- **Pricing:** A free personal tier and up to about $6/month (AlternativeTo); Capterra says "contact vendor". Unverified.

### 4.14 Raindrop.io (bookmark side)
- **Free:** Unlimited bookmarks, collections, highlights and devices; import/export; sharing; 100 MB uploads per month.
- **Pro:** Full-text search, permanent web archive copies, duplicate and broken-link finder, daily backups, reminders, annotations, AI suggestions and assistant, MCP, 10 GB uploads. Yearly billing is about 20% off; the dollar price wasn't readable on the page (unverified).
- **Relevance:** Users park important tabs there "with the false intent to read some day" (HN). Its Pro list shows which bookmark features people will pay for: dedupe, broken-link checking, backups and full-text search.

### 4.15 New-tab dashboards: Bonjourr and Momentum
- **Bonjourr:** Free, open source and donation-funded. Quick links, search, Markdown notes with checkboxes, widgets (Pomodoro, weather, quotes), heavy customization including custom CSS, "No generative AI", no data collection, no account.
- **Momentum:** Freemium. The free tier includes focus, to-dos, links, search and a bookmarks bar. Plus adds customization and integrations. Plus price unverified; one review says $3.33/month or $39.95/year, and a clone claims $30/year.
- **Lesson:** New-tab extensions that are calm, fast, private and customizable get loyal users. Taking over the new tab page without an easy way out produces 1★ reviews, as with Toby.

### 4.16 Arc (The Browser Company)
- **Tab model:** Spaces and profiles. Pinned tabs act as persistent "favourites". Unpinned "Today" tabs **auto-archive after 12 hours by default**, configurable per profile (secondary sources say up to 30 days). Viewing a tab resets its timer. **Auto-archive cannot be disabled.** The Archive is searchable through the command bar.
- **Status:** The Browser Company announced **maintenance mode in May 2025** and moved its focus to Dia, which dropped the sidebar. Atlassian's acquisition was reported to close in October 2025; that date comes from secondary sources and is unverified.
- **Lesson:** "Auto-archive, not auto-delete" is a popular idea. A searchable archive is what makes it safe.

### 4.17 Vivaldi
- **Tab model:** Tab Stacks in compact, two-level and accordion styles, tab tiling (split screen), **Saved Sessions**, tab hibernation, vertical tab bar, tab cycling, a Closed Tabs list, and Workspaces. Workspaces arrived around Vivaldi 6.0 in 2023 (from memory, not re-verified). The features page didn't describe Workspaces in detail.
- **Lesson:** Vivaldi's built-ins cover most OneTab and Session Buddy use cases. Extensions still win on portability across browsers and on searchable archives.

### 4.18 Chrome's built-in features (2024–2026)
- **Tab groups:** Saved and synced automatically. "Close" keeps a group saved in the bookmarks bar or menu. "Delete" **removes it from all synced devices**, and ungrouping or dragging can also delete a group everywhere. Groups can't be pinned.
- **Tab Organizer:** AI-suggested groups from Tab search → "Organize tabs". Requires the US, age 18+ and a signed-in account. Page titles, URLs and group data of the active window are collected "to improve the feature". In July 2026 an "Ask Gemini about this group" experiment was reported in Canary.
- **Other features:** Tab search (Ctrl/Cmd+Shift+A). Memory Saver, which uses native discarding and protects pinned, audio and form tabs. **Native vertical tabs**, rolling out to stable from 2026-04-07. **Native split view** (Chrome 145, per Google's blog), with an extension API in **Chrome 155**.
- **Extension APIs:** `chrome.tabGroups` (title, colour, collapsed, `shared` in 137+) has **no documented access to *saved* (closed) groups**. `chrome.tabs` gained `lastAccessed` (121+), `frozen` (132+), `splitViewId` (140+), and `createSplit`, `unsplit` and `create({splitWithTabId})` (155+).

### 4.19 Microsoft Edge: Workspaces and vertical tabs
- Vertical tabs are long-standing.
- **Workspaces V2**, rolled out from Edge 145 (February 2026) through roughly 149–150, moved storage from OneDrive and SharePoint to Edge Sync and **removed sharing and collaboration**. Q&A threads say tab locking was also removed. When sync is disabled by policy, new workspaces are local-only. Users posted "workspaces are gone with the new update" on Microsoft Q&A.
- **Lesson:** Even a browser vendor can remove the features a workflow depends on. Local exportability matters.

### 4.20 Firefox
- **Tab groups:** Progressive rollout in 137, available to all users with **138** (2025-04-29). Optional **on-device AI** suggests group names and similar tabs (English locales only), and Mozilla says URLs aren't shared. Over 18 million people had used groups by November 2025.
- **Other features:** Vertical tabs and the new sidebar reached release users in **136**.
- **WebExtensions:** Tab-group support in the `tabs` API from 138, and a `tabGroups` API previewed for 139. This makes a future Firefox port of TabNest more feasible.

### 4.21 Sidebery (Firefox, MIT)
- **Core:** Vertical tab panels in tree or flat layout, bookmarks and history panels, search inside panels, deep container integration, customizable context menu and styles, and **automatic snapshots** of windows and tabs. Data is local unless the user turns on sync, which goes through a third-party provider. AMO 4.7★ (~1,000+ reviews, 51–60k users across page snapshots).

### 4.22 Tree Style Tab (Firefox, Piro)
- **Core:** Tabs as a tree, with children nested under their opener tab and collapsible branches. A **public API** supports a helper-addon ecosystem (Multiple Tab Handler, TST Auto Group Tabs and others). AMO: 143,303 users, 4.5★ (2,275), v4.4.9, 2026-09-30, "Recommended".
- **Lesson:** Opener-based hierarchy (`openerTabId`) is cheap metadata that TabNest could save today.

### 4.23 Suspenders: The Great Suspender, Auto Tab Discard, Tab Suspender family, Memory Saver
- **The Great Suspender:** Sold by its creator in June 2020 to an unidentified party. v7.1.8 (October 2020) added code that could run remote code and track users. Edge blocked it first. Google removed it **and force-disabled it on 2021-02-04**. Two million or more installs. Users lost suspended tabs, because suspended tabs were the extension's own pages, and had to dig them out of history. HN: "I no longer trust The Great Suspender" (889 points, 371 comments).
- **Auto Tab Discard:** Uses **native** discarding, so tabs survive if the extension is removed. Exclusion lists by hostname or regex. Protects pinned tabs, media, and unsaved input. Restores scroll and form state. Chrome Web Store: 200,000 users, 4.0★ (390), v0.7.7, 2026-10-12.
- **Marvellous Suspender and "Reloaded" forks:** Volunteer-maintained per secondary sources. Current safety status unverified.
- **Chrome Memory Saver:** Discards under memory pressure with no user timer. Extensions remain useful for predictable, timer-based discarding.
- **Tab Wrangler (related):** Auto-closes inactive tabs into a "Corral", with locks and exclusions. Firefox v9.1.1, 2026-10-13. Its MV3 release (v7.0.0) listed a bug where locked tabs were lost on browser restart.

### 4.24 Notable newer entrants (2025–2026)
| Product | Date | What it does | Notes |
|---|---|---|---|
| **OneTab v2** | Mar 2026 | Folders, search, (pending) encrypted sync | Migration problems for large data |
| **Chrome native vertical tabs and split view** | Apr 2026 / Chrome 145 / API in 155 | Built-in | Reduces the need for sidebar extensions |
| **Edge Workspaces V2** | Feb–Jun 2026 | Personal-only workspaces | Sharing removed |
| **Raft** | Show HN Feb 2026 | OSS tab manager "because extensions have trust issues". Native discard, sessions, folders, rotating recovery snapshots, optional E2E-encrypted sync to the user's own Google Drive appData, a published "Trust Report" | **Already archived.** Its design is the closest to TabNest's philosophy and worth studying |
| **Tab Atlas** | Sep 2026 | Visual tab cards grouped by site, Ctrl+K search, duplicate cleanup, HTML report export, "never auto-closes your tabs" | Local-only |
| **TabSearch** | Product Hunt 2026-02-05 | Privacy-first search over open tabs | Local-only |
| **Tab-da** | Show HN Jul 2026 | "Keyboard-first" Chrome tab manager | |
| **WorkTab** | Show HN Dec 2025 | Workspace-based tab manager | |
| **Side Space** | Show HN Jul–Sep 2025 | Arc-like AI vertical tabs for Chrome | |
| **Tabernacle** | Oct 2026 | Tree-style tab manager for Firefox | |
| **VertiTab 3.0** | Aug 2025 | Vertical tab manager | Its vendor also writes roundups |
| Vendor-content players | 2026 | SupaSidebar, SuperchargeNavigation, TabFlow AI, Nest Extended, Tab Group Vault | Active SEO marketing; claims not independently verified |

---

## 5. What users want and complain about

Themes are roughly ordered by how often they appear in the reviews and threads read for this report.

### 5.1 Data loss is the dominant fear
- "Yesterday received some update and today months of work is gone forever - no DB backup no nothing!" (OneTab, AMO 1★, 2026-07-06)
- "If any application (including browser addons) does not have an OFFLINE import-export-backup function, it has no value to me" (OneTab, AMO, 2026-03-29)
- "Hundreds of tabs up and disappeared." (OneTab, AMO, 2026-07-23)
- "there is a horrible bug, which from time to time deletes all sessions" (Tab Session Manager, AMO, 2026-03-06)
- "Killed 50+ open tabs and tab groups without possibility to recover" (Workona, Chrome Web Store, 2026-09-08)
- "a few thousand links disappeared from this universe forever with no way to restore it." (HN, 2015)
- "a browser (Firefox) restart caused the loss of all my 10s of open tabs" (Tildes)
- The flip side, as praise: "Saves that day when everything vanished!" (Session Buddy, Chrome Web Store, 2026-10-23)

**Takeaway:** Users can't tell "the browser wiped storage" apart from "the extension lost my data", and they blame the extension either way. Automatic, *external* backups (files) and visible snapshot history are the cure. So is a clear explanation of what uninstalling does.

### 5.2 Restore reliability and performance
- Session Buddy: restoring a big session "sometimes crashes Chrome due to a RAM spike" (2026-10-19).
- Tab Session Manager: "I can't restore them except for clicking and restoring every tab single-handedly" (2025-12).
- Tabs Outliner: saved tabs fail to open after Chrome updates (Chrome Web Store, 2025-01).
- **Takeaway:** Restore in batches, unload background tabs (TabNest already offers this), report failures per tab (TabNest already does), and never remove saved data until the tabs have opened. TabNest gets that last point right.

### 5.3 Editing a session vs. making a new one
- "it saves open sessions as new ones, not updates them!!" (Tab Session Manager)
- "replace an existing collection with the current set of tabs" (Toby)
- Wanted: "an indicator when a tab is already saved to a collection", drag open tabs into collections, sort by most recently opened (Session Buddy reviews).

### 5.4 Pricing and subscription backlash
- "60 cards limit is insane" / "You will only be able to save 60 tabs without a subscription." (Toby, AMO)
- "Right after creating the account you are prompted for a credit card to trial their Pro plan." (Toby, AMO)
- "Many users were caught off guard by the restrictions of the Free plan." (Workona CEO, 2021)
- A competitor blog quotes a Reddit user saying paid tab managers "felt like rent" (unverified, because Reddit was unreachable).
- Counterpoint: Partizion argues that only paid tools last. Tabs Outliner's one-time Pro is accepted.
- **Takeaway:** For a free, local tool, the advantage is "no account, no cap, no lock-in, export always works". TabNest should say so plainly.

### 5.5 Sync, wanted but distrusted
- "it has a hard time keeping tabs synchronized across multiple devices" (Workona, 2026)
- OneTab v2 users waited "over half a year" for the promised sync (Chrome Web Store, via a review summary).
- Chrome's own sync deletes a group "from all synced devices" on delete, which surprises people.
- **Takeaway:** Not having sync is acceptable if *files* move easily: export, import, and an optional bookmarks mirror. Sync done badly causes data loss of its own.

### 5.6 Trust, privacy and permissions
- "That's something that worries me, whenever I install a software with trusted privileges." / "the difference with browser extensions is the anonymity and speed of changing owners." (HN, Great Suspender thread)
- Raft's Show HN title: "…because extensions have trust issues".
- Chrome's AI Tab Organizer sends titles and URLs to Google. Firefox advertises its on-device model as the private alternative.
- **Takeaway:** TabNest's stance (no host permissions, no network, everything bundled) is a feature. Publish it, and keep new features behind *optional* permissions.

### 5.7 Organization: folders, tags, domains, colours
- "I wish any of the tab managers would allow me to sort by domain" (HN)
- "There is no formal declaration of tags in Workona." (Product Hunt)
- "just being able to group them by colour like you can in Chrome would be a huge leap forward." (HN)

### 5.8 Keyboard-driven and search-first workflows
- Tab Manager Plus's query syntax, Tab Atlas's Ctrl+K, TabSearch, Tab-da ("keyboard-first"), and BroTab plus fzf/rofi.
- "I'd be completely satisfied if they brought the old MRU tab ordering back." (HN)
- Session Buddy v4 moved to ranked search results.

### 5.9 Habits: tabs as short-term memory and the "tab cemetery"
- "bookmarks don't work (I just don't do it) and history rarely works (too much noise there)." / "I found an extension that I use as a 'tab cemetery'" (HN, 2026)
- "I treat tabs as temporary, not storage" / "I use the Tab Wrangler extension and have it nuke everything after like 8 hours" (HN, 2026)
- "when I feel the system response becomes slow, I close every tab I don't need anymore." (HN)
- **Takeaway:** There is a large group of users who want *automatic* tidying with a safe, searchable archive (Arc's model), rather than manual filing.

### 5.10 UI clutter and unwanted change
- "center-alligned everything without an option to revert it back" (OneTab v2, AMO)
- "too many options" (Toby, Product Hunt)
- A new-tab takeover that the user "could not unstall… like a virus" (Toby, AMO)
- **Takeaway:** Keep the dashboard calm. Make new UI opt-in where possible. Keep the "use the default new tab" escape hatch, which TabNest already has.

### 5.11 Duplicates
- Toby moved duplicate removal into its paid tier. Raindrop's duplicate finder is Pro-only. Tab Manager Plus highlights duplicates. Tab Atlas offers duplicate cleanup. BroTab only has a `dup` how-to.
- TabNest handles duplicates at save, restore and import time, but **not for open tabs**.

---

## 6. Feature matrix

Legend: ✅ yes · ◐ partial or limited · ❌ no · ? not verified · 💲 paid tier only

| Feature | OneTab (v2) | Session Buddy (v4) | Tab Session Manager | Toby | Workona | Tabs Outliner | Sidebery (FF) | Chrome built-in | Arc | **TabNest (now)** |
|---|---|---|---|---|---|---|---|---|---|---|
| Save current window to list | ✅ | ✅ | ✅ | ✅ | ✅ (autosave) | ✅ | ✅ (snapshot) | ◐ (as group) | ◐ | ✅ |
| Save selected tabs | ◐ | ✅ | ? | ◐ | ? | ✅ | ✅ | ◐ | ❌ | ✅ |
| Save all windows | ✅ | ✅ | ✅ | ? | ? | ✅ | ✅ | ❌ | ❌ | ✅ |
| Automatic snapshots / crash history | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ (live tree) | ✅ | ◐ (session restore, recently closed) | ✅ (archive) | ❌ |
| Automatic backups | ◐ (v2 cloud backup, "in progress") | ? | ◐ | ✅ (cloud) | 💲 (90-day) | 💲 (local plus Drive) | ◐ | ◐ (sync) | ◐ (sync) | ❌ (manual JSON only) |
| Trash / undo | ? | ? | ? | ? | ◐ | ? | ? | ◐ (recently closed) | ✅ (archive) | ❌ |
| Folders / collections / spaces | ✅ | ✅ | ◐ (tags) | ✅ | ✅ | ✅ (tree) | ✅ (panels) | ◐ (groups) | ✅ (spaces) | ✅ |
| Tags | ? | ? | ✅ | ✅ | ◐ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Notes on sessions / tabs | ✅ | ? | ? | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Lock / star / pin sessions | ✅ (lock, star) | ✅ (pin) | ? | ✅ (Next) | ? | ? | ? | ❌ | ✅ (pinned tabs) | ✅ (lock) |
| Archive sessions or tabs | ❌ | ❌ | ? | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (auto) | ✅ (manual) |
| Search saved items | ✅ | ✅ (ranked) | ? | ✅ (💲 advanced) | ✅ | ? | ✅ | ◐ | ✅ | ✅ |
| Live open-tabs manager (all windows) | ❌ | ✅ | ◐ | ◐ | ✅ | ✅ | ✅ | ✅ (tab search) | ✅ | ◐ (popup, current window) |
| Close duplicate open tabs | ❌ | ? | ? | 💲 | ? | ? | ? | ❌ | ❌ | ❌ |
| Duplicate handling on save / restore / import | ? | ? | ? | 💲 | ? | ? | ? | ❌ | ❌ | ✅ |
| Native tab-group fidelity | ? | ? | ✅ | ? | ? | ? | n/a | ✅ | n/a | ✅ (best effort) |
| Pinned tabs | ? | ? | ? | ? | ? | ? | ✅ | ✅ | ✅ | ✅ (opt-in) |
| Split-view save / restore | ❌ | ❌ | ? | ❌ | ❌ | ❌ | n/a | ✅ (native) | ✅ | ◐ (in progress, Chrome 155+) |
| Tab suspension / discard | ✅ (by closing) | ❌ | ◐ (lazy restore?) | ❌ | ✅ | ❌ | ✅ (unload) | ✅ (Memory Saver) | ◐ | ◐ (restored tabs only) |
| Auto-close / auto-archive inactive tabs | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (desktop) | ✅ (12 h default) | ❌ |
| Keyboard shortcuts / command palette | ◐ | ? | ? | ? | ? | 💲 | ✅ | ✅ | ✅ (command bar) | ◐ (3 commands, no palette) |
| Import from other tools | ◐ (URL list) | ◐ (own backups) | ✅ (Session Buddy) | ? | ? | ? | ? | ❌ | ◐ | ◐ (own JSON, JSON tab list, browser bookmarks) |
| Export formats | Text URL list | JSON, CSV, Markdown, HTML, Title&URL | JSON | ✅ | ✅ | HTML, text | ? | ❌ | ❌ | JSON, HTML share, copy (Markdown, rich, URL) |
| Share as web page | ✅ (uploads) | ❌ | ❌ | ✅ (links) | ✅ | ◐ (HTML) | ❌ | ◐ (shared groups 137+) | ◐ | ✅ (local HTML file) |
| New-tab dashboard | ❌ | ❌ | ❌ | ✅ | ◐ | ❌ | ❌ | ✅ | n/a | ✅ |
| Bookmark board / columns | ❌ | ❌ | ❌ | ✅ | ✅ (resources) | ❌ | ✅ (panel) | ✅ (bookmarks) | ◐ | ✅ |
| Side panel / sidebar | ❌ | ❌ | ❌ | ❌ | ◐ | ✅ (own window) | ✅ | ✅ (vertical tabs) | ✅ | ◐ (bookmarks only) |
| Cross-device sync | ◐ (pending) | ❌ | ✅ | ✅ | ✅ | ◐ (Drive backup) | ◐ (optional) | ✅ | ✅ | ❌ (by design) |
| Account required | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ◐ (for sync) | ✅ | ❌ |
| Open source | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ (Chromium) | ❌ | ? (not published) |
| Price | Free | Free (donations) | Free | Free (60 tabs per workspace) / $6+ | Free (5 spaces) / ~$7+ | Free / one-time Pro | Free | Free | Free | Free, local |

*Cells marked "?" mean the feature may exist but I could not confirm it from a primary source during this research.*

---

## 7. TabNest today (from `extensions/tabnest/README.md`, `manifest.json`, `src/apps/tabnest/*`)

**Already strong**
- Save the current window, selected tabs, the full window with native groups, the active group, the active tab, or all windows. Or send a tab to the first unlocked session. Available from the popup, the toolbar action, context menus, and two shortcuts plus "open dashboard".
- Restore one tab or a whole session. Destination policies, per-session override, keep/remove/archive modes, modifier-click overrides, locked sessions, per-tab failure reporting, and removal only of tabs that opened. Optional background unloading.
- Folders, search and sort (including custom order), notes, rename and edit, reorder, move, archive, lock, and multi-select export and share (local HTML).
- Pinned-tab opt-in with a safety re-check before closing. Native tab-group metadata. Split-view pairing model (`SplitInfo`) and restore via `chrome.tabs.createSplit` with a fallback to separate tabs.
- Duplicate policies at save, restore and import time. Excluded sites. Copy formats (Markdown, rich text, title/URL variants).
- Bookmark board with columns and drag-and-drop (pointer, touch, and keyboard move actions). Browser-bookmark import. Bookmark JSON import and export. Optional Side Panel for bookmarks.
- Strong privacy posture: no host permissions, no content scripts, no network, local favicons via the `favicon` permission. A versioned schema (v6) with normalization. Serialized mutations (`mutationQueue`). Mocked-API worker tests.

**Not present** (confirmed by reading the source: no `alarms`, `idle`, `sessions`, `downloads` or `omnibox` usage)
- No automatic backups or snapshots, no trash or undo, no auto-save of open windows.
- No manager for open tabs across all windows (close, move, dedupe, query). The popup lists only the current window's tabs for selection.
- No global or keyboard command palette, no omnibox, only three commands.
- No tags, no "update session from window", no merge or split.
- No import of other tools' formats (OneTab text, Session Buddy, Tab Session Manager, Toby, Netscape HTML). No Markdown, CSV or plain-text file export.
- No inactive-tab auto-discard or auto-archive.
- The whole state is one `chrome.storage.local` key that is rewritten on every mutation. That's fine at small sizes, but a risk at OneTab-scale data (Section 9.6).

---

## 8. Gap analysis and prioritized roadmap

Each item gives a **rationale** (tied to the evidence above) and an **MV3 sketch**. "New permission" notes call out changes to the permission prompt. Permissions added in an update can disable the extension until the user accepts, so prefer `optional_permissions` where possible.

### 8.1 Must

**M1. Automatic backups and snapshot history**
- *Rationale:* Section 5.1. This is the single biggest driver of 1★ reviews in the category. Tabs Outliner charges for it and Workona puts it in Pro.
- *Sketch:*
  - Schedule `chrome.alarms.create("tabnest-backup", { periodInMinutes: 60 })`. The 30 s floor doesn't matter here.
  - Alarms persist across restarts only from Chrome 150. On older versions, re-create them in `runtime.onStartup` and `onInstalled`.
  - Write rotating snapshots, for example 24 hourly plus 14 daily, as separate keys (`tabnest.backup.<ts>`) in `storage.local` (with `unlimitedStorage`) or in IndexedDB from the worker.
  - Optionally write a dated file with `chrome.downloads.download({ url: blobOrDataUrl, filename: "TabNest/tabnest-2026-10-25.json", conflictAction: "overwrite", saveAs: false })`. New permission: `downloads`, ideally optional. In a service worker, use a `data:` URL, since there's no `URL.createObjectURL`, or do it from an offscreen or extension page.
  - Always snapshot before schema migrations, "erase", bulk imports, and folder or column deletes.
  - UI: Settings → Data → "Backups" (list, preview, restore, download). Show "last backup" on the dashboard.
  - Explain in Help that uninstalling deletes local data (OneTab's support page has to say this repeatedly).

**M2. Trash and undo**
- *Rationale:* Accidental deletes and close-on-save surprises (OneTab Chrome Web Store, 2026-10-18; Workona; Product Hunt "no undo").
- *Sketch:*
  - Add `deletedAt` to sessions, tabs, bookmarks, columns and folders. Default views filter them out.
  - Trash view with restore and "empty". A daily alarm purges items older than 30 days.
  - Ephemeral undo: keep the inverse operation in memory or `storage.session` for about 10 s and show a toast.
  - For tabs TabNest closed itself, also offer `chrome.sessions.restore()`. That needs the new `sessions` permission and covers at most the last 25 entries.

**M3. Auto-save of open windows (crash recovery)**
- *Rationale:* Session Buddy History, Tab Session Manager auto-save, Sidebery snapshots, Workona autosave. Users rely on these when Chrome's own restore fails.
- *Sketch:*
  - Listen to `tabs.onCreated/onUpdated(url,title,pinned,groupId)/onRemoved/onMoved/onAttached/onDetached`, `tabGroups.on*` and `windows.onCreated/onRemoved`.
  - Debounce for about 5–10 s, then write a "live" snapshot of `windows.getAll({ populate: true, windowTypes: ["normal"] })`.
  - Don't keep state only in worker globals. The worker dies after about 30 s idle, so rebuild from `tabs.query` on wake.
  - On `windows.onRemoved`, copy the last live snapshot of that window into "Recently closed windows" (Tab Session Manager behaviour).
  - On `runtime.onStartup`, keep the previous live snapshot as "Last browser session".
  - Apply the excluded-sites, pinned and incognito rules. Cap the history to N snapshots, deduplicating identical ones.

**M4. Open-tabs manager ("Tabs" view): the BroTab core**
- *Rationale:* BroTab parity (Section 8.4), Session Buddy "This Browser", Tab Manager Plus, Tabli, Tab Atlas. TabNest only sees open tabs through the save flows today.
- *Sketch:* A new dashboard tab, also usable in the popup and Side Panel.
  - `windows.getAll({ populate: true })` plus `tabGroups.query({})`, rendered as windows → groups → tabs, showing `lastAccessed`, audible, muted, discarded and split.
  - Live updates via `tabs.on*` events, or a port from the page.
  - Actions:
    - Activate: `tabs.update(id, { active: true })` plus `windows.update(winId, { focused: true })`.
    - Close: `tabs.remove`.
    - Move to window or new window: `tabs.move`, `windows.create({ tabId })`.
    - Group and ungroup: `tabs.group`, `tabs.ungroup`, `tabGroups.update`.
    - Pin and mute: `tabs.update({ pinned, muted })`.
    - Discard and reload: `tabs.discard`, `tabs.reload`.
    - Split and unsplit: 155+, feature-detected.
    - Save selection to a new or existing session (existing flows).
  - Filters mirror `tabs.query` keys (active, pinned, audible, muted, highlighted, discarded, autoDiscardable, status, windowId, groupId, url patterns, title). Add domain grouping and sort by last used.
  - **Duplicates:** normalize URLs (drop the hash, optionally drop tracking params), keep the copy with the highest `lastAccessed` or the active one, then a bulk close with undo.

**M5. Global search and command palette (keyboard-first)**
- *Rationale:* Section 5.8. This replaces BroTab's fzf and rofi pickers inside the browser.
- *Sketch:*
  - Ctrl/Cmd+K overlay on the new tab page, popup and Side Panel. One index over open tabs (live query), sessions and saved tabs, bookmarks and notes, and optionally `sessions.getRecentlyClosed`.
  - Fuzzy ranking. Actions run from the keyboard: Enter opens or switches, ⌘Enter opens in background, ⌫ closes, `s` saves, and so on.
  - Use a small bundled library such as MiniSearch or Fuse.js, or a hand-rolled trigram index. Keep everything local.
  - Omnibox: `"omnibox": { "keyword": "tn" }`. `chrome.omnibox.onInputChanged` returns suggestions, and `onInputEntered` switches to or opens them. This needs no extra permission.
  - Add more `commands`: open palette, save to the last-used session, restore the newest session, stash the current tab. Chrome allows only **4 suggested keys** per extension. Users bind the rest at `chrome://extensions/shortcuts`, so document that.
  - Support Tab Manager Plus-style query prefixes (`t:`, `u:`, `-word`, `"phrase"`, `/regex/`).

**M6. Portable import and export**
- *Rationale:* Section 5.1 (offline backups), 5.4 (no lock-in), and migration from OneTab, whose v2 problems are pushing users away.
- *Sketch:* Pure parsing in the page plus the existing `IMPORT_SESSIONS` message.
  - **Import formats:**
    - OneTab "Export URLs" text: `url | title` lines, with blank lines separating groups.
    - Plain URL lists.
    - Session Buddy JSON or CSV.
    - Tab Session Manager JSON.
    - Toby JSON.
    - Netscape bookmark HTML, from any browser or Raindrop.
  - **Export formats:** Markdown, CSV, plain URLs, OneTab-compatible text, and Netscape HTML for bookmarks *and* sessions, with folders becoming folders.
  - Keep the duplicate prompts that already exist. Validate URLs (already done).

**M7. Scale and migration robustness**
- *Rationale:* OneTab v2's migration "timing out" for large stores. Session Buddy's forced Web SQL → IndexedDB move. Tab Wrangler's MV3 bug that lost locked tabs. Session Buddy's restore RAM spikes.
- *Sketch:*
  - Shard storage, for example `tabnest.meta` plus `tabnest.session.<id>` plus `tabnest.bookmarks`, so one mutation rewrites kilobytes, not megabytes. Keep `mutationQueue`.
  - Make migrations **idempotent, chunked and resumable**: write a `migrationCursor` and keep the old key until a verify pass succeeds. Snapshot first (M1).
  - Keep each worker task short, or let a page drive long jobs. Extension API calls reset the idle timer, but a single long synchronous parse doesn't.
  - Show `storage.local.getBytesInUse()` in Settings.
  - Virtualize session and tab lists. Restore large sessions in batches of about 10–20 with `active: false`, then `tabs.discard` (already partly done).
  - Add a performance test fixture with 10k–50k saved tabs to `extensions/tabnest/tests`.

### 8.2 Should

**S1. Session editing workflows**
- "Replace with current window", "Append current window", merge sessions, split a session by domain or group, duplicate a session.
- An "already saved" badge for the active tab: `tabs.onActivated` plus `onUpdated` → URL set lookup → `action.setBadgeText`.
- Sort by "last restored" (store `lastOpenedAt`).
- *Rationale:* Section 5.3.

**S2. Tags and smart filters**
- `tags: string[]` on sessions and bookmarks. A tag chip bar, filtering by tag, domain, date range, "has notes", "locked" and "archived".
- *Rationale:* Tab Session Manager, Toby and Workona users ask for it (Section 5.7).

**S3. Inactive-tab hygiene (never destructive)**
- **Auto-discard:**
  - Settings: "Unload tabs idle > N min". A `chrome.alarms` sweep every 1–5 min runs `tabs.query({ active: false, discarded: false, pinned: false, audible: false })`, filters by `lastAccessed` (121+), excluded origins and `autoDiscardable`, then calls `tabs.discard`. No new permission.
  - Caveat: extensions can't detect unsaved form input without content scripts and host permissions. Default to conservative timeouts and respect `autoDiscardable === false`.
- **Auto-archive (Arc and Tab Wrangler style):**
  - Opt-in. Tabs idle for more than N hours are saved into a dated "Auto-archived" session, then closed after the write succeeds, reusing the existing close-after-save safety checks.
  - Exclusions: pinned, grouped (optional), audible, split, excluded sites, and locked or whitelisted domains.
  - Optional `chrome.idle.onStateChanged`, to sweep only when the user is active, or to snapshot when the machine locks. New permission: `idle`.
- *Rationale:* Section 5.9 and the Arc model. Chrome Memory Saver has no timer.

**S4. Tab-group fidelity and group-level actions**
- Save and restore a group as a unit. Option to "save group on close": cache `groupId → {title,color,tabs}` from `tabs.onUpdated` and `tabGroups.onUpdated`, then save on `tabGroups.onRemoved`, because the tabs are gone by then.
- Restore into the existing group when one with the same title is open.
- *Limitation:* Chrome's *saved* (closed) groups aren't exposed in the documented `tabGroups` API, so TabNest can't import them directly (unverified that no private API exists).

**S5. Finish split view**
- Restore pairs with `tabs.create({ url, splitWithTabId, index })` or `tabs.createSplit([a, b])`. Detect with `typeof chrome.tabs.createSplit === "function"` (155+). Read `splitViewId` (140+).
- Respect the constraints: the tabs must be adjacent, not already split, and share pinned, window and group state. Otherwise fall back to adjacent tabs, which the existing `splitsSeparated` count already reports.
- Add an "Unsplit" action in the Tabs view (`tabs.unsplit`).
- No new permission.

**S6. Side Panel parity**
- Sessions list, open-tabs view (M4) and palette in the Side Panel. Drag from open tabs into sessions or bookmark columns.
- Open it on demand with `chrome.sidePanel.open({ windowId })`, which must be called during a user gesture.
- *Rationale:* Native vertical tabs (April 2026) take over the "tab list" role, so the panel's value has to be sessions plus bookmarks plus search.

**S7. Recently closed and other devices (read-only)**
- `chrome.sessions.getRecentlyClosed` (max 25) and `getDevices()`: Chrome's own synced tabs from the user's other devices, shown read-only. This adds a cross-device view **without any TabNest server**. New permission: `sessions`.

**S8. Optional mirror to browser bookmarks**
- One-way export of bookmark columns, and optionally sessions, into a "TabNest" folder via `chrome.bookmarks.create/update/remove`. Data then survives uninstalling and travels with the browser's own sync if the user has it on.
- The `bookmarks` permission is already granted.
- Clearly label it opt-in, and handle conflicts by overwriting the mirror only.

**S9. "Open URLs" and paste flows**
- A dialog that pastes a list of URLs or Markdown links and opens them in the current or a new window, or saves them as a session (BroTab `open`).
- Validate with the existing URL rules.

**S10. Clear trust documentation**
- An in-app "Privacy & permissions" page (README content), a no-network statement, and possibly a "Trust report" like Raft's, generated from tests asserting no `fetch` or `XMLHttpRequest` in the bundles.
- *Rationale:* Section 5.6 and the Great Suspender lesson.

### 8.3 Could

- **C1. Full-text page indexing (BroTab `index`, `search`, `text`, `html`):**
  - Behind `optional_permissions: ["scripting"]` and `optional_host_permissions: ["<all_urls>"]`, requested at runtime. `scripting.executeScript` extracts `document.body.innerText` from open tabs on demand, stored in IndexedDB with a local full-text index.
  - Off by default, because it changes the privacy story.
- **C2. Thumbnails:** `tabs.captureVisibleTab` (needs `activeTab` or host permission, and works only on the visible tab) for visual session cards. Rate-limited (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`).
- **C3. Smart grouping without the cloud:**
  - Heuristics by domain, opener (`openerTabId`) or time window.
  - Optionally Chrome's built-in on-device AI (Prompt API or Gemini Nano) where available. Availability and API stability should be checked before committing (unverified for extension service workers).
  - Never send titles or URLs off-device, unlike Chrome's Tab Organizer.
- **C4. Workspaces:** "Switch workspace" saves the current window to session A, closes it, and restores session B into the same window. Builds on the existing save, close and restore primitives (Workona, Vivaldi and Tab Session Manager offer this).
- **C5. Encrypted export:** WebCrypto AES-GCM with a PBKDF2 passphrase, for users who keep backups in cloud folders (Raft's model).
- **C6. Native-messaging bridge for a real CLI:**
  - `nativeMessaging` plus a small host that speaks BroTab-like commands over **stdio only**, with no HTTP listener. That keeps it local, unlike BroTab's mediator and `--target`, which were excluded.
  - Large install friction, so consider it only if CLI users ask.
- **C7. Read-later and reminders:** Snooze a tab or session until a date with `alarms` plus `notifications` (new permission).
- **C8. Stats:** Tabs saved, memory estimate, oldest open tabs. Low effort and motivating.
- **C9. Bring-your-own sync:**
  - Encrypted file in the user's Google Drive appData via `identity` (Raft), or a user-chosen folder via the File System Access API from an extension page. The directory handle is stored in IndexedDB, and permission must be re-granted with a user gesture.
  - Conflicts with the current "no sync" stance, so record it as future work only.
- **C10. Firefox build:** Firefox now has `tabs` group support (138), `tabGroups` (139, previewed) and the cross-vendor split API. A port would reach Sidebery and TST users, who are exactly the privacy-minded audience.

### 8.4 BroTab → TabNest mapping (server sync excluded)

| BroTab | What it does | TabNest today | Proposed TabNest equivalent | APIs | Priority |
|---|---|---|---|---|---|
| `list` | List all tabs (`prefix.window.tab`, title, URL) | ❌ (popup lists current window only) | Tabs view across all windows, plus "Copy list as text/Markdown" | `windows.getAll({populate})`, `tabs.query({})` | Must (M4) |
| `close <ids>` | Close tabs | ◐ (close-after-save only) | Multi-select close with undo | `tabs.remove`, `sessions.restore` | Must |
| `activate [--focused]` | Focus a tab (and window) | ◐ (single-tab restore can switch) | Click or Enter in Tabs view and palette | `tabs.update({active})`, `windows.update({focused})` | Must |
| `active` | Active tab per window | ❌ | Highlight the active tab per window; "jump to active" | `tabs.query({active:true})` | Must (trivial) |
| `query +/-flags -url -title …` | Filter tabs by properties | ❌ | Filter chips and query syntax mirroring `tabs.query` keys (active, pinned, audible, muted, highlighted, discarded, autoDiscardable, currentWindow, lastFocusedWindow, status, title, url, windowId, windowType, index) plus groupId and split | `tabs.query(queryInfo)` | Must |
| `index` / `search` | Full-text index (SQLite FTS5) of page text | ❌ | Title/URL/notes index now. Page text opt-in (C1) | IndexedDB; optional `scripting` and host permissions | Must (metadata) / Could (page text) |
| `open <window>` (stdin URLs) | Open many URLs | ◐ (bookmark "open all") | "Open URLs" paste dialog with window target | `tabs.create`, `windows.create` | Should (S9) |
| `new <query>` | New Google search tab | ❌ | Palette fallback: "Search the web for …" using the default engine | `search.query` (new `search` permission) or omnibox | Could |
| `navigate <tab> <url>` | Point a tab at a URL | ❌ | "Edit URL" on an open tab | `tabs.update({url})` | Could |
| `update` (JSON / `+muted` …) | Change tab properties | ❌ | Tab actions: pin, mute, discard, reload, toggle auto-discardable | `tabs.update`, `tabs.discard`, `tabs.reload` | Must (in M4) |
| `words` | Unique words for editor completion | ❌ | Not applicable to a GUI. Could expose "Copy unique words" if C1 lands | `scripting` | Won't (unless C1) |
| `text` / `html` | Dump page text or HTML | ❌ | "Copy page text" or "Export session with page text" (opt-in) | `scripting.executeScript` plus optional host permissions | Could (C1) |
| `dup` | How-to for closing duplicates | ◐ (save/restore/import duplicates) | One-click duplicate finder and closer for open tabs, keeping the most recent | `tabs.query`, `lastAccessed`, `tabs.remove` | Must (M4) |
| `windows` | Windows with tab counts | ❌ | Window headers with counts, names (TabNest-side), focus, close, merge windows | `windows.getAll`, `tabs.move` | Must |
| `clients` | List connected browsers or mediators | ❌ | Not applicable (single profile). Read-only "Other devices" from Chrome sync (S7) | `sessions.getDevices` | Should (S7) |
| `move` (edit in `$EDITOR`) | Reorder, close or re-window tabs by editing text | ❌ | **"Edit as text" mode:** a textarea with one tab per line under `# Window N` headers. Reordering, deleting or moving lines then pressing Apply runs a computed diff, with preview and undo. Plus drag-and-drop | `tabs.move`, `tabs.remove`, `windows.create` | Should |
| `screenshot` | Base64 PNG of the visible tab | ❌ | Session thumbnails (C2) | `tabs.captureVisibleTab` | Could |
| `install` / native mediator / `--target host:port` | Native messaging plus local HTTP for remote control | ❌ | **Excluded (server sync and remote control).** Optional stdio-only native host for a CLI later (C6) | `nativeMessaging` | Excluded / Could |
| fzf / rofi / Albert integration | Fuzzy pickers | ❌ | Command palette plus omnibox (M5) | `omnibox`, `commands` | Must |

---

## 9. Pitfalls and lessons from failed or abandoned tools

1. **Ownership transfer → malware (The Great Suspender, 2020–21).** The tool was sold to an unknown party, remote code was added, and Google force-disabled it. Users lost tabs because suspended tabs were URLs of the extension's own pages, which vanished with it.
   - *Lessons:* Use **native `tabs.discard`**, never wrapper pages, so tabs survive the extension. Keep zero remote code (MV3 enforces this, and TabNest already bundles everything). Make provenance and ownership visible. Treat permission growth as a trust event.
2. **Local data loss blamed on the extension (OneTab, Tab Session Manager, Session Buddy).** Causes include cleaners, Firefox "Refresh", uninstalling, disk issues, corrupted databases, and the tools' own bugs.
   - *Lessons:* Automatic external backups (M1), visible "last backup" status, an uninstall warning in Help, and recovery documentation.
3. **Forced storage migrations.**
   - Session Buddy had to leave Web SQL and set a hard date: "if you wait until after March 1, 2024 to upgrade your browser, you will lose all of your Session Buddy saved sessions".
   - OneTab v2's migration timed out for large datasets and needed console steps.
   - *Lessons:* Use only stable storage (`chrome.storage.local`, IndexedDB). Make migrations chunked, resumable and verified. Keep the old copy until the new one is verified. Back up before migrating (M7).
4. **MV3 lifecycle traps.**
   - Service workers stop after about 30 s idle, so in-memory maps of tabs or timers disappear. Rebuild them from `tabs.query`.
   - Alarms have a 30 s minimum (Tab Session Manager had to raise its auto-save floor to 0.5 min). Alarm persistence across restarts is only guaranteed from Chrome 150, so re-register on startup.
   - `storage.sync` is about 100 KB total and 8 KB per item, far too small for sessions.
   - Tab Wrangler's MV3 port briefly lost locked tabs on restart.
   - *Lessons:* Persist all state. Make every handler idempotent. Test worker restarts in the existing Node VM harness.
5. **Paywall shifts and lock-in (Workona 2021, Toby's 60-tab cap, Partizion's account deletion after trial).**
   - *Lessons:* Never hold data hostage. Export must always work (Toby got this right). A free local tool should advertise "no caps, no account".
6. **Abandonment (Better OneTab archived 2025, Raft archived 2026, Tabli and Tab Manager Plus slow, Arc in maintenance mode).**
   - *Lessons:* Users need data in **open formats** they can carry to the next tool (M6). Keep the codebase testable so it stays maintainable. Avoid depending on a server you pay for.
7. **Copycats and name confusion ("OneTab Plus" clones, one flagged as malicious).**
   - *Lessons:* Use distinctive naming, publish a canonical store link, and consider publishing the source.
8. **Surprising destructive defaults.** OneTab closing tabs on save triggered "got rid of all my saved tabs". Chrome's "Delete group" removes the group on all devices.
   - *Lessons:* Clear wording, confirmation for bulk and destructive actions, and undo everywhere (M2). TabNest's "remove only tabs that opened" and the pinned-tab re-check are good examples to extend.
9. **Restore storms.** Session Buddy restores spike RAM and crash Chrome.
   - *Lessons:* Batch restores, open background tabs unloaded, and offer "open as unloaded" for big sessions (partly done).
10. **Platform features overtaking extensions.** Chrome vertical tabs, split view, saved groups and Memory Saver; Firefox groups; Edge Workspaces.
    - *Lessons:* Don't compete with the tab strip. Add what browsers lack: cross-session archive, search across everything, portable files, notes, bookmarks and dashboards. Integrate with native groups and split view instead of replacing them.
11. **AI features and privacy.** Chrome's Tab Organizer is US-only, needs sign-in, and collects titles and URLs. Firefox's is on-device.
    - *Lesson:* If TabNest adds smart grouping, keep it on-device or heuristic, and say so.

---

## 10. Sources

### Official product pages, store listings and docs
- OneTab: https://www.one-tab.com/ · Troubleshooting (v1/v2, data loss): https://www.one-tab.com/troubleshooting · Chrome Web Store: https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall · Reviews: https://chromewebstore.google.com/detail/onetab/chphlpgkkbolifaimnlloiipkdnihall/reviews · AMO 1★ reviews: https://addons.mozilla.org/en-US/firefox/addon/onetab/reviews/?score=1
- "OneTab Plus" listings: https://firefox-stats.com/d/onetab-plus · https://extensionauditor.com/scan/onetab-plus-memory-saver-abigbbblmfhbgbjjdolageghdkdibeap · https://chrome.google.com/webstore/detail/onetab-plustab-manage-pro/lepdjbhbkpfenckechpdfohdmkhogojf
- ONETAB trademark filing: https://trademarks.justia.com/984/10/onetab-98410272.html
- Better OneTab (archived): https://github.com/cnwangjie/better-onetab
- Tab Session Manager: https://github.com/sienori/Tab-Session-Manager · AMO: https://addons.mozilla.org/en-US/firefox/addon/tab-session-manager/ · AMO 2★ reviews: https://addons.mozilla.org/en-US/firefox/addon/tab-session-manager/reviews/?score=2 · Chrome Web Store: https://chromewebstore.google.com/detail/tab-session-manager/iaiomicjabeggjcfkbimgmglanimpnae
- Session Buddy v4: https://sessionbuddy.com/v4 · v3 deprecation: https://sessionbuddy.com/?p=5630 · Chrome Web Store reviews: https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko/reviews
- Toby: https://www.gettoby.com/ · Pricing: https://www.gettoby.com/pricing · Free plan: https://help.gettoby.com/support/solutions/articles/66000519429-free-plan · Chrome Web Store reviews: https://chromewebstore.google.com/detail/toby-for-chrome/hddnkoipeenegfoeaoibdmnaalmgkpip/reviews · AMO 1★: https://addons.mozilla.org/en-US/firefox/addon/toby-for-tabs/reviews/?score=1 · Product Hunt: https://www.producthunt.com/products/toby/reviews
- Workona: https://workona.com/ · Pricing: https://workona.com/pricing/ · Billing help: https://www.workona.com/help/subscriptions-billing/ · CEO apology (2021): https://workona.com/blog/update-to-premium-plans/ · Chrome Web Store reviews: https://chromewebstore.google.com/detail/workona-spaces-tab-manager/ailcmbgekjpnablpdkmaaccecekgdhlh/reviews · Product Hunt: https://www.producthunt.com/products/workona/reviews · OneTab-recovery blog (vendor): https://workona.com/blog/one-tab-extension-lost-all-tabs/
- Tabs Outliner: https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl · Support/reviews: https://chrome.google.com/webstore/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl/support
- Tab Manager Plus: https://github.com/stefanXO/Tab-Manager-Plus
- BroTab: https://github.com/balta2ar/brotab · README: https://raw.githubusercontent.com/balta2ar/brotab/master/README.md · CLI source: https://raw.githubusercontent.com/balta2ar/brotab/master/brotab/main.py · PyPI: https://pypi.org/project/brotab/ · Stats: https://awesome.ecosyste.ms/projects/github.com%2Fbalta2ar%2Fbrotab
- Tabli: https://github.com/antonycourtney/tabli
- Partizion: https://chromewebstore.google.com/detail/ldimfpkkjopddckaglpeakpaepclcljn · "Why no free plan": https://www.partizion.io/free-plan · Competitor comparison (biased): https://www.superchargebrowser.com/library/supercharge-navigation-vs-partizion/
- TabExtend: https://www.alternativeto.net/software/tabextend/about/ · https://www.capterra.com/p/236868/tabExtend/
- Raindrop.io: https://raindrop.io/pro/buy · https://help.raindrop.io/premium-features · https://help.raindrop.io/full-text-search
- Bonjourr: https://bonjourr.fr/ · https://chrome.google.com/webstore/detail/bonjourr/dlnejlppicbjfcfcedcflplfjajinajd · Momentum: https://momentumdash.com/blog/plus-overview · https://chromewebstore.google.com/detail/gkkgbapmmffohbhhkppljfmcmopbhlgi
- Arc auto-archive: https://resources.arc.net/hc/en-us/articles/19228855311127 · Release notes Dec 2021: https://resources.arc.net/hc/en-us/articles/20498463803799 · Status (secondary): https://tidbits.com/2025/07/03/do-you-use-it-browser-tab-management/ · https://www.superchargebrowser.com/library/arc-browser-status-2026/
- Vivaldi: https://vivaldi.com/features/tab-management/ · https://vivaldi.com/press/vivaldi-browser-tabs-two-level/
- Chrome help, tab groups: https://support.google.com/chrome/answer/2391819 · Tab organizer: https://support.google.com/chrome/answer/14519765 · Vertical tabs: https://techcrunch.com/2026/04/07/chrome-is-finally-getting-vertical-tabs/ · https://chromeunboxed.com/google-is-officially-rolling-out-native-vertical-tabs-to-the-stable-version-of-chrome/ · Gemini group experiment: https://www.androidheadlines.com/2026/07/chrome-is-about-to-make-tab-groups-much-smarter-with-gemini.html · Saved-group sync setting: https://chromestory.com/2026/09/chrome-tab-groups-not-syncing/
- Chrome extension APIs: Split View blog: https://developer.chrome.com/blog/split-view-api-extensions · tabs: https://developer.chrome.com/docs/extensions/reference/api/tabs · tabGroups: https://developer.chrome.com/docs/extensions/reference/api/tabGroups · alarms: https://developer.chrome.com/docs/extensions/reference/api/alarms · sessions: https://developer.chrome.com/docs/extensions/reference/api/sessions · storage: https://developer.chrome.com/docs/extensions/reference/api/storage · service-worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Edge Workspaces V2: https://chromestory.com/2026/06/edge-workspaces-v2-what-changed/ · https://learn.microsoft.com/en-us/answers/questions/5825522/workspaces-are-gone-with-the-new-update · https://windowsnews.ai/article/microsoft-edge-150-kills-app-tower-and-workspace-sharing-what-you-lose-and-how-to-get-ready.439276
- Firefox: Tab groups help: https://support.mozilla.org/kb/tab-groups · AI-enhanced groups: https://support.mozilla.org/en-US/kb/how-use-ai-enhanced-tab-groups · WebExtensions support for tab groups: https://blog.mozilla.org/addons/2025/04/30/webextensions-support-for-tab-groups/ · Vertical tabs in 136: https://connect.mozilla.org/t5/discussions/sidebar-and-vertical-tabs-launch-in-release-136/m-p/95523 · AlternativeTo news: https://alternativeto.net/news/2025/4/firefox-has-finally-added-tab-groups-something-that-s-been-missing-for-years
- Sidebery: https://github.com/mbnuqw/sidebery · https://addons.mozilla.org/en-US/firefox/addon/sidebery/
- Tree Style Tab: https://addons.mozilla.org/en-US/firefox/addon/tree-style-tab/
- Auto Tab Discard: https://chromewebstore.google.com/detail/auto-tab-discard-suspend/jhnleheckmknfcgijgkadoemagpecfol
- Tab Wrangler: https://addons.mozilla.org/firefox/addon/tabwrangler/ · Releases: https://github.com/tabwrangler/tabwrangler/releases?page=2
- Raft: https://github.com/raftapp/raft
- Tab Atlas: https://chromewebstore.google.com/detail/tab-atlas-visual-tab-mana/jimgeefcpapoihnidlnojegpebpcnfgp · TabSearch: https://www.producthunt.com/products/tabsearch-privacy-first-tab-manager/launches/tabsearch

### The Great Suspender incident
- https://9to5google.com/2021/02/04/the-great-suspender-extension-has-been-removed-from-chrome-web-store-for-containing-malware/
- https://thehackernews.com/2021/02/warning-hugely-popular-great-suspender.html
- https://www.bleepingcomputer.com/news/security/the-great-suspender-chrome-extensions-fall-from-grace/
- https://www.tomsguide.com/news/chrome-great-suspension
- HN, "I no longer trust The Great Suspender": https://news.ycombinator.com/item?id=25846504 · "New maintainer is probably malicious": https://news.ycombinator.com/item?id=25622015

### User discussions
- HN, "Ask HN: How do you manage too many open tabs?" (2026-07): https://news.ycombinator.com/item?id=48934898
- HN, "Show HN: Advanced Tab Manager for Firefox" (Grasshopper, 2023): https://news.ycombinator.com/item?id=37306058
- HN, OneTab data-loss comment (2015): https://news.ycombinator.com/item?id=9581723 · OneTab sync comment: https://news.ycombinator.com/item?id=9690276
- HN, Show HN Raft: https://news.ycombinator.com/item?id=47073949 · Tab Atlas: https://news.ycombinator.com/item?id=49660702 · Tab-da: https://news.ycombinator.com/item?id=48831435 · Tabernacle: https://news.ycombinator.com/item?id=50071090 · WorkTab: https://news.ycombinator.com/item?id=46162100 · Side Space: https://news.ycombinator.com/item?id=44948022 · VertiTab 3.0: https://news.ycombinator.com/item?id=44793229 · Partizion "no free plan": https://news.ycombinator.com/item?id=41848941
- HN Algolia searches used: https://hn.algolia.com/api/v1/search?query=tab%20manager&tags=story · https://hn.algolia.com/api/v1/search?query=too%20many%20tabs&tags=story · https://hn.algolia.com/api/v1/search?query=onetab&tags=comment
- Tildes, "100s of tabs, what is there": https://tildes.net/~comp/dmf/100s_of_tabs_what_is_there
- Vivaldi forum, "How best to manage large numbers of tabs?": https://forum.vivaldi.net/topic/32317/how-best-to-manage-large-numbers-of-tabs

### Roundups and secondary sources (vendor-authored, used with caution)
- https://www.rabbitpair.com/en/blog/10-best-tab-manager-chrome-extensions-2025 (VertiTab vendor)
- https://supasidebar.com/blog/toby-alternatives-chrome-2026 · https://supasidebar.com/blog/workona-alternative-tab-workspace-2026 (SupaSidebar vendor)
- https://www.superchargebrowser.com/library/best-tab-suspender-extensions-chrome-2026/ · https://www.superchargebrowser.com/library/tab-suspender-vs-chrome-memory-saver/ (SuperchargeBrowser vendor)
- https://northlabapps.com/blog/session-buddy-data-recovery/ (vendor)
- https://nestextended.com/onetab-alternative/ (vendor)
- https://www.alternativeto.net/software/onetab/ · https://www.saasworthy.com/product/workona/reviews · https://g2.com/products/workona/reviews
- MV3 orphaned-tab write-up: https://taprun.dev/blog/mv3-orphan-tabs-fix.html
