# 7. Readable page copies

Status: accepted, 2026-11-17. Issue #278.

## Context

Links rot, and TabLodge kept only a page's address and title. Issue #278 asked for saved copies of pages. The maintainer's decisions for the first version: readable text only, kept on the device, in the extension and the Android app together, with no sync and no copies on the server (#284 waits). The browser copies the open tab through `activeTab`; the phone copies any saved link, through the sync server when one is connected and directly otherwise. Copies go into the backup ZIP, and none are made in private windows or for a locked private library.

Finding the article in a page is the hard part. Mozilla's Readability (Apache-2.0) does it well, but needs a DOM `Document`. Extension pages have one. The service worker, React Native's Hermes, and Cloudflare Workers do not.

## Decision

* **Readability for the extraction, in both apps.** `apps/extension/src/shared/page-extract.ts` takes a `Document`, runs `@mozilla/readability` on it, and walks the element Readability returns into text blocks: heading, paragraph, list item, quote, code. Script, style, and other non-text elements are skipped on the way, and if Readability finds nothing the page body is walked without its navigation, header, footer, and sidebars.
* **The extension reads the page it has.** `page-copy-capture.js` runs in the open tab under `activeTab` and `scripting`, which the manifest already declares, so no permission is added. It passes a clone of the rendered page to the extractor, so a page built by scripts, or one behind a sign-in, is copied as the person sees it.
* **The phone parses with `linkedom` (ISC).** Before choosing it, Readability and `linkedom` were bundled into a release build and run on an Android 13 emulator under Hermes: the article came out, script text was dropped, and it took 3 ms. The Hermes bytecode grew from 3.16 MB to 4.03 MB. Writing an extractor of our own was the alternative; it would be smaller but worse at finding the article on real pages, and Readability's handling of those pages is the point.
* **Text blocks, never HTML.** A copy is `{v, url, title, byline?, savedAt, blocks}` and both readers draw the blocks as text nodes. Nothing from the page can run, so no sandboxed frame is needed, and the stored shape is the same in both apps.
* **A copy belongs to an address, not a link id.** The phone's Undo puts deleted links back under new ids, and a bookmark and a saved tab of the same page should share one copy. A copy lives while a link in the library or the trash has its address, so it follows its link into the trash, comes back on restore, and goes when the trash is emptied or purged. Editing a link's address drops its copy.
* **One store, two backends.** `page-copy.ts` keeps an index (`tablodge.copies`) and one key per copy (`tablodge.copy.<hash>`) behind a three-call storage interface: `chrome.storage.local` in the extension, the SQLite key-value store on the phone. It enforces 1 MB of text per copy and 25 MB per device. The budget leaves room beside the library in a full backup, which travels in one message and one ZIP the extension caps near 60 MB.
* **The server passes pages on, and stores nothing.** `/v1/page-source` returns a whole page (3 MB at most) under the same address rules as previews, and is listed as the `page-source` feature. The phone extracts the text itself, so the server needs no DOM. A server without the route makes the phone fetch the page directly.

## Consequences

* Two new dependencies: `@mozilla/readability` in both apps and `linkedom` in the Android app (a dev dependency of the extension for tests). The extension's `page-copy-capture.js`, the only bundle with Readability in it, carries its Apache-2.0 notice as a banner the build adds. The Android app has no screen of third party notices yet; adding one is a follow-up.
* The extension can copy only the open tab, and the phone cannot copy pages behind a sign-in. Help says so.
* Copies do not sync and are not on the server, so each device keeps its own. #284 is where that would change.
* The side panel cannot grant `activeTab`, so its **Keep a copy** item shows only while TabLodge can already read the tab.
