# 31. Search, save, and page capture decisions that were code comments (src/shared)

Status: accepted, 2026-11-25. Issue #442.

## Context

This record covers the search operators and the finder (`search-query.ts`, `fuzzy.ts`, `global-search.ts`), the save rules and feedback (`save-rules.ts`, `save-feedback.ts`, `save-media.ts`), readable page copies (`page-extract.ts`, `page-copy.ts`), saved quotes and passage links (`quotes.ts`, `note-links.ts`), and address helpers (`web-url.ts`, `url-display.ts`, `tracking-parameters.ts`). Their non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Duplicate handling for the save paths is part of [ADR 27](0027-shared-sync-decisions.md)'s record model only where sync is involved; the rest is here.

## Decisions

### Search operators (`search-query.ts`)

* **Operators are a small fixed syntax on top of word matching.** Quoted phrases, `-word`, `site:`, `in:`, `kind:`, `tag:`, `col:`, `folder:`, `from:`, `after:`, and `before:`. A malformed operator stays a plain word, so a stray quote, a lone `-`, or `localhost:3000` searches as before (`search-query.ts:parseSearchQuery`, `search-query.ts:tokenize`).
* **An unclosed quote is plain words.** Nothing after it is an operator (`search-query.ts:tokenize`).
* **`key:"…"` and `-"…"` keep their prefix.** Other text before a quote is a word of its own (`search-query.ts:tokenize`).
* **The plain words are the whole input** when it has no operators or quotes, so each search does its own matching on it (`search-query.ts:SearchQuery`).
* **`after:` is local midnight of that day, included; `before:` is local midnight, excluded.** Only a strict `YYYY-MM-DD` counts, so `2026-02-30` does not (`search-query.ts:dayStart`).
* **`site:` matches a host and its subdomains,** in lower case (`search-query.ts:siteHost`, `search-query.ts:SearchFacets`).
* **`tag:` needs every tag.** Tags are stored the way bookmark tags are ([ADR 8](0008-bookmark-tags-sync.md)) (`search-query.ts:SearchFacets`).
* **`from:phone` and `from:computer` match only the kind of device.** Any other value matches part of the device's name (`search-query.ts:savedOn`).
* **`in:` leaves out commands, columns, and folders,** which have no place to be in (`search-query.ts:SearchPlace`).
* **Each operator is listed once** in `SEARCH_TIPS`, which both apps show, and `browserOnly` marks the ones the phone does not use (`search-query.ts:SEARCH_TIPS`).
* **Text pasted as a search is quoted when it would read as operators,** so it matches as one phrase. Its quote marks are dropped, since a phrase cannot hold them (`search-query.ts:literalQuery`).
* **The tag menu toggles one tag** without touching the rest of the text. A quoted phrase is read first, so a `tag:` written inside it is text (`search-query.ts:toggleTagFilter`, `search-query.ts:tagOperator`).

### Fuzzy matching (`fuzzy.ts`)

* **Matching is case-insensitive** and treats hyphens, underscores, and curly quotes like spaces and apostrophes. Each word must match somewhere (`fuzzy.ts:fold`, `fuzzy.ts:searchTerms`).
* **Each word scores by its best match type, best first:** the whole text, a whole word, the start of a word, inside a word, the initials of a label's words, letters in order inside one word, and a typo. The scores are fixed (`fuzzy.ts:FULL`, `fuzzy.ts:WORD`, `fuzzy.ts:PREFIX`, `fuzzy.ts:INSIDE`, `fuzzy.ts:INITIALS`, `fuzzy.ts:SUBSEQUENCE`, `fuzzy.ts:TYPO_ONE`, `fuzzy.ts:TYPO_TWO`).
* **A typo is one edit for four or more letters, two for seven or more** (`fuzzy.ts:TYPO_ONE`, `fuzzy.ts:TYPO_TWO`).
* **A typo counts only when no text has any other match for the word.** So a typo never outranks a real match (`fuzzy.ts:bestMatch`, `fuzzy.ts:fuzzyHits`).
* **A field lowers a match a little:** the label not at all, the help a little, options and keywords more. It never crosses into the next match type (`fuzzy.ts:fieldPenalty`).
* **Fuzzy matching needs at least three letters,** so `up` stays strict (`fuzzy.ts:fuzzyHits`).
* **Literal matches outrank every fuzzy one,** so the fuzzy pass runs only when a text has no literal match (`fuzzy.ts:hitsIn`).
* **Scoring can skip typos.** `scoreFolded` with `typos: false` gives the same score for texts that match without typos, and is faster (`fuzzy.ts:scoreFolded`).
* **Edit distance stops early** past its limit (`fuzzy.ts:editDistance`).
* **Lower-casing keeps the length.** Match offsets still fit the original text (`fuzzy.ts:fold`).

### Finder (`global-search.ts`)

* **The finder index is flat.** It ranks everything searchable with the shared fuzzy scorer and groups the hits by type (`global-search.ts:buildFinderIndex`, `global-search.ts:searchFinder`).
* **Bookmark and session items are cached.** They are the largest part of the index and rarely change, so the last build is reused when only the other state reloads (`global-search.ts:cachedBookmarkItems`, `global-search.ts:cachedSessionItems`).
* **Typo matching is capped per group.** A huge library cannot stall a keystroke. Pass one skips typos over the whole index, and pass two looks for them only among the rejected items, in groups that are not full (`global-search.ts:TYPO_SCAN_LIMIT`, `global-search.ts:searchFinder`).
* **Before anything is typed, the finder lists a fixed number of sessions, open tabs, and commands,** in display order (`global-search.ts:EMPTY_LIMIT`).
* **Only the best few are shown.** A short sorted list is kept instead of sorting every hit (`global-search.ts:searchFinder`).
* **An operators-only query lists everything that passes them,** in index order (`global-search.ts:searchFinder`).
* **A typed address becomes a "Go to" item first.** `localhost` and `host:port` without a scheme are local development servers, which rarely have TLS, so they open as `http` (`global-search.ts:looksLikeUrl`).
* **A non-empty query always ends with a web-search item,** so Enter always has something to do (`global-search.ts:searchFinder`).
* **URLs match without their scheme,** so `https` never matches everything (`global-search.ts:matchableUrl`).
* **Settings sections are found by name but not listed before anything is typed** (`global-search.ts:FinderSetting`).
* **Groups have a fixed order,** with the group that holds the best match first; ties follow the fixed order (`global-search.ts:KIND_ORDER`, `global-search.ts:SECTION_LABELS`).

### Save rules (`save-rules.ts`)

* **A duplicate is an exact match of the canonical address** (the one `normalizeUrl` gives) (`save-rules.ts:isDuplicateAt`).
* **Where a link goes decides the check.** A link into an existing session or column is a duplicate when that container holds it, whatever the setting says. Into a new session, or any other save, the setting decides: `reject` treats any session (or column, for bookmarks) that holds the address as a duplicate, and `allow` stores another copy (`save-rules.ts:duplicateFilter`, `save-rules.ts:isDuplicateAt`).
* **Sessions and bookmarks are separate.** A saved tab never makes a bookmark a duplicate, or the reverse. Bookmarks have no setting of their own and follow the save setting (`save-rules.ts:sessionDuplicates`, `save-rules.ts:bookmarkDuplicates`).
* **The duplicate rule is one function,** and every save path uses it (`save-rules.ts:isDuplicateAt`).
* **The session a link goes to when none is chosen** is the most recently updated one outside the Archived folder (`save-rules.ts:defaultTargetSession`).
* **A new session that allows duplicates never checks the index.** Nothing is skipped, so the saved tabs need not be read (`save-rules.ts:duplicateFilter`).
* **A library that has not set the handling allows duplicates,** as the extension's default does. This covers an empty phone library (`save-rules.ts:duplicateHandlingOf`).

### Save feedback (`save-feedback.ts`)

* **One result shape and one wording for every surface:** the toolbar badge, the page toast, and the Android snackbar all show what `saveMessage` says and what `SAVE_BADGES` marks (`save-feedback.ts:saveMessage`, `save-feedback.ts:SAVE_BADGES`).
* **A skipped duplicate is never a success.** A result with something stored and something skipped is a duplicate. Nothing stored and nothing skipped is a failure with `empty` as the reason (`save-feedback.ts:saveOutcomeOf`).
* **Undo is offered only when the save closed tabs** (`save-feedback.ts:SaveOutcome`, `save-feedback.ts:UNDO_LABEL`).

### Media (`save-media.ts`)

* **A media file with its own address is saved by that address,** and the address is the duplicate key (`save-media.ts:mediaBookmark`).
* **A stream has no address** (a `blob:` or `data:` source, as on YouTube), so the page is saved with the page's title instead. Images always have a source, so only a video or sound can be a stream (`save-media.ts:mediaBookmark`).
* **Until bookmarks have notes (#276),** a media file's title names the page's site (`save-media.ts:mediaBookmark`).
* **Addresses in the trash count as held** for duplicate checks. These are deleted bookmarks and the bookmarks of deleted columns. Entries come from storage or sync, so each field is checked (`save-media.ts:trashedBookmarkUrls`).
* **The media duplicate check uses the save rule** for the column the media goes to (`save-media.ts:mediaSave`, `save-rules.ts:isDuplicateAt`).

### Readable page copies (`page-extract.ts`, `page-copy.ts`)

* **A copy is text blocks, never HTML.** Showing one cannot run anything the page carried. Mozilla's Readability finds the article, and this module walks what it kept (`page-extract.ts:extractPageCopy`, `page-copy.ts` module).
* **Both apps run the same extraction.** The extension passes a clone of the open page, and the Android app parses fetched HTML with linkedom. Only standard DOM calls are used, so the same code runs in both (`page-extract.ts:walk`).
* **Scripts, styles, and similar elements are never text a reader wants.** Readability drops most of them, and the fallback walks the raw body and skips them (`page-extract.ts:SKIPPED`).
* **Page furniture is skipped only when Readability found no article.** Then the whole body is read (`page-extract.ts:CHROME`).
* **A page with no article still has its body as the fallback** (`page-extract.ts:extractPageCopy`).
* **A heading that repeats the title is dropped,** since the reader shows the title above the text (`page-extract.ts:extractPageCopy`).
* **A list item's own words come first,** then any list nested in it as items of their own (`page-extract.ts:walk`).
* **A copy belongs to an address, not a link id.** Undo puts links back under new ids, and a saved tab and a bookmark of one page share one copy (`page-copy.ts` module).
* **A copy lives while any link in the library or the trash has its address,** so it goes to the trash with its link and comes back with it. `sweep` drops the rest. Editing a link's address drops its copy (`page-copy.ts:sweep`, `page-copy.ts:copyLinkUrls`).
* **Copies stay on the device and never sync.** The extension keeps them in `chrome.storage.local` and the Android app in its store. Both use the same three calls (`page-copy.ts:CopyStorage`, `page-copy.ts:createCopyStore`).
* **Copies are budgeted by stored size.** A full backup carries every copy in one message and one ZIP entry, which the extension caps near 60 MB, so the budget leaves room for the library (`page-copy.ts:COPY_BUDGET`, [ADR 27](0027-shared-sync-decisions.md)).
* **Copies read from storage, a backup, a page, or the network are checked field by field.** Unknown block types or blocks with no text are dropped, and a copy with no address is refused. The size caps are enforced by `keep`, so it can say which one failed (`page-copy.ts:parsePageCopy`, `page-copy.ts:COPY_ERRORS`).
* **Calls run one at a time,** so the index and the stored copies never disagree (`page-copy.ts:createCopyStore`).
* **The capture script leaves a copy for the worker to collect** in the tab, under a global key (`page-copy.ts:CAPTURE_GLOBAL`).

### Quotes and passage links (`quotes.ts`, `note-links.ts`)

* **Saving a quote adds it to the note** of the page's bookmark, or of its saved tab, with a text fragment link (`#:~:text=`) that scrolls to the passage and highlights it. The extension menu and the Android share sheet write the same note (`quotes.ts` module, `quotes.ts:quoteTarget`).
* **A quote's target:** its bookmark, else a saved tab of the page in a session, else a new bookmark. Addresses are compared without a text fragment (`quotes.ts:quoteTarget`).
* **Long quotes are a `start,end` fragment.** A quote longer than `QUOTE_EXACT_WORDS` or `QUOTE_EXACT_CHARS`, or across lines, uses `start,end`. A long exact match breaks on any page change, and an exact match cannot span two paragraphs (`quotes.ts:QUOTE_EXACT_WORDS`, `quotes.ts:QUOTE_EXACT_CHARS`, `quotes.ts:textFragmentLink`).
* **The fragment takes `QUOTE_EDGE_WORDS` at each end.** A line with no spaces, such as Chinese or a long token, is cut by characters instead (`quotes.ts:QUOTE_EDGE_CHARS`, `quotes.ts:edges`).
* **On one line, the start and end must not overlap,** so each takes at most half its words (`quotes.ts:edges`).
* **Fragment terms escape `-`, `&`, and `,`** as well, since they separate the parts of a text directive (`quotes.ts:encodeFragmentTerm`).
* **An existing fragment is dropped from the page address,** and so is a hash left empty by that. Pages opened from a saved quote link report their address with it (`quotes.ts:pageAddress`).
* **A quote is never cut.** One that would take the note past its limit is refused, and the note stays as it was (`quotes.ts:appendQuote`).
* **A quote in a note is each line after `> `,** then the link on a line of its own (`quotes.ts:quoteEntry`).
* **Notes show a passage link as a label.** The stored note keeps the full address, so export, sync, and copy still give it (`note-links.ts` module, `note-links.ts:notePieces`).
* **The label's accessible name repeats only a few words** of the quote (`note-links.ts:EXCERPT_WORDS`, `note-links.ts:passageName`).
* **A note edited by hand can hold a stray `%`,** so decoding tolerates it (`note-links.ts:decode`).
* **The `prefix-,start,end,-suffix` form narrows the match** and nothing else (`note-links.ts:textDirective`).

### Addresses (`web-url.ts`, `url-display.ts`, `tracking-parameters.ts`)

* **Shared helpers are imported, not copied.** The service worker builds into one classic script and imports shared code from `src/`, including `normalizeUrl` from `library-normalize.ts`. Helpers for pages and the import parsers live in `web-url.ts:webUrl`, which the worker does not use ([Extension rules](../agents/extension.md)).
* **Display drops `https://`, `http://`, and `www.`, and a bare `/`,** only when `simplify` is set. Stored, copied, opened, and exported addresses never change (`url-display.ts:displayUrl`).
* **Insecure links are flagged by a marker,** not by a changed address (`url-display.ts:isInsecureLink`).
* **Local and home-network hosts are trusted** and do not get the marker unless `markLocal` is set (`url-display.ts:isLocalHost`, `url-display.ts:PRIVATE_IPV4`).
* **Tracking parameters are removed on open and copy,** and saved URLs keep them. `s` and `t` are removed only on X status links, because they are generic names elsewhere (`tracking-parameters.ts:SITE_TRACKING_RULES`).
* **A malformed key is kept** unless its raw form is a known tracker (`tracking-parameters.ts:isTrackingParameter`).
