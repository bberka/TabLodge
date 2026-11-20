# 8. Sources settings sync as their own record kind

Status: accepted, 2026-11-20. Issue #382.

## Context

**Settings › Sources** choices (which sites are on, each site's column, and its save mode) lived in `tablodge.sources` in one browser and had to be repeated in every other one. Issue #382 asks for them to sync.

Two things make this harder than a new setting:

* The site's access is an optional host permission, which only a click in that browser can grant. A synced choice cannot switch a site on by itself.
* Any new field or preference id inside records that 0.3.0 extensions already sync is dropped by their normalizer and the loss is pushed back ([ADR 5](0005-bookmark-notes-sync.md)). A `preference` record with an id 0.3.0 does not know looks deleted at its next capture.

## Decision

* Each site that is on is a record of kind `source`, keyed by the site id, whose value is the site's choices (`{columnId?, keepOffSite?}`). A site that is off has no record, so **Remove** in one browser is a delete and turns it off in every browser.
* Clients sync `source` records only when the server lists `sources` among the `features` of `/v1/status`, and only when the sync host has a Sources hook. Only the extension's regular library client has one. The private library's client and the Android app skip the kind on pull and leave it out of capture, so they cannot delete a choice.
* The choices are stored in `tablodge.sources` as they arrived and handed back unchanged. A site or field this version does not know survives, and so does a save mode on a site where this version does not offer it.
* Whether a site runs in a browser stays local: it runs only while it has a choice and that browser grants its permission. A browser without the permission shows **On in another browser** with **Turn on**, and the dashboard points to it once. A browser that already grants it turns the site on by itself. Revoking access in one browser turns the site off there only.
* The per device **Sync settings** switch does not cover Sources. A choice is "on" by being present, so a browser that held its choices back would push deletes for every site it never applied once the switch came back on.
* A client remembers which optional kinds its last pull took. When one becomes available (the browser updated from 0.3.0, or the server was updated), the next round pulls from the start, so records it skipped before are not lost behind the cursor. The same holds for bookmark notes and the trash.
* `PROTOCOL_VERSION` stays 1.

## Consequences

* 0.3.0 extensions refuse the kind in `parseChange` and skip it, so they never see a choice and cannot erase one.
* Choices reach other browsers only once the server is updated. Until then each browser keeps its own, and Settings › Sync lists what is missing.
* A later site or save mode (#391) needs nothing more than a new field in the value.
