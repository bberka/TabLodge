# Mobile app / link-saving opportunity for TabLodge

_Research memo, 2026-10-26. No code was written or changed. Sections marked **Source facts** are claims taken from the cited pages. Sections marked **Assessment** and **Recommendation** are judgment. The final section lists what the sources did not settle. Since this memo was written, TabLodge has launched in the Chrome Web Store. Store distribution is no longer a prerequisite to testing user interest, though the project still has no analytics._

## 1. Bottom line

**Recommendation: stay extension-first for now (option 3).** Spend a small, time-boxed effort testing whether TabLodge users want a phone handoff (option 1 in its lightest form). Do not pivot to a read-it-later or bookmark-manager product (option 2).

- TabLodge's distinctive value is desktop tab and window fidelity: native tab groups, split view, crash snapshots and restore. Those have no counterpart on a phone.
- The part of TabLodge that does translate to a phone is a list of links. That is where Raindrop, Instapaper, Readwise Reader and Karakeep already compete, with generous free tiers.
- Any cross-device sync breaks TabLodge's current promise of no accounts, servers or network requests. Under the current architecture that promise is the product, so sync should be a deliberate, separate decision.
- When this memo was written, TabLodge was not in any extension store. It is now available in the Chrome Web Store, but the project still has no analytics to measure demand with.

## 2. What TabLodge is today (repo facts)

- **Product.** A Manifest V3 extension for Chromium desktop browsers that saves sessions and shows a bookmark board on the new tab. It has no accounts, servers, analytics or network requests (`README.md`, `PRIVACY.md`).
- **Storage.** Everything lives in `chrome.storage.local` under `tablodge.state` (schema v7), plus separate keys for snapshots, backups, trash and undo. "There are no accounts, servers, or cloud sync" (`docs/architecture.md`, "Data model and storage").
- **Data model** (`src/app/types.ts`).
  - `SavedTab` holds `title`, `url`, `notes`, `pinned`, `nativeGroup`, `savedAt`, `originalIndex` and an optional `split`.
  - `Session` holds folder, description, timestamps and its tabs.
  - `Bookmark` holds `title`, `url`, `columnId` and timestamps.
  - There is no page content, reading state, tags, highlights or archived copy.
- **Permissions.** `tabs`, `tabGroups`, `bookmarks`, `favicon`, `storage`, `unlimitedStorage`, `contextMenus`, `clipboardWrite`, `sidePanel`, `search` and `alarms`, plus optional `downloads`. There are no host permissions and no content scripts, so TabLodge never reads page text (`extension/manifest.json`, `README.md`).
- **Portability already in place.** Session and bookmark JSON, a full-backup ZIP, a shareable HTML page, and import of browser bookmarks and other tab managers. Import "recognizes backups by structure, not by this id" (`docs/architecture.md`, "Persistent identifiers"). This matters for the MVP path in section 7.
- **Existing positioning research.** `docs/tab-management-research.md` already treats server sync as excluded or "future work only" (C9). It records that `storage.sync` is about 100 KB total and too small for sessions (section 9.4), and it lists Chrome's `sessions.getDevices` as a server-free read-only "other devices" view (S7).
- **Maintainer.** `package.json` lists a single author. I assumed solo-maintainer capacity when judging effort.

## 3. Source facts: platforms and browsers

### Extensions on mobile browsers

| Platform | What the first-party source says | Source |
|---|---|---|
| **Safari on iOS** | A Safari web extension must be implemented as an app extension, so installing it means installing its app. Apple's docs describe distribution through the Apple Developer Program and App Store. Supported on iOS 15+. | [Safari web extensions](https://developer.apple.com/tutorials/data/documentation/safariservices/safari-web-extensions.md), [WWDC21 10104](https://developer.apple.com/videos/play/wwdc2021/10104/) |
| | On iOS, `windows.create`, `remove` and `update` aren't supported. `contextMenus`/`menus` aren't supported. `tabs` needs host permission. `storage.sync` is implemented "but syncing not supported". `identity` isn't supported. Background pages must be non-persistent. `tabs.move` isn't supported. Local storage is 5 MB, or unlimited from Safari 16 when the extension asks for it. | [Assessing browser compatibility](https://developer.apple.com/tutorials/data/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility.md) |
| | `windows.onRemoved` doesn't fire when the user closes Safari from the app switcher. Each Safari scene has one regular and one Private window. | [WWDC21 10104](https://developer.apple.com/videos/play/wwdc2021/10104/) |
| | Installing and enabling an extension syncs across a user's devices (Safari 16+). That is install state, not extension data. | [Syncing Safari web extensions](https://developer.apple.com/tutorials/data/documentation/safariservices/syncing-safari-web-extensions-across-devices-and-platforms.md) |
| | The containing app and its extension are sandboxed separately and share data only through app groups. A containing iOS app can't send messages to the extension's JavaScript. | [Messaging between the app and JavaScript](https://developer.apple.com/tutorials/data/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension.md) |
| **Firefox for Android** | Supports a subset of WebExtensions. Not supported: bookmarks, history, sessions, windows, `chrome_url_overrides` (no custom new tab), `commands`, `menus`, native messaging. Sync storage isn't synced with the user's Mozilla account. Idle extension processes can be killed. | [Extension Workshop: desktop vs. Android](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/) |
| **Chrome for Android** | I found no first-party statement that Chrome for Android supports extensions. Press coverage says it doesn't, and that Google is testing extensions only in "desktop" Android builds. This is secondary sourcing only. | [Chrome Unboxed](https://chromeunboxed.com/a-development-version-of-chrome-for-android-now-supports-extensions), [Android Authority](https://www.androidauthority.com/chrome-for-android-with-extensions-demo-3540132) |

**Assessment.**
- Today's TabLodge is built on `tabs`, `tabGroups`, `windows` (restore into a new window), `contextMenus`, `sidePanel` and a new-tab override. Firefox for Android's documented gaps cover several of these, and Safari on iOS lacks others.
- So a mobile-browser port would be a different, much smaller product, not a recompile. A Safari-on-iOS port needs a full Apple app, a paid developer account and App Review.
- Safari's handling of `tabGroups` and `sidePanel` wasn't settled by the pages I read.

### Share sheets, intents and getting data in

- **Android.** An activity declares an `ACTION_SEND` intent filter for `text/plain`, then appears in the system share sheet. It reads the shared URL from `EXTRA_TEXT`. Android's guidance is to let users confirm and edit shared content and to validate it. ([Receive simple data from other apps](https://developer.android.com/training/sharing/receive))
- **iOS.** `UIActivityViewController` is the standard share UI. Apps receive shares through a Share extension that reads the `NSExtensionContext`'s attachments, such as links. Apple's guide calls for a size-constrained UI, a background-mode URL session for uploads, and being "prepared to be terminated by the system". The pages I read don't give memory or time limits. ([UIActivityViewController](https://developer.apple.com/tutorials/data/documentation/uikit/uiactivityviewcontroller.md), [App Extension Programming Guide: Share](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html))
- **Assessment.** "Save from any app" is a platform-native capability on both OSes. It is what makes Pocket-style capture work, and it needs no browser extension. It also means a companion app's capture path is cheap to build and doesn't depend on the extension.

### Browser history and tab access from outside the browser

- Within a Chromium extension, `chrome.tabs` exposes `url` and `title` only with the `tabs` or host permission ([chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)).
- `chrome.sessions` (permission `sessions`) offers `getDevices()` for "devices with synced sessions" and `getRecentlyClosed()`, which is capped at 25 results. `onChanged` doesn't track synced-session changes ([chrome.sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions)).
- Chrome syncs and saves tab groups across devices signed into the same Google Account. Deleting a group removes it on all those devices ([Chrome Help: tab groups](https://support.google.com/chrome/answer/2391819)).
- **Not settled:** I found no first-party documentation of any API that lets a third-party iOS or Android app read the tabs or history of the user's browser. I treat that as unavailable for planning, but this is an absence of evidence, not a documented prohibition. Safari-extension bookmarks and history support rests only on undated Apple forum replies ([bookmarks thread](https://developer.apple.com/forums/thread/721635)).
- **Assessment.** A native companion therefore can't mirror "what's open on my desktop". It only sees what the user shares to it, what is synced into it, and what a desktop extension hands it.

### Sync building blocks

- **`chrome.storage.sync`:** 102,400 bytes total, 8,192 bytes per item, 512 items, and write limits of 120 per minute and 1,800 per hour. `storage.local` is 10 MB unless `unlimitedStorage` is granted ([storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)). This is too small for sessions.
- **Google Drive `appDataFolder`:** a hidden, app-only folder, with the `drive.appdata` scope listed as non-sensitive. It is deleted when the user uninstalls the app from Drive. Whether it counts against the user's quota wasn't stated on the page ([Drive appdata](https://developers.google.com/workspace/drive/api/guides/appdata)).
- **`chrome.identity`:** `getAuthToken` uses OAuth scopes declared in the manifest, and `launchWebAuthFlow` supports other providers ([chrome.identity](https://developer.chrome.com/docs/extensions/reference/api/identity)). Safari doesn't support `identity` (compatibility page above).
- **CloudKit:** stores app records in iCloud containers. The framework lists Apple platforms only and "relies on the presence of the network" ([CloudKit](https://developer.apple.com/tutorials/data/documentation/cloudkit.md)). The Developer Program page lists "up to 1 PB of free storage per app" ([Apple Developer Program](https://developer.apple.com/programs/whats-included/)).
- **Assessment.** A server-free sync story would be one of three things:
  - user-held files (the existing export and import);
  - a per-ecosystem store (Drive on Android and Chrome, iCloud on Apple), which means separate implementations with different conflict and deletion behavior;
  - an operated backend, which means accounts, cost, support and a privacy-policy rewrite.

  Each of the three is a new product decision, not a feature.

### Store rules and costs

- **Apple.** The Developer Program costs US$99 per year. The commission is 30%, or 15% for the Small Business Program and for qualifying subscriptions ([Apple](https://developer.apple.com/programs/whats-included/)). App Review Guideline 4.2.2 says apps "shouldn't primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links". If an app supports account creation it must offer in-app account deletion (5.1.1(v)) ([Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **Google Play.** A one-time US$25 registration fee applies. Personal accounts created after 2023-11-13 must meet testing requirements before publishing ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/6112435)).
- **Assessment.** A bare link list is the kind of app Guideline 4.2.2 names, so an iOS app needs real utility beyond listing links. That is a real review risk for a thin "saved links" companion.

## 4. Source facts: competitor positioning

Pages were fetched 2026-10-26. A page that doesn't say something doesn't prove it's absent.

| Product | Positioning and platforms | Free vs. paid (as stated) | Source |
|---|---|---|---|
| **Raindrop.io** | "All-in-one bookmark manager". Mac, iOS and Android apps. Chrome, Safari, Firefox and Edge extensions. Web app. | Free: unlimited bookmarks, collections, highlights and devices; import and export; sharing; 100 MB uploads per month. Pro: full-text search, permanent copies, duplicate and broken-link finder, daily backups, reminders, annotations, AI features, MCP. The Pro price isn't shown on the page. | [raindrop.io/pro/buy](https://raindrop.io/pro/buy) |
| **Instapaper** | Save articles and read later. iPhone, iPad, Android and web. | Free: unlimited saving, sync across web, iOS and Android, folders, API. Premium is $5.99/month or $59.99/year: full-text search, permanent archive, unlimited notes, Kindle, text-to-speech. | [instapaper.com/premium](https://www.instapaper.com/premium) |
| **Readwise Reader** | "Read-it-later app built for power readers". iOS, Android, web, desktop and browser extensions. Highlighting, RSS, newsletters, PDFs and AI. | Free 30-day trial, then $9.99/month billed annually or $12.99/month billed monthly. | [readwise.io/read](https://readwise.io/read) |
| **Karakeep** | Open-source, self-hostable "bookmark everything" app with an optional hosted cloud. iOS and Android apps, extensions for Chrome, Firefox and Safari. AI tagging, full-text search, OCR, reader view. | Cloud: "Free to try". Plan details aren't on the page. | [karakeep.com](https://karakeep.com/) |
| **Toby** | "All your resources. In one place." Spaces and Collections, sharing, sync. Extensions for Chrome, Firefox and Edge, with iOS and Android apps linked in the footer. | Paid tiers aren't described on the home page. | [gettoby.com](https://gettoby.com) |
| **Workona** | Tab manager organized by project. Chrome, Firefox and Edge extensions. The page mentions no mobile apps. Cross-device sync, cloud backups. | Pricing isn't shown on the page. | [workona.com](https://workona.com) |
| **Pocket** | Mozilla is shutting it down, including web, Android, iOS, macOS and extensions. | n/a | [getpocket.com](https://getpocket.com) |

- **Pocket's dates.** A web search summary of Mozilla's support article gives a July 8, 2025 shutdown with export-only mode afterward, and a data-export end around November 12, 2025. I couldn't open the support page directly, so I treat the exact dates as likely rather than confirmed ([support.mozilla.org/kb/future-of-pocket](https://support.mozilla.org/kb/future-of-pocket)).
- **Omnivore.** Press reports say its hosted service shut down after ElevenLabs took the team, with a November 15, 2024 export deadline ([Heise](https://heise.de/-9998733)). That is secondary sourcing. I didn't verify the official notice.
- **Assessment.** Free tiers with unlimited saving and sync are common (Raindrop, Instapaper). Competitors differentiate on paid extras: search, archive, backup and AI. Two read-it-later services closing recently shows that operating one is not safe from abandonment. It also gives a local-first, portable-data story something to point at. I make no claim about market size or demand.

## 5. Option assessment

| | 1. Native companion for saved links and sessions | 2. Pivot to cross-device read-it-later / bookmark manager | 3. Stay extension-first |
|---|---|---|---|
| **What it is** | A phone app that views and opens TabLodge's sessions and bookmarks and can capture links through the share sheet. Phone to desktop through files or a sync layer. | Cloud-synced links with capture on every platform, probably adding page content, archive, search and tags. | Keep improving the desktop extension. Add only server-free portability. |
| **Fit with today's product** | Medium. It reuses the data model, but a phone has no windows or groups to restore. | Low. It needs page-content access (TabLodge has no host permissions), an archive, accounts and a server. | High. |
| **Privacy and trust claims** | Intact if file-based. Broken if it uses a server. | Broken. Content and URLs would be stored on a server, so PRIVACY.md and the "no network" claim would need a rewrite. | Intact. |
| **New cost and risk** | A second codebase, a $25 Google Play fee and testing rules, a $99/year Apple fee and App Review (4.2.2 on a thin link list). | All of option 1, plus backend, account deletion, abuse handling, ongoing hosting, and head-to-head competition with products that have free unlimited tiers. | Low. |
| **Differentiation** | Weak unless the companion adds a capability others don't have. | Weak. Raindrop, Instapaper, Readwise and Karakeep already cover this ground. | Strong on desktop: groups, split view, crash recovery, local-only. |
| **Evidence of demand in the repo** | None. `docs/tab-management-research.md` lists sync as "wanted but distrusted" (5.5) and says no sync is acceptable if files move easily. | None for TabLodge. The research file notes bookmark-manager "overkill for transient tabs". | The research file's priority list is all desktop. |
| **Verdict** | **Test cheaply first.** | **Not recommended.** | **Default.** |

**Why not option 2.** It needs the three things TabLodge deliberately avoids (accounts, a server, page access). It also puts a single maintainer up against funded products with generous free plans. The Pocket and Omnivore closures show that running such a service is a long-term commitment. If TabLodge ever wants a read-later feature, a smaller version is a "read later" flag on a bookmark, kept local.

## 6. Recommendation (judgment)

1. **Keep TabLodge extension-first and desktop-first.** The Chrome Web Store launch is complete. Use user feedback to judge whether distribution on other stores, such as Edge Add-ons, is worth pursuing before adding mobile work to the roadmap.
2. **Run a small, time-boxed demand check for a phone handoff** before any mobile code. That is section 7.
3. **Defer sync.** If it ever happens, make it opt-in, user-held and end-to-end encrypted (research item C5/C9), with the file as the source of truth. Update `PRIVACY.md`, the README, the site and the in-app Help in the same change, per `AGENTS.md`.
4. **Don't build for Safari on iOS or Firefox for Android now.** Per section 3 they lack APIs TabLodge's core depends on, and Safari needs a full app and the Apple developer program. Revisit if desktop Firefox support (research item C10) lands first.

## 7. Validation and MVP path

Each stage ends in a go or no-go. Stop at the first no-go.

**Stage 0: publish and listen (no mobile code).**
- The Chrome Web Store launch is complete. Listen for user feedback and keep a "phone / mobile" label on GitHub issues.
- Add a short, optional, user-initiated feedback prompt in Help or on the site, such as "Would you use this on your phone?" with a free-text field. Don't add analytics. TabLodge's no-telemetry stance is part of its value.
- Decide the timebox up front, for example 8 to 12 weeks after the Chrome Web Store launch.

**Stage 1: phone handoff with what exists.**
- Test whether the shareable HTML page of selected sessions and the existing exports are enough to carry a list to a phone. Make sure that page reads well on a small screen.
- Prior art to beat: sending yourself a link by message or email, and Chrome's own tab sync, which `chrome.sessions.getDevices` can already surface read-only with a new `sessions` permission (research item S7).

**Stage 2: thinnest native prototype, Android only, no server.**
Only if the Stage 0 and 1 criteria below are met.
- An app with an `ACTION_SEND` target for `text/plain`, a local link list and tap-to-open.
- It writes TabLodge's bookmark JSON format so the extension's existing import takes phone-saved links, and it imports TabLodge's JSON or ZIP backups for viewing.
- Hand-carry through a file in the user's own cloud folder, with no TabLodge-operated service.
- Android first because the intent filter and a $25 one-time fee are the cheapest path. It also avoids iOS review risk until there is evidence the companion is useful.
- Start with a PWA or web viewer if installability is acceptable. Whether a PWA can register as a share target wasn't researched here.

**Stage 3: iOS and sync decisions.**
Only after Stage 2 shows repeated use. Choose between Share extension plus app groups for capture and iCloud/Drive or user-held files for sync. Re-read Guideline 4.2.2 against the app as it stands.

### Decision criteria

These thresholds are suggestions. They are judgment calls, not benchmarks from the sources.

- **Proceed to Stage 2** only if:
  - several unprompted users, not just the maintainer, ask for phone capture or viewing, and
  - their answers describe link capture or viewing rather than a request for sync of everything, and
  - the Stage 1 handoff has clearly been tried and found too clumsy.
- **Proceed to Stage 3** only if Stage 2 users keep using it across several weeks and ask for automatic sync. Re-check that the sync design doesn't require an account, a server or telemetry. If it does, treat that as a separate go or no-go on abandoning the local-only promise.
- **Stop** if demand is mostly "just tell me my desktop tabs on my phone". Chrome's own tab sync and `sessions.getDevices` serve that, so the answer is a small `sessions` feature, not an app.
- **Never start option 2** without a reason to bear hosting, support and competition costs. Neither the repo nor the sources provide one.

## 8. Risks

- **Scope creep and maintenance.** A second platform and its release process double the surface for a small project.
- **Trust break.** Any network use contradicts the README, `PRIVACY.md`, store listing and site copy. Mistakes there are costly.
- **App Store friction.** Guideline 4.2.2 and a paid developer account. Safari-extension APIs for bookmarks and history are unverified.
- **Data loss through sync.** The research file records sync deleting data (Chrome's group deletion, Workona) as a top complaint. A conflict model would be needed.
- **Crowded category.** Free unlimited tiers from established products.
- **Mobile browser reality.** Chrome for Android has no documented extension support. Firefox for Android drops bookmarks, sessions, windows and new-tab override.

## 9. Non-goals

- No server, account system, telemetry or ads.
- No page-content capture or archive. That would need host permissions TabLodge intentionally lacks.
- No attempt to read or restore the phone browser's tabs.
- No port to Safari on iOS or Firefox for Android in this effort.
- No claim to replace Raindrop, Instapaper or Pocket. TabLodge isn't a read-later product.

## 10. Not settled by the sources

- Whether any API lets a third-party iOS or Android app read the user's browser tabs or history. I found none documented, but I didn't find a clear prohibition either.
- Whether Safari on iOS supports `tabGroups`, `sessions` and `sidePanel`, and exactly how its new-tab override behaves there. Apple's compatibility page doesn't list them.
- Apple's current memory and time limits for Share extensions. The pages read don't state them.
- Whether Chrome for Android will gain extensions. Only press coverage exists.
- The exact Pocket and Omnivore shutdown dates. The Pocket support page didn't load directly, and Omnivore's dates come from press coverage.
- Raindrop and Toby paid prices, and any figure on how many TabLodge users want mobile. No usable first-party data was found, and the repo has no analytics.
- Whether a PWA is an adequate share target on Android and iOS. Not researched.

## Sources

- Repo: `README.md`, `PRIVACY.md`, `docs/architecture.md`, `docs/tab-management-research.md`, `extension/manifest.json`, `src/app/types.ts`
- Apple: [Safari web extensions](https://developer.apple.com/tutorials/data/documentation/safariservices/safari-web-extensions.md) · [Browser compatibility](https://developer.apple.com/tutorials/data/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility.md) · [Syncing](https://developer.apple.com/tutorials/data/documentation/safariservices/syncing-safari-web-extensions-across-devices-and-platforms.md) · [App/extension messaging](https://developer.apple.com/tutorials/data/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension.md) · [WWDC21 10104](https://developer.apple.com/videos/play/wwdc2021/10104/) · [UIActivityViewController](https://developer.apple.com/tutorials/data/documentation/uikit/uiactivityviewcontroller.md) · [Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html) · [CloudKit](https://developer.apple.com/tutorials/data/documentation/cloudkit.md) · [Developer Program](https://developer.apple.com/programs/whats-included/) · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Bookmarks API forum thread](https://developer.apple.com/forums/thread/721635)
- Android and Google: [Receive simple data](https://developer.android.com/training/sharing/receive) · [Play Console registration](https://support.google.com/googleplay/android-developer/answer/6112435) · [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [chrome.sessions](https://developer.chrome.com/docs/extensions/reference/api/sessions) · [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage) · [chrome.identity](https://developer.chrome.com/docs/extensions/reference/api/identity) · [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata) · [Chrome tab groups help](https://support.google.com/chrome/answer/2391819)
- Mozilla: [Desktop vs. Android extensions](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/) · [Pocket](https://getpocket.com) · [Future of Pocket](https://support.mozilla.org/kb/future-of-pocket) (not opened directly)
- Competitors: [Raindrop](https://raindrop.io/pro/buy) · [Instapaper Premium](https://www.instapaper.com/premium) · [Readwise Reader](https://readwise.io/read) · [Karakeep](https://karakeep.com/) · [Toby](https://gettoby.com) · [Workona](https://workona.com)
- Secondary (flagged in text): [Chrome Unboxed](https://chromeunboxed.com/a-development-version-of-chrome-for-android-now-supports-extensions) · [Android Authority](https://www.androidauthority.com/chrome-for-android-with-extensions-demo-3540132) · [Heise on Omnivore](https://heise.de/-9998733)
