# 32. Menus, link kinds, accents, bookmark, and site icon decisions that were code comments (src/shared)

Status: accepted, 2026-11-25. Issue #442.

## Context

This record covers the right-click menu tree (`context-menu-plan.ts`), the link kind read from an address (`link-kind.ts`), accents and colors (`accents.ts`, `accent-colors.ts`, `color-math.ts`), bookmark tags, columns, and duplicates (`bookmark-tags.ts`, `bookmark-rules.ts`, `column-sites.ts`, `duplicate-bookmarks.ts`), icon ids (`icon-ids.ts`, `icon-meta.ts`), site icons (`site-icons.ts`), excluded sites (`excluded-sites.ts`), and toasts (`toast-prefs.ts`). Their non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Duplicate handling for saves is in [ADR 31](0031-shared-search-save-capture-decisions.md). Bookmark tag storage is in [ADR 8](0008-bookmark-tags-sync.md).

Imports: the service worker builds into one classic script and imports shared code from `src/`, so it does not keep copies of these helpers ([Extension rules](../agents/extension.md)). Several comments in these files said otherwise. Those were stale and are not carried forward.

## Decisions

### Right-click menu (`context-menu-plan.ts`)

* **One parent item per context, named after the extension,** keeps the browser menu short (`context-menu-plan.ts:contextMenuPlan`).
* **The toolbar icon's menu is top level.** Chrome shows at most `ACTION_MENU_TOP_LEVEL_LIMIT` (6) items there (`context-menu-plan.ts:ACTION_MENU_TOP_LEVEL_LIMIT`).
* **The page items also appear on the tab strip** in Firefox, and in Chromium 150 or newer. Chromium 149 lists the `tab` context but shows none of its items, and 150 fixed that and a crash with more than one extension item (`context-menu-plan.ts:CHROMIUM_TAB_MENU_VERSION`, `context-menu-plan.ts:hasTabMenu`).
* **Menu ids keep the `tablodge-` prefix,** and column items append the column id (`context-menu-plan.ts:PAGE_SEND_PREFIX`, `context-menu-plan.ts:LINK_COLUMN_PREFIX`).
* **"Bookmark this page to" is shared with the tab strip.** The worker retitles it when a menu opens. Only Firefox reports which menu opened; Chromium keeps the page title in both (`context-menu-plan.ts:contextMenuPlan`).
* **The Send-this-tab submenu lists the most recently changed sessions,** up to a fixed count (`context-menu-plan.ts:MENU_SESSION_LIMIT`, `context-menu-plan.ts:menuSessions`).
* **Unfiled is not offered as a column.** It only holds bookmarks left from a deleted column (`context-menu-plan.ts:contextMenuPlan`).
* **Video and audio share one menu,** because a video player and an audio player are both media elements (`context-menu-plan.ts:contextMenuPlan`).
* **Images get the menu only when they have their own web address.** A streamed video has a `blob:` source and falls back to the page, so the page must be a web page (`context-menu-plan.ts:contextMenuPlan`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **Chrome substitutes `%s` with the selected text,** shortened for long selections (`context-menu-plan.ts:contextMenuPlan`).
* **A quote is saved on the page's bookmark,** so only web pages offer it (`context-menu-plan.ts:contextMenuPlan`, [ADR 31](0031-shared-search-save-capture-decisions.md)).
* **Titles double `&` in Firefox.** Firefox reads a single `&` as an access-key marker and hides it, so `R&D` would show as `RD`. Chrome shows `&` as written (`context-menu-plan.ts:contextMenuPlan`, `hasAmpersandAccessKeys`).
* **The menu tree depends only on the settings, the enabled systems, and the column names and order.** Nothing else is read, so the tree can be checked without a browser (`context-menu-plan.ts:contextMenuPlan`).

### Link kind (`link-kind.ts`)

* **A link's kind is worked out from its address each time it is drawn, and never stored.** Old libraries and older apps need nothing, and a better rule reaches every saved link at once (`link-kind.ts` module).
* **A site rule wins over a file ending, and an address has one kind** (`link-kind.ts:linkKind`).
* **Every site in Sources has a rule for the links it saves.** `tests/link-kind.test.ts` checks that (`link-kind.ts:SITE_RULES`).
* **Rules match a host without `www.` or `m.`,** and also subdomains when the rule starts with `*.`. A path is tried on the path, and the first matching rule wins (`link-kind.ts:SiteRule`).
* **Site-specific exceptions are listed in place,** for example GitHub, GitLab, and Codeberg paths that are the site's own pages and not an owner, and Amazon, which has a store per country with products under `/dp/` or `/gp/product/` (`link-kind.ts:SITE_RULES`).
* **Music is matched before video,** so `music.youtube.com` is music (`link-kind.ts:SITE_RULES`).
* **Documentation on a `docs.` subdomain is documentation,** except Google Docs, which holds documents (`link-kind.ts:SITE_RULES`).
* **Data and blob addresses are never saved, and say nothing a name could be read from** (`link-kind.ts:linkKind`).
* **Only the last path segment decides a file ending.** A query such as `?file=photo.jpg` belongs to a page (`link-kind.ts:linkKind`).
* **Image, PDF, and video links also get a mark on their icon,** because they open a file or a player rather than a page (`link-kind.ts:isMediaKind`).
* **A screen reader says the media kind before the link's name** (`link-kind.ts:LINK_KIND_LABELS`).

### Accents and colors (`accents.ts`, `accent-colors.ts`, `color-math.ts`)

* **An accent is `default`, a preset id, `system`, or a custom `#rrggbb`.** `default` is TabLodge's own indigo, which the stylesheet defines. Every accent except the default is set as inline CSS variables on `<html>` (`accents.ts:applyAccent`).
* **`system` reads the operating system's accent** from the CSS `AccentColor` keyword, and keeps it current (`accents.ts:systemAccentColor`).
* **Chromium reports `AccentColor` when there is no real accent** (for example Linux without a GTK accent). That is not a choice, so it counts as no accent (`accents.ts:systemAccentColor`).
* **The system accent is probed inside the page's own shadow root,** so a script on a web page can measure it and leave the page's tree alone (`accents.ts:systemAccentColor`).
* **Accent variables are set before first paint.** `theme-boot.ts` calls `applyAccent`, and the theme provider calls it again. The default accent, or a platform with no system accent, removes the variables so the stylesheet's indigo shows (`accents.ts:applyAccent`).
* **The browser fires no event for the system accent.** It is rechecked when the page regains focus or visibility, when the color scheme or contrast changes, and every couple of seconds while the page is visible (`accents.ts:watchSystemAccent`).
* **A private window's accent is mirrored into its own storage.** `same` means the regular accent applies, and a missing value means the user never chose, so the default applies (`accents.ts:resolvePrivateAccent`, `accents.ts:readEffectiveAccent`).
* **Accent colors work without the browser,** so the Android app uses the same palette and shades (`accent-colors.ts` module).
* **A column color is a preset id or `#rrggbb`.** The default and the system accent are not column colors, so a column without one is neutral (`accent-colors.ts:isColumnColor`).
* **A column color is shown as two shades** that stand out on the light and dark page (`accent-colors.ts:columnColorShades`).
* **Accent text is moved toward black or white until it stands out** from the page (`accent-colors.ts:legibleOn`).
* **Text on a filled accent is white or near-black,** whichever reads better (`accent-colors.ts:foregroundOn`).
* **Color pickers store the same text** a typed or preset color is stored as (`color-math.ts:hslToHex`, `color-math.ts:hexToHsl`).

### Bookmark tags (`bookmark-tags.ts`)

* **Only the typed tags and the removed kinds are stored.** The kind a bookmark shows is read again each time from its address. Both fields sync as one `tag` record ([ADR 8](0008-bookmark-tags-sync.md)) (`bookmark-tags.ts` module).
* **Tags are normalized the same way on every device,** so two devices never disagree about a record and send it back and forth (`bookmark-tags.ts` module).
* **A tag is lower case,** with spaces tidied, a leading `#` dropped, and at most `MAX_TAG_LENGTH` characters. Commas and bars separate tags in exported files, and quotes would end a `tag:"…"` search, so they become spaces (`bookmark-tags.ts:normalizeTag`).
* **Lower case uses the code, not the device's language,** so `I` is `i` on a Turkish phone too (`bookmark-tags.ts:normalizeTag`).
* **A bookmark's tags are kept in order,** the first of equal ones kept, at most `MAX_TAGS`. A bookmark with none stores no field (`bookmark-tags.ts:bookmarkTags`).
* **Removed kinds are kept in `LINK_KINDS` order** (`bookmark-tags.ts:hiddenKinds`).
* **An edit reports what it took away** so the caller knows whether to offer Undo. A kind that went because the address changed is not a removal (`bookmark-tags.ts:removedByEdit`).
* **Typed tags are split on commas** (`bookmark-tags.ts:parseTagInput`).

### Columns and duplicates (`bookmark-rules.ts`, `column-sites.ts`, `duplicate-bookmarks.ts`)

* **Column ids:** the first column has a fixed id, and bookmarks whose column is gone go to a fixed bucket (`bookmark-rules.ts:DEFAULT_BOOKMARK_COLUMN_ID`, `bookmark-rules.ts:BOOKMARK_UNFILED_ID`).
* **A column name is cut to 60 characters,** with control characters turned into spaces (`bookmark-rules.ts:cleanColumnName`).
* **Column names are unique ignoring case,** and "All bookmarks" is reserved (`bookmark-rules.ts:columnNameProblem`).
* **A new bookmark goes to the requested column,** else the column that claims its site, else the default column, else the first, else Unfiled (`bookmark-rules.ts:landingColumnId`, `column-sites.ts:columnForUrl`).
* **`manual` keeps the stored order.** Every other sort returns a sorted copy and leaves the stored order alone, and ties keep their stored order (`bookmark-rules.ts:sortBookmarks`).
* **A column's sites are a host, which covers its subdomains, or a host with a path prefix.** The longest path wins, then the longest host, then the earlier column (`column-sites.ts:columnForUrl`).
* **A column holds at most `MAX_COLUMN_DOMAINS` sites,** the same limit the extension enforces when it saves (`column-sites.ts:checkColumnSite`).
* **A column without sites stores no field** (`column-sites.ts:domainsField`).
* **Duplicates are exact matches of the canonical address,** across all columns, the same rule saving uses. One pass over the board (`duplicate-bookmarks.ts:findDuplicateBookmarks`).
* **The kept copy is the oldest,** or the first on the board when they tie, unless the person chose another (`duplicate-bookmarks.ts:findDuplicateBookmarks`, `duplicate-bookmarks.ts:removalIds`).

### Icons (`icon-ids.ts`, `icon-meta.ts`)

* **Icon ids are kept free of imports,** so the list can be used without the drawing code. The components live in `icon-registry.ts` (`icon-ids.ts` module).
* **Each icon has a name and search words,** keyed by id, so an id without an entry fails to compile (`icon-meta.ts:ICON_INFO_DATA`).
* **Icon search ranks whole words and prefixes first,** then initials, letters in order, and one-letter typos. Every query word must match. When nothing matches, a loose subsequence of the id is the last resort (`icon-meta.ts:searchIconInfos`).

### Site icons (`site-icons.ts`)

* **Icons are kept per host on this device,** for links the browser has no icon for (`site-icons.ts` module).
* **Firefox has no favicon service,** so there the icon of each site the user opens is remembered from its tab, handed over as a data address. Showing it asks the site for nothing (`site-icons.ts` module).
* **With a sync server connected, the server fetches icons the browser does not know.** Its answer is kept too: the icon, or for a day the fact that there is none (`site-icons.ts:rememberServerAnswer`).
* **Stored icons are untrusted.** Anything that is not a small base64 image address is dropped (`site-icons.ts:normalizeSiteIcons`).
* **Icons and "no icon" times are capped at the newest hosts** (`site-icons.ts:MAX_SITE_ICONS`).
* **After the server fails to answer** (offline, refused, rate limited), it is not asked again for a few minutes. Only a 404 counts as "no icon", because an older server without the route answers that too (`site-icons.ts:SERVER_PAUSE_MS`, `site-icons.ts:createServerIcons`).
* **Only a plain domain name is asked about.** An address with a port, a bare name such as `localhost`, or a page that is not a website is not (`site-icons.ts:serverIconHost`).
* **A remembered image too large to store is redrawn smaller** if the browser can redraw it (`site-icons.ts:imageDataAddress`).
* **Icons are asked for only when a server is set, the setting is on, and the window syncs the connected library** (`site-icons.ts:createServerIcons`).

### Excluded sites (`excluded-sites.ts`)

* **An excluded site is a bare host name,** covering the host and its subdomains. Old stored origins are accepted, and a leading `www.` is dropped (`excluded-sites.ts:normalizeExcludedHost`).
* **`mail.google.com` is excluded by `google.com`,** but `notgoogle.com` is not (`excluded-sites.ts:hostIsExcluded`).
* **The bulk box sorts its lines** into new hosts, hosts already excluded, and lines that are not usable. A repeated line counts once as new (`excluded-sites.ts:parseExcludedLines`).
* **The single-site field says why a text cannot be used,** or nothing when it can (`excluded-sites.ts:excludedHostError`).

### Toasts (`toast-prefs.ts`)

* **Two settings choose a toast's place and length.** `Default` is bottom center on TabLodge's pages and for the quote toast, and bottom right on the site pages the Sources toast shows in (`toast-prefs.ts:toastPlace`).
* **Centered places sit at left 50% and shift back by half their width** (`toast-prefs.ts:centered`).
* **A stack lines up at the edge** it sits on, and a column stacks the newest nearest the edge, so a top stack is reversed (`toast-prefs.ts:toastEdges`, `toast-prefs.ts:toastEdges`).
* **The quote toast gets finished values,** not this module, because `quote-toast.ts` is serialized into a page (`toast-prefs.ts` module).
* **"Longer" is twice the base time, and "until dismissed" never closes by itself** (`toast-prefs.ts:toastMs`).
