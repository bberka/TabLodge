# Naming research: TabNest and alternatives

Date: 2026-10-25. Scope: picking a name for the open-source Chrome/Brave MV3 extension currently called "TabNest" (new-tab dashboard with bookmark board and saved tab sessions, local-first, no account).

Not legal advice. Trademark checks here are web searches only (see "What I could not verify").

## TL;DR

- **"TabNest" is badly crowded.** The Chrome Web Store (CWS) has **14 live listings** named "TabNest" or "Tab Nest". A search for "tabnest" returns 10 of 10 first-page results with that name. One of them (`oghchmagammlcniikanbgcebphcdogjf`, by "hkyy521", 365 users, updated 2026-10-14) does nearly the same thing: a local new-tab page with tab organization, bookmark boards and saved sessions. `tabnest.io` is a live "TabNest" bookmark-manager Chrome extension site. The GitHub org/user `TabNest` is taken. Firefox AMO already has "TabNest - Tab Session Manager".
- **Almost every "Tab + noun" name is crowded too** (TabStash, TabVault, TabKeeper, TabShelf, KeepTabs, TabHarbor and others). Clean names exist but are rare.
- **Correction to the brief:** the Chrome Web Store name limit is **75 characters**, not 45. The **45-character** limit applies to Firefox AMO and Microsoft Edge Add-ons. So ≤45 characters is still the right target if you want one title that works on all three stores.
- **Top 3:** (1) **TabLodge**, (2) **SessionNest**, (3) **keep TabNest** with a clear descriptive suffix. Details are at the end.

## Method

I ran an automated check (script kept outside the repo) for each candidate:

| Check | How | Notes |
|---|---|---|
| Chrome Web Store | Fetched `chromewebstore.google.com/search/<name>` (server-rendered) and counted first-page result titles containing the name, ignoring spaces and case. For notable hits I fetched the detail page for user count, update date and description. | Only the first page (about 10 results) is parsed. CWS search is fuzzy, so "0 hits" means "nothing with this name on page 1". |
| Firefox AMO | Official API `addons.mozilla.org/api/v5/addons/search/?q=<name>` | Counted results whose name or slug contains the candidate. Average daily users (ADU) recorded. |
| GitHub | `gh api users/<name>` (is the account/org taken?) plus `search/repositories?q=<name> in:name` (count and top repos by stars) | |
| npm | `registry.npmjs.org/<name>` (404 means free) | |
| Domains | RDAP: Verisign for `.com`, Identity Digital for `.io`, rdap.org bootstrap (Google Registry) for `.app` and `.dev` | 404 means "no registry record", so probably unregistered. It could still be reserved or premium-priced. I checked `.app`/`.dev` 404 handling against known domains (`web.dev`, `chrome.app` both return 200). |
| Edge Add-ons | Web search only (`site:microsoftedge.microsoft.com`) | The Edge store search page renders with JavaScript, so I couldn't scrape it. |
| Web / trademarks | Web searches for the exact name, plus "trademark" | No USPTO/EUIPO query (the USPTO search API rejected scripted requests). |

## 1. "TabNest" itself

### Chrome Web Store: 14 live listings with the same name

| Listing ID | Title | Users | Updated | What it does |
|---|---|---|---|---|
| `gplhcnbpmokcnjhhcbhfjgdnpdjgoadk` | TabNest | 791 | 2023-08-14 | Save window tabs and groups for later (open source: `tokedo/TabNest`) |
| `oghchmagammlcniikanbgcebphcdogjf` | TabNest | 365 | 2026-10-14 | **Near-identical concept:** new-tab workbench with tab organization, bookmark boards, sessions, all local, no account |
| `emomlmhchbjlngmhkhedcfgcfibihijp` | TabNest – Bookmark Manager with Live Preview | 22 | 2026-05-11 | Bookmarks (probably the `tabnest.io` product) |
| `npkfilojmiapjoigjobaciabmhhlflcb` | Tabnest — Personal New Tab Dashboard | 16 | 2026-06-26 | New-tab dashboard with bookmarks, notes, widgets |
| `fdpnfkdomafknjkkbhklhkkdjhnekjin` | TabNest - Tree Style Tabs | 14 | 2026-10-07 | Tree-style tabs |
| `koppkpgmbpmjohahldpooknmocedbmke` | TabNest | 6 | 2026-02-24 | Tabs grouped by host |
| `ckjapbicmbkcapmpmhefgdbneecihian` | TabNest | 5 | 2026-05-11 | Save, organize and restore tabs |
| `fmagdockhlggibgeklmbkofpgdildkfp` | TabNest | 4 | 2025-11-03 | Organize and suspend tabs |
| `jenphfapjhejpjkcchmjdkdkbmnjiinc` | Tab Nest | 4 | 2026-05-03 | Fork of "Tab Out", local new-tab |
| `dednapcnfpkldgbpehgaanjeemeojghl` | TabNest | 3 | 2026-08-03 | Private tab clustering |
| `koijhlkjiilemffkahoimifcmfpiiiik` | TabNest | 3 | 2026-08-09 | Local-first organizer built on tab groups |
| `poadmagopkmogioihajdooaffmjlfgck` | TabNest | 3 | 2026-06-14 | AI tab manager, save/sync/export |
| `hnalglepcamofdlpkigfgbodooihfpai` | TabNest: Tab Organizer, Manager & Memory Saver | n/a | 2026-06-21 | Smart groups, RAM saver, workspaces |
| `dohbmkbmgffialkkcejpdgchjbncnjip` | TabNest | n/a | 2025-10-29 | Frequent/related/closed tabs, locking |

Most of these listings are 2025–2026 clones of the same idea. A user who hears "TabNest" and searches for it will get a wall of identical names and icons. That's the main findability problem. No suffix fully fixes it, because users search for the brand word.

### Other stores and platforms

- **Firefox AMO:** four or more TabNest add-ons, including "TabNest - Tab Session Manager", "Tab Nest" and "Tab Nest Manager". All have tiny usage (0–2 ADU), but the name is taken in the exact category.
- **Edge Add-ons:** a web search found no TabNest listing. Not verified directly (see Method).
- **GitHub:** the account `github.com/TabNest` exists (an organization created 2026-07-04 with 0 public repos, likely a squatter). 62 repos have "tabnest" in the name (top: `mrluxy/TabNest` 5★, `liangix/TabNest` 3★, `tokedo/TabNest` 1★).
- **npm:** `tabnest` is free.
- **Domains:** `tabnest.com` is registered (2023-08-05, GoDaddy DNS, didn't resolve to a site when fetched). `tabnest.io` is registered (DigitalOcean) and live as "TabNest — Your Bookmarks, Beautifully Organized", a competing Chrome bookmark extension. `tabnest.app` and `tabnest.dev` had no RDAP record, so they're probably available (not confirmed with a registrar).
- **Trademarks:** web search found no TabNest trademark filing. Not checked against USPTO/EUIPO directly. Side note: "Nest" is also Google's smart-home brand. That's a different product class, and many extensions use "nest", so the risk is low, but worth knowing.

**Verdict:** high competition and medium clarity. "Nest" suggests "tabs live here", but it doesn't say *sessions* or *bookmarks*. The name is pleasant, but it's the least findable option checked.

## 2–3. Candidates and clash checks

Ratings:
- **Competition** (how hard it is to find you by name): **Low** = no same-name listing in CWS or AMO and almost nothing on GitHub; **Med** = one or two small same-name projects; **High** = several same-category listings or a well-known project.
- **Clarity** (does a stranger guess "save/organize tabs"?): Low / Med / High.

"Domains" lists only the TLDs where RDAP showed **no record** (probably free).

### Shortlist (15 candidates)

| # | Name | Type | CWS (same name) | AMO | GitHub | npm | Domains probably free | Other conflicts | Competition | Clarity |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **TabLodge** | Brandable (a place tabs stay, like "nest") | 0 | 0 | 0 repos, account free | free | **.com .app .dev .io** | Lodge (cast-iron cookware) is a different product class. No web hits for the exact name. | **Low** | Med |
| 2 | **SessionNest** | Descriptive, keeps "Nest" | 0 | 0 | 1 (`nemoob/sessionnest`, Swift, 2★), account free | free | .dev .io | `sessionnest.com` registered (2025). `sessionnest.app` is a live but unidentified product ("Ver.5.3.1"). Google results are noisy from NestJS "session" libraries. | Low–Med | Med–High |
| 3 | **TabHoard** | Descriptive and playful ("tab hoarder") | 0 | 0 | ~7 small "tabhoarder"/"tabhoarding" repos, account free | free | .app .dev .io | `tabhoard.com` registered 2026-09-13. "Hoardie" is an existing CWS extension in the same niche. Slightly negative connotation. | Low | High (people call themselves tab hoarders) |
| 4 | **TabCellar** | Brandable (store for later) | 0 | 0 | 0 | free | **.com .app .dev .io** | None found | **Low** | Med |
| 5 | **TabPantry** | Brandable (store for later) | 0 | 0 | 0 | free | **.com .app .dev .io** | None found | **Low** | Med–Low (a bit twee) |
| 6 | **ParkTabs** | Descriptive verb ("park your tabs") | 0 exact (one listing uses "Park Tabs" as a keyword) | 0 | 0 | free | **.com .app .dev .io** | "ParkMyTab" and "Parking — Bookmark Tabs…" exist in CWS in the same niche | Low–Med | High |
| 7 | **TabHaus** | Brandable | 0 | 0 | 0 | free | .app .dev .io | `tabhaus.com` registered | Low | Med–Low |
| 8 | **TabHold** | Descriptive ("on hold") | 0 | 0 | ~5 "TabHolder" repos | free | .app .dev .io | CWS "Tab Holder" (7 users, 2024), same niche | Low–Med | Med–High |
| 9 | **TabStow** | Descriptive verb ("stow tabs") | 1: "Tabstow" (6 users, updated 2026-10-16, "Stow your open tabs into a list") | 0 | 2 tiny repos | free | .app .dev .io | `tabstow.com` registered 2025-08, parked | Med | High |
| 10 | **TabsLater** | Descriptive | 0 exact | 0 | 0 | free | **.com .app .dev .io** | Near-identical names: "TabLater – Snooze Tabs", "TabuLater", "To-Tab Later", AMO "Tab Later". Suggests snoozing more than sessions. | Med | High |
| 11 | **TabLoft** | Brandable | 1: "Tabloft: Tab Workspaces, Notes, and Tasks" (6 users, local, same niche) | 0 | 3 tiny | free | .app .dev .io | — | Med | Med |
| 12 | **TabNook** | Brandable, close to "nest" | 2: "TabNook" (23 users), "TabNook — Tab Manager & Workspaces" | 0 | 1 | free | .app .dev .io | `tabnook.com` registered. "NOOK" is a Barnes & Noble mark (e-readers/software). | Med | Med |
| 13 | **TabSilo** | Brandable | 2: "TabSilo - Tab Session Manager", "Tab Silo — Tab Manager & Suspender" | 0 | 3 | free | .app .dev .io | `tabsilo.com` registered 2026-05 | Med | Med |
| 14 | **Stashboard** | Brandable compound (stash + dashboard) | 0 | 1: "Tab Stashboard" (0 ADU) | 42 repos; **`twilio/stashboard` ≈1.6k★** (well-known open-source status page from 2010); account taken | free | .dev | `stashboard.com`/`.app`/`.io` registered | Med–High on GitHub and Google | Med |
| 15 | **TabRoost** | Brandable, close to "nest" | 0 | 0 | 1 tiny | free | .app .dev .io | **"Roost"** is an existing local-only tab session manager on Product Hunt ("Save, search & restore your tabs — $5 once, 100% local"). `tabroost.com` was registered 2026-09-28 and is parked. | **Med–High** (direct concept clash) | Med |

### Rejected as too crowded (checked, for reference)

| Name | Why rejected |
|---|---|
| TabStash / Tab Stash | 10/10 CWS results use the name. AMO "Tab Stash" by Josh Berry has ~41,000 ADU (an established open-source project). All four domains taken. |
| TabVault | 10/10 CWS results (all session managers). 10 AMO hits (one with 522 ADU). npm taken. 102 GitHub repos. |
| TabKeeper / TabKeep | 10/10 and 8/9 CWS. GitHub orgs taken. npm `tabkeep` taken. |
| KeepTabs | 10/10 CWS ("KeepTabs — never lose a tab" and others). |
| TabShelf | 10/10 CWS, including "Tabshelf - Tab Manager & New Tab Board" (direct concept match). |
| TabHarbor | 8/9 CWS plus an AMO Tab Harbor. Several open-source projects. |
| TabMark | 7 CWS (new-tab bookmark dashboards). `Alanrk/TabMark-Bookmark-New-Tab` 295★. npm taken. |
| TabBoard, TabHome, TabHive, TabAtlas, TabFold, TabRest, TabGarden, TabCove, Tabstead, Tabfolio, TabTrove, TabPark, TabLedger, TabArk, TabTuck, TabBurrow, TabCrate, TabSafe, TabHaven, TabDock, TabDrawer, TabYard | 2–8 same-name CWS listings each, mostly tab or session managers from 2025–2026 |
| Tabbit, Tabsy | Tabbit is an AI browser with popular repos. Tabsy has 136 repos, npm taken, several CWS listings. |
| TabRoom | Tabroom.com is a large speech-and-debate tournament platform |
| Restash, Nestbox, LocalTabs, SessionBoard | npm or all domains taken, or very generic. LocalTabs and SessionBoard are clear but not very ownable. |

**Pattern:** "Tab + cozy/storage noun" is the default naming formula for this category. Dozens of new clones appeared in 2025–2026. Names that are still clean either use a less obvious noun (Lodge, Cellar, Pantry, Haus) or lead with a different keyword (Session…, Park…).

## 4. Store naming and SEO rules

### Length limits (official)

| Field / store | Limit | Source |
|---|---|---|
| Chrome manifest `name` (Chrome Web Store title) | **75 characters max** | Chrome manifest `name` reference |
| Chrome manifest `short_name` (shown where space is tight) | **12 characters recommended** | Chrome manifest `short_name` reference |
| Chrome manifest `description` (CWS short summary) | **132 characters max**, plain text | Chrome manifest `description` reference |
| Firefox AMO name | **45 characters max** | MDN `manifest.json/name` (store limits "as of February 2024") |
| Microsoft Edge Add-ons name | **45 characters max** | MDN, same page |

The "45-character" figure in the brief comes from the old Chrome Apps docs and current AMO/Edge limits. **CWS allows 75.** Keeping the title **≤45** still makes sense so the same string works in all three stores, and long titles get cut off in CWS result cards anyway.

### Discoverability and keyword-spam policy

- **Search ranking uses listing metadata, ratings and usage.** Google's "Creating a great listing page" guide says search results are "ranked on several criteria, including metadata from the item's listing page". It also warns that adding unnecessary keywords "can lead to an item being suspended". "Discovery on the Chrome Web Store" adds ratings and installs versus uninstalls.
- **Metadata policy.** The CWS Listing Requirements (last updated 2024-07-10) prohibit "misleading, improperly formatted, non-descriptive, irrelevant, excessive, or inappropriate metadata, including but not limited to the extension's description, category, developer name, **title**, icon, screenshots…".
- **Keyword spam.** The same policy defines keyword spam as "including irrelevant or excessive keywords in an extensions description in an attempt to manipulate its ranking". Its examples include "unnatural repetition of the same keyword more than 5 times" and lists of sites or brands without added value. The Spam policy FAQ says to keep any one keyword "to under 5" instances and to list no more than five brands or websites.
- **No duplicate listings** for locales or variants (Spam and Abuse policy, Spam FAQ).

### Practical recommendations

1. **Use the "Brand – what it does" pattern** with one or two real feature phrases. Example: "TabLodge – Tab Session Manager & Bookmarks". This is allowed: the words are relevant, short and not repeated. Avoid stacking ("Tab Manager, Tab Saver, Session Saver, OneTab Alternative…"); that's the excessive-metadata pattern the policy targets.
2. **Choose suffix keywords that match how people search:** "tab session manager", "save tabs", "bookmarks", "new tab". "Session manager" and "save tabs" are the head terms in this category (Session Buddy, Tab Session Manager, OneTab).
3. **Put differentiators in the 132-character description**, such as "local-first, no account", "tab groups", "split view", "side panel". Don't repeat the title there.
4. **Competitor names** like "OneTab alternative" can appear once in the long description, within the five-brands guidance. Don't put them in the title, because that risks both the metadata policy and trademark complaints.
5. **Use the same exact name** for the GitHub repo, store listing, `short_name` and a domain or landing page, so Google can link them together. Add GitHub topics such as `chrome-extension`, `tab-manager`, `session-manager`, `new-tab`, `bookmarks`, `local-first`, `manifest-v3`.
6. The **brand word should be ≤12 characters** so it fits in `short_name` without truncation. TabLodge has 8, SessionNest 11, TabNest 7.

## 5. Recommendation: top 3

### 1. TabLodge (recommended rename)

- **Why:** It's the only name that came back clean everywhere: zero same-name listings on CWS and AMO, zero GitHub repos, the GitHub account is free, npm is free, no web hits, and **`.com`, `.app`, `.dev` and `.io` all showed no registry record**. It keeps the "cozy place where your tabs live" feel of TabNest, so the identity carries over. It's easy to spell and pronounce, and "lodge" also means "to deposit".
- **Weakness:** It doesn't say "sessions" by itself, so the store suffix does that job.
- **GitHub repo slug:** `tablodge` (consider registering the `tablodge` org too)
- **Store title (42 chars):** `TabLodge – Tab Session Manager & Bookmarks`
- **Tagline:** "A home for your tabs: save windows and tab groups as sessions, restore them in one click, and keep a local bookmark board on every new tab."

### 2. SessionNest (keeps "Nest", much less crowded)

- **Why:** It keeps the "Nest" you like and puts the category's main keyword ("session") into the brand itself, so anyone searching "session" finds you. Zero same-name listings on CWS and AMO, npm and the GitHub account are free, and `.dev`/`.io` showed no record.
- **Weaknesses:** `sessionnest.com` and `sessionnest.app` are taken (the `.app` hosts an unidentified product). It underplays the bookmark-board half of the product. Google results get noise from NestJS "session" docs. At 11 characters it just fits `short_name`.
- **GitHub repo slug:** `sessionnest`
- **Store title (40 chars):** `SessionNest – Save Tabs & Bookmark Board`
- **Tagline:** "Nest your tabs: save sessions with tab groups, pinned tabs and split view, then restore them later. Local, private, no account."

### 3. Keep TabNest, with a differentiating suffix

- **Why:** Zero rename cost, and you already like the name. Most CWS installs come from generic searches ("tab session manager"), where the title keywords, ratings and usage matter more than the brand word. If you keep it, the suffix should stress what the clones don't: **local**, **sessions** and **bookmarks**.
- **Weaknesses:** 14 same-name CWS listings, including one near-identical new-tab dashboard (365 users). `tabnest.io` is a live competitor. The GitHub `TabNest` account is taken. AMO already has "TabNest - Tab Session Manager". Word of mouth ("search for TabNest") will often land users on the wrong extension. Use a distinct icon and colour so you stand out in the result grid.
- **GitHub repo slug:** `tabnest-extension` (the `TabNest` org is taken, and a plain `tabnest` repo would be one of 60+)
- **Store title (40 chars):** `TabNest – Local Tab Sessions & Bookmarks`. The current manifest title "TabNest — Tabs & Bookmarks" is too vague to stand out from the clones.
- **Tagline:** "Your new tab, organized: a bookmark board plus saved tab sessions, restored exactly as you left them. 100% local."

### Runners-up

- **TabHoard:** the most memorable and "tab hoarder" is a phrase people really search. It's clean on stores, but `.com` was registered in Sept 2026 and "Hoardie" sits in the same niche.
- **ParkTabs:** all four domains free and very clear, but "ParkMyTab" and "Parking" exist in the same niche.
- **TabCellar:** as clean as TabLodge (all domains free), but less warm.

## What I could not verify

- **Trademarks:** no USPTO, EUIPO or WIPO database query. The USPTO search API refused scripted requests. Conclusions come from web searches only. Run TabLodge or SessionNest through USPTO Trademark Search and EUIPO TMview (classes 9 and 42) before committing.
- **Edge Add-ons:** the store renders with JavaScript. I only ran a web search, which found no TabNest listing. Candidates weren't checked there.
- **Domain availability:** RDAP 404 means "no registry record", which is a strong sign but not proof. Premium or reserved pricing isn't visible. Confirm with a registrar.
- **CWS completeness:** only the first page of CWS search results (about 10 items) was parsed per query. CWS search also doesn't handle spaced and joined forms identically ("Tab Lodge" vs "TabLodge"), so I spot-checked spaced variants for TabNest only.
- **Google web ranking:** web search results here are a snapshot from one search provider, not a real Google SERP.
- **User counts** come from CWS detail pages on 2026-10-25 and change daily.

## Sources

Official policy and docs:
- Chrome manifest `name` (75-char max): https://developer.chrome.com/docs/extensions/reference/manifest/name
- Chrome manifest `short_name` (12 chars recommended): https://developer.chrome.com/docs/extensions/reference/manifest/short-name
- Chrome manifest `description` (132-char max): https://developer.chrome.com/docs/extensions/reference/manifest/description
- MDN `manifest.json` `name` (store limits: CWS 75, AMO 45, Edge 45): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/name
- CWS Program Policies, Listing Requirements (metadata and keyword spam; last updated 2024-07-10): https://developer.chrome.com/docs/webstore/program-policies/listing-requirements
- CWS Spam policy FAQ (under-5 keyword guidance): https://developer.chrome.com/docs/webstore/program-policies/spam-faq
- CWS Spam and Abuse policy: https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse
- CWS policy update Q3 2021 (keyword spam introduction): https://developer.chrome.com/blog/policy-update-kwspam-and-circumvention
- CWS "Creating a great listing page": https://developer.chrome.com/docs/webstore/best-listing
- CWS "Discovery on the Chrome Web Store": https://developer.chrome.com/docs/webstore/discovery

TabNest clashes:
- CWS search "tabnest": https://chromewebstore.google.com/search/tabnest
- Near-identical TabNest (hkyy521): https://chromewebstore.google.com/detail/oghchmagammlcniikanbgcebphcdogjf
- TabNest (tokedo, 791 users): https://chromewebstore.google.com/detail/gplhcnbpmokcnjhhcbhfjgdnpdjgoadk
- Tabnest — Personal New Tab Dashboard: https://chromewebstore.google.com/detail/npkfilojmiapjoigjobaciabmhhlflcb
- TabNest: Tab Organizer, Manager & Memory Saver: https://chromewebstore.google.com/detail/hnalglepcamofdlpkigfgbodooihfpai
- Other TabNest listings: https://chromewebstore.google.com/detail/ckjapbicmbkcapmpmhefgdbneecihian , https://chromewebstore.google.com/detail/koppkpgmbpmjohahldpooknmocedbmke , https://www.chromeboard.com/extension/tab-nest-jenphfapjhejpjkcchmjdkdkbmnjiinc , https://extscope.org/extension/fmagdockhlggibgeklmbkofpgdildkfp , https://extensionauditor.com/scan/tabnest-dohbmkbmgffialkkcejpdgchjbncnjip
- tabnest.io (competing bookmark extension site): https://tabnest.io/
- AMO TabNest: https://addons.mozilla.org/firefox/addon/tabnest
- GitHub `TabNest` org: https://github.com/TabNest ; example repo: https://github.com/tokedo/TabNest
- AMO search API used for counts: https://addons.mozilla.org/api/v5/addons/search/?q=tabnest&app=firefox&type=extension
- RDAP endpoints used: https://rdap.verisign.com/com/v1/domain/tabnest.com , https://rdap.identitydigital.services/rdap/domain/tabnest.io , https://rdap.org/domain/tabnest.app

Candidate clashes:
- Roost (local tab session manager, conflicts with TabRoost): https://www.producthunt.com/p/roost-7/roost-9
- Tab Stash (Firefox, ~41k ADU): https://addons.mozilla.org/firefox/addon/tab-stash/
- Tabstow (CWS): https://chromewebstore.google.com/detail/pkagdabohjnimhmpeoimbncikfdndnfo
- Tabloft (CWS): https://chromewebstore.google.com/detail/aadcfoappghjmloccjgjcefbhgghpghe
- TabNook listings: https://chromewebstore.google.com/detail/hadjmggbbimgljgkccdgjpgmcmcdoofg , https://chromewebstore.google.com/detail/dhbbmlpccicljdlpbmobeegamhcpjnpn
- Tab Holder (CWS): https://chromewebstore.google.com/detail/ghhflcneegiempdbinoioadeibijgija
- Hoardie (CWS): https://chrome.google.com/webstore/detail/hoardie-reduce-tab-clutte/mkhgkpkfkjckbemagpldhegilagacdcn
- ParkMyTab: https://www.extscope.org/extension/penfkihbapdhlmppadlkmifcokkdkbik
- Parking — Bookmark Tabs: https://extensionauditor.com/scan/parking-bookmark-tabs-intelligently-group-save-tab-lofliidibbmakackphnlaioafpgdjfdj
- TabLater – Snooze Tabs: https://chromewebstore.google.com/detail/iacnecepgghiapeopidbgifgimedoioj
- TabuLater: https://chrome.google.com/webstore/detail/bcmbdjphemaclhjbkaejcaffeddkmjco
- Twilio Stashboard: https://github.com/twilio/stashboard , https://www.twilio.com/en-us/blog/developers/twilio-open-sources-stashboard-the-status-dashboard-html
- sessionnest.app: https://sessionnest.app/
