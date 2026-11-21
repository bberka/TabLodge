# 13. Live shared pages and password checks without client script

Status: accepted, 2026-11-21. Issue #468.

## Context

Shared pages ([ADR 12](0012-shared-page-import.md)) were static snapshots: once uploaded, editing the column or session did not change the page, and anyone with the link could view every link on it. Users wanted live links that stay current with a column or session, and optional password protection on both snapshots and live links.

Two constraints shaped the design:

1. **The server never parses or decrypts library records ([ADR 1](0001-record-level-sync-protocol.md)).** Even for the regular library, the sync server stores opaque change-log entries, and the private library is end-to-end encrypted and has no page routes at all. The server therefore cannot render a live page from the change log on its own.
2. **Shared pages cannot run JavaScript.** Public pages are served under a strict `Content-Security-Policy` with `default-src 'none'` and `sandbox`, so password verification cannot rely on client-side script.

## Decision

* **Devices update live pages in place after sync.** A live link is a shared page row with `mode = 'live'` and `source` (`column:<id>` or `session:<id>`). The server exposes `POST /v1/pages/:id/update` (authenticated with the sync token) to replace a live page's title, HTML, size, and `updated` timestamp while keeping its `id`, `source`, `mode`, and `password_hash`. After a regular sync round finishes on either the extension or the Android app, the device checks the server's live pages, rebuilds the HTML for any whose column or session changed (using a content fingerprint to skip unchanged pages), and posts the update.
* **Private library and offline behavior.** The private (encrypted) library is never shared by link and never uploads live pages. For the regular library, while no device is online, visitors continue to see the last uploaded HTML until a device comes online and syncs its edits. Stopping/deleting a live link calls `POST /v1/pages/:id/delete`, after which `GET /p/<id>` returns `404`.
* **Server-side password prompt without JavaScript.** When a shared page is uploaded with an optional password, the server validates it with the shared credential rules, normalizes it with `NFKC`, hashes it with PBKDF2-SHA256 (100,000 iterations, 16-byte random salt), and stores only the hash (`password_hash`). No plain password is stored or returned.
* **HTML form unlock on `GET`/`POST /p/<id>`.** For a password-protected page, `GET /p/<id>` returns `401` with `X-TabLodge-Password-Required: 1` (exposed in CORS) and a minimal server-generated HTML `<form method="post" action="/p/<id>">` under a no-script CSP (`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`). Because no `WWW-Authenticate` header is sent, browsers render the form directly without a native basic-auth popup. `POST /p/<id>` checks the submitted `application/x-www-form-urlencoded` password (rate-limited per page id to throttle guessing): a wrong password re-renders the `401` form with an error; the right password returns `200` with the stored page HTML under the strict sandboxed `PAGE_HEADERS`.
* **Import from a link.** `importFromLink` detects `401` with `X-TabLodge-Password-Required: 1` and prompts the user for the password, then posts `password=<value>` to `/p/<id>` with `credentials: 'omit'` to unlock and parse the page.
* **Feature gate.** All new server behavior (`mode`, `password`, `POST /v1/pages/:id/update`, `POST /p/<id>`) sits behind the `shared-page-live-password` feature in `/v1/status` and `SERVER_FEATURES`. Older servers continue serving snapshots, and both apps explain what updating the server enables instead of hiding controls silently.

## Consequences

* Live links work identically whether or not a library's sync records are opaque to the server, preserving ADR 1.
* Edits made while offline appear on a live link only after a device comes online and syncs.
* Password verification works in any browser with zero client-side script and never exposes links or page metadata before the password is verified.
