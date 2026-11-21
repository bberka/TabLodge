# 12. Shared pages carry their data, and pick their own id

Status: accepted, 2026-11-21. Issue #350.

## Context

A shared page is HTML a device builds and the server stores as bytes ([ADR 1](0001-record-level-sync-protocol.md)) and serves at `/p/<id>` under a CSP with `sandbox` and no script. Visitors could read it but not bring it into TabLodge: pasting its address into Import added the address as one link, and a saved copy imported as one flat folder. The page could not link to itself, because the server chose its id after the page was built.

## Decision

* **The page carries its groups as JSON.** `src/shared/shared-page-data.ts`, `sharedPageDataBlock`, writes a `<script type="application/json">` that no browser runs. `<` is escaped as `<`, so no title can close the element early. `import-formats.ts`, `parseSharedPage`, reads it before the generic HTML reader, through the same collector, so the URL filter and the caps apply. It also gives the import its kind, so a column shared as bookmarks does not land as a session. The server never reads the block.
* **The device picks the id.** A server that lists `shared-page-import` keeps the `id` and `source` a device sends with `POST /v1/pages`, and answers 409 for a taken id. Only then does a page get its own link, and with it the Add to TabLodge panel. `source` (`sharedPageSource`, `column:<id>` or `session:<id>`) lets Share list the links made from one column or session. `SqlPageStore` adds the `source` column to an older table on start. It probes with `SELECT source … LIMIT 0` because both SQLite runtimes, Node and the Durable Object, answer that.
* **Ids take their randomness from the caller.** `newSharedPageId(randomBytes)` defaults to `crypto.getRandomValues`. The Android app passes `expo-crypto`'s `getRandomBytes`, because Hermes has no global `crypto`.
* **A link checked against its server.** The extension sends the `linkBase` its page link was built from, and the worker refuses the upload when that is not the connected server's, so a page never names one server and lives on another.
* **No CORS change.** Every server answer already sends `Access-Control-Allow-Origin: *`, which is how the extension reaches the API without a host permission, so it can read another person's `/p/<id>`. `tests/shared-pages.test.ts` keeps that true for pages.
* **No new extension permission.** The page cannot run script, which rules out `externally_connectable` and `postMessage`. The toolbar popup already sees the active tab's address through `tabs`, and offers Add this shared page when `isSharedPageUrl` matches (`…/p/` and 22 id characters). A one-click button on the page would need a host permission per server.
* **Android opens the page with an intent.** The Add panel links `intent://import?url=<page>`, which falls back to the website when the app is missing. Any app can send `tablodge://import?url=`, so the app reads it without a tap only when `isSharedPageUrl` passes, and otherwise prefills the field.
* **Import from a link is bounded.** `importFromLink` keeps its 20 second timeout until the body is read, and reads the body as a stream, stopping at `MAX_IMPORT_BYTES` even without `Content-Length`. React Native's fetch has no body stream, so the Android app reads links with `XMLHttpRequest` (`apps/mobile/src/transfer/capped-fetch.ts`) and aborts it on progress once the text that has arrived passes the cap. It counts that text itself, because React Native 0.88's Android reader sends the same byte count with every progress event.
* **The page loads nothing.** Site icons are letter tiles in eight hues picked from the host, because the CSP blocks every image, `data:` included. Sections do not use `content-visibility`: headless Firefox left one blank, and the 623 link page loads in about 75 ms without it. Links have a 24px line box for the WCAG target size.
* **Deleting a page asks first** in the dashboard dialog and the share sheets, because the server cannot bring a page back.

## Consequences

* Pages shared before this change keep their old look and have no data block. Import reads their links as a plain web page, in one group.
* A server without `shared-page-import` still takes pages. They get a server id and no source, so they have no Add panel and appear only in Shared pages.
* The data block repeats the page's content, so a page is about 60% larger. The 623 link page is about 215 kB, under the 1 MB cap.
