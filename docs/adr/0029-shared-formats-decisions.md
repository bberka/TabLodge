# 29. Import, export, and backup format decisions that were code comments (src/shared)

Status: accepted, 2026-11-25. Issue #442.

## Context

`apps/extension/src/shared/` holds the pure parsers for every importable file (`import-formats.ts`), the builders for every export (`export-formats.ts`, `share-formats.ts`), the identifiers written into JSON backups (`backup-format.ts`), and the full-backup ZIP (`full-backup.ts`). Their non-obvious decisions were comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the symbol that carries it. Backup restore and the Android app's reader depend on these formats, so changing one needs a migration ([Extension rules](../agents/extension.md)).

## Decisions

### Import safety (`import-formats.ts`)

* **Only http and https links survive an import.** Titles lose control characters and are capped. Input size is limited. HTML is tokenized as text and never parsed into a live document (`import-formats.ts:parseImportFile`, `import-formats.ts:cleanTitle`, `import-formats.ts:parseHtml`).
* **Native backups are passed through untouched.** A JSON restore keeps everything the service worker understands: notes, split pairs, folders, column order (`import-formats.ts:parseNative`).
* **Every format is reduced to groups of links,** a session, a bookmark folder, or a list. Each format's own parser feeds the same shape (`import-formats.ts:ImportPreview`).
* **Largest file: 45 MB,** also checked against the text length (`import-formats.ts:MAX_IMPORT_BYTES`).
* **A file with more than 250,000 links is refused as a whole.** An import never drops part of its links (`import-formats.ts:MAX_IMPORT_LINKS`).
* **Each format records how well its structure is known.** The level is checked against the tool's source or real files, or is a best-effort reading (`import-formats.ts:ImportFormatId`).
* **Tags are read from any tool's shape.** They come in unchecked, and the caller normalizes them as bookmark tags are stored (`import-formats.ts:tagList`).
* **Timestamps are read in seconds, milliseconds, or as date strings.** Dates before 1995 or far in the future are ignored (`import-formats.ts:toTimestamp`).
* **Sessions have one description field.** An old description plus notes become one text (`import-formats.ts:cleanNotes`).
* **Folder hierarchy is flattened to columns.** Equal folder names share a column, and links outside a folder join the first named column (`import-formats.ts:mergeBookmarkFolders`).
* **Groups over the per-session limit are split into numbered parts,** and empty parts are dropped (`import-formats.ts:sessionSized`).
* **Native backups are recognized by structure, not by format id,** so a backup written under any id imports (`import-formats.ts:parseNative`, [Backup identifiers](#backup-identifiers-backup-formatts)).

### Readers for other tools (`import-formats.ts`)

These follow each tool's published exporter or API docs. They are best-effort, not checked against real files, and tags are not imported. A link's own note becomes its note.

* **Session Buddy** reads v4 `nxs.json.v2` (collections, folders, links, epoch ms) and v3 `nxs.json.v1` (sessions, windows, tabs, ISO dates). Aliases of either shape are accepted (`import-formats.ts:parseSessionBuddy`).
* **Tab Session Manager** stores lazily loaded tabs as an extension page that carries the real URL in `url=`. The reader unwraps it (`import-formats.ts:unwrapTsmUrl`, `import-formats.ts:parseTabSessionManager`).
* **Toby** lists sit in `lists`, or in `groups` for newer exports (spaces). Any object with a `cards` array is read as a list (`import-formats.ts:parseToby`).
* **A bare JSON array of links** is read as `[{url, title}]` or as URL strings (`import-formats.ts:parseJsonLinks`).
* **Linkwarden** exports `collections`, each with `links` (`name`, `url`, `description`, `createdAt`, `importDate`). `importDate` keeps the date from the tool a link came from. Source: `apps/web/lib/api/controllers/migration/exportData.ts` and `packages/prisma/schema.prisma` at linkwarden/linkwarden@24adcc1 (`import-formats.ts:parseLinkwarden`).
* **Karakeep** exports `bookmarks` (`createdAt` in seconds, `title`, `note`, `lists`, `content`) and `lists`. A bookmark joins the column of its first list. Text notes are skipped. Source: `packages/shared/import-export/exporters.ts` at karakeep-app/karakeep@bcc4b90 (`import-formats.ts:parseKarakeep`).
* **Omnivore** exports a ZIP of `metadata_<from>_to_<to>.json` files, each an array. Import one file at a time. Source: `packages/api/src/jobs/export.ts` at omnivore-app/omnivore@0475038 (`import-formats.ts:parseOmnivore`).
* **Wallabag** exports an array of entries with `created_at` in the form `2016-09-08T11:55:58+0200`. PHP writes the offset without a colon, which not every JavaScript engine parses, so the reader fixes it. Source: `src/Entity/Entry.php` and `src/Helper/EntriesExport.php` at wallabag/wallabag@15a90c6 (`import-formats.ts:parseWallabag`).
* **Pinboard**'s JSON shape is inferred from the posts/all fields (`href`, `description` as the title, `extended` as the description, `time`). The docs show those fields only in XML, so the JSON shape needs a real sample before it is trusted. Pinboard separates tags with spaces (`import-formats.ts:parsePinboard`).
* **Mastodon bookmarks** are a CSV with one status URI per row and no header. A post's URI is `https://<server>/users/<name>/statuses/<id>`, and posts from other servers keep their own URI. Source: `app/models/export.rb` (`to_bookmarks_csv`) and `app/lib/activitypub/tag_manager.rb` (`uri_for`) at mastodon/mastodon@4e9a766 (`import-formats.ts:parseMastodonBookmarks`).
* **Netscape bookmark files** (what every browser exports) and any HTML page with links are read as text. Folders nest through `DL` lists. `DD` after a link is its description. Scripts, styles, and comments are dropped before tokenizing (`import-formats.ts:parseHtml`).
* **Raindrop** writes a link's highlights as a quote under it. Highlights are not imported, and the preview says how many are left out (`import-formats.ts:raindropWarnings`).
* **Raindrop's own name** is the title of the Netscape file it exports, so it is not a bookmark (`import-formats.ts:parseHtml`).
* **Raindrop's CSV** is recognized by the columns no other tool writes (`import-formats.ts:RAINDROP_CSV_MARKERS`). A link saved without a collection ("Unsorted") goes to the default column, not to a column of its own (`import-formats.ts:unsortedToDefault`).
* **Tags split on commas and bars by default,** as Raindrop and Pocket files do. Netscape `TAGS=` splits on commas only, so its reader passes that separator explicitly (`import-formats.ts:tagList`, `import-formats.ts:parseHtml`).
* **Unnamed `DL` wrappers do not become columns.** Root links stay loose for the first column (`import-formats.ts:parseHtml`).
* **CSV rows follow RFC 4180:** quoted fields may contain the delimiter, quotes (`""`), and line breaks (`import-formats.ts:parseCsvRows`).
* **Spreadsheet exports prefix formulas with an apostrophe.** It is removed again on import (`import-formats.ts:unguard`).
* **With both a session or column and a folder column, the folder is the session's folder.** Otherwise the folder or path column names the group (`import-formats.ts:parseCsv`).
* **OneTab "Export URLs"** is `url | title` per line, groups separated by blank lines, with no header (`import-formats.ts:parseOneTab`).
* **Markdown lists of links** are read in the form this extension's Markdown export writes, `[title](url)` or `[title](<url>)`. The angle-bracket form allows parentheses in the URL (`import-formats.ts:parseMarkdown`).
* **Plain URL lists** take the first http or https URL on a line as the link. The rest of the line is its title, or else the line above (`import-formats.ts:parseUrlList`).
* **Browser bookmark trees** (`chrome.bookmarks.getTree`) are read as folders, the same way the service worker imports them (`import-formats.ts:parseBookmarkTree`).
* **A TabLodge export keeps its pinned tabs.** The setting that skips pinned tabs filters only other formats (`import-formats.ts:previewImport`).
* **Pass-through payloads.** A native backup with sessions goes to the session importer as is, else the converted groups go. The same rule applies to bookmarks (`import-formats.ts:sessionImportPayload`, `import-formats.ts:bookmarkImportPayload`).
* **TypeScript cannot see that `finish()` sets the pending folder,** so the parser keeps the value in a variable the narrowing can follow (`import-formats.ts:parseHtml`).

### Export (`export-formats.ts`)

* **JSON is the full, re-importable backup.** HTML, CSV, Markdown, and plain URLs trade fidelity for portability, analysis, or readability (`export-formats.ts` module).
* **A sessions export can be limited to the tabs picked on the dashboard** (`export-formats.ts:ExportKind`).
* **Dates use local calendar time** as `YYYY-MM-DD` (`export-formats.ts:dateStamp`).
* **File names carry the display name, what was exported, and the date.** A session name appears only for single-session exports (`export-formats.ts:exportFilename`).
* **Unfiled bookmarks come last** under `null` in board order (`export-formats.ts:bookmarkSections`, `export-formats.ts:bookmarkShareGroups`).
* **Netscape files carry bookmark tags in `TAGS=`,** as Pinboard, Raindrop, and Firefox write and read them. A note is the link's `DD` description (`export-formats.ts:toHtml`).
* **Spreadsheet cells are quoted when needed,** and text a spreadsheet would run as a formula is prefixed with an apostrophe (`export-formats.ts:csvCell`).
* **A byte-order mark tells spreadsheet apps the file is UTF-8** (`export-formats.ts:buildExport`).
* **Web URLs never contain spaces or angle brackets,** because URL parsing encodes them, so `<url>` is always safe in Markdown (`export-formats.ts:markdownUrl`).

### Backup identifiers (`backup-format.ts`)

* **Identifiers are changed here only.** Export writes them, and import recognizes backups by their structure: a `groups` array of sessions, or `bookmarks` and `bookmarkColumns`. Files carrying any other id still import.
* **Identifiers in use:** `tablodge-sessions` (sessions and selected tabs), `tablodge` (bookmarks), `tablodge-backup` (sessions, bookmarks, and settings, from the automatic and safety backups), `tablodge-full-backup` (the full ZIP manifest). The JSON backup version is `BACKUP_VERSION` and the ZIP version is `FULL_BACKUP_VERSION`, both 1 (`backup-format.ts:SESSIONS_FORMAT_ID`, `backup-format.ts:BOOKMARKS_FORMAT_ID`, `backup-format.ts:BACKUP_FORMAT_ID`, `backup-format.ts:FULL_BACKUP_FORMAT_ID`).
* **The file-name prefix is the manifest's `short_name` in lower case** (`backup-format.ts:fileNamePrefix`).
* **A full-backup ZIP with a higher version comes from a newer app** (`backup-format.ts:FULL_BACKUP_VERSION`).

### Full-backup ZIP (`full-backup.ts`)

* **The ZIP holds `manifest.json`, `data.json`, `preferences.json`, `snapshots.json`, `trash.json`, and `copies.json`.** The module builds and reads the archive. The worker validates the contents (`full-backup.ts:FILES`).
* **Page copies are optional,** because backups made before copies existed have none (`full-backup.ts:FullBackupParts`).
* **Counts come from the data itself,** not from the manifest (`full-backup.ts:FullBackupCounts`).
* **Everything goes to the worker in one message,** which Chromium caps near 64 MB. Unpacking is capped at 60 MB (`full-backup.ts:MAX_UNPACKED_BYTES`).
* **A ZIP is recognized by its local file header** (`full-backup.ts:looksLikeZip`).
* **A protected backup is not a ZIP until decrypted,** so its name does not end in `.zip` (`full-backup.ts:protectedFullBackupFilename`).
* **Only the full-backup ZIP is ever protected,** with the envelope in [ADR 28](0028-shared-library-storage-decisions.md) (`full-backup.ts:protectFullBackup`).
* **A wrong credential or a damaged file reads nothing.** A decrypted file that is not a TabLodge backup returns null (`full-backup.ts:readProtectedFullBackup`).
* **Only the listed entries are read.** A `locked.json` from a backup made while the locked area existed is skipped (`full-backup.ts:readFullBackup`).

### Share (`share-formats.ts`)

* **The Share dialog builds an HTML page, Markdown, plain links, and rich text,** with the escaping in `escape-html.ts` (`share-formats.ts` module).
