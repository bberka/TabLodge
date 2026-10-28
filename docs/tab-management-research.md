# Tab manager comparison notes

These notes keep the useful findings from research done on October 25, 2026. They are background for product decisions, not a current market survey. Prices, store listings, browser features, and competitor behavior may have changed. Check the linked primary sources before publishing a comparison.

For TabLodge's current features, see the [README](README.md#what-you-can-do). Future ideas are listed under [Future work](README.md#future-work). The original research described an earlier version called TabNest; its implementation checklist is no longer useful because many of those features have shipped.

## What people need from a tab manager

### Saved tabs they can trust

Data loss was the most consistent complaint in the reviews examined for OneTab, Session Buddy, and Tab Session Manager. Reported causes included browser storage cleanup, uninstalling, failed migrations, and bugs. A user often cannot tell those causes apart.

The practical lesson is to make backups visible, support files that survive uninstalling, and explain storage limits honestly. Recovery should not depend on a running worker or an in memory tab list. When storage changes, keep the old data until the new copy has been validated.

Sources: [OneTab troubleshooting](https://www.one-tab.com/troubleshooting), [Session Buddy's v4 migration](https://sessionbuddy.com/v4), and [Tab Session Manager releases](https://github.com/sienori/Tab-Session-Manager/releases).

### Restores that don't make things worse

A saved session is useful only if it can be reopened reliably. Large restores can create memory pressure. Partial failures should leave saved links intact, and unloading should use the browser's native discard API rather than replacing tabs with extension pages.

The Great Suspender showed why that last point matters: when the extension was disabled, users were left with suspended URLs pointing into an unavailable extension. Native tabs remain ordinary tabs even if their manager is removed.

Sources: [Session Buddy reviews](https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko/reviews), [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [reporting on The Great Suspender's removal](https://www.bleepingcomputer.com/news/security/the-great-suspender-chrome-extensions-fall-from-grace/).

### Files that work outside one tool

Plain URL lists, JSON, HTML, CSV, and Markdown give users a way to move on if a tool changes or stops being maintained. Imports help people try another manager without recreating their library. Exports should stay available without an account or subscription.

Sources: [OneTab](https://www.one-tab.com/), [Session Buddy](https://sessionbuddy.com/v4), and [Better OneTab's archived repository](https://github.com/cnwangjie/better-onetab).

### Organization without another chore

The research found recurring requests to update a saved session from the current window, append tabs, split sessions, sort by last use, and show whether a page is already saved. Search and keyboard navigation matter as much as folders when libraries grow.

BroTab and Tab Manager Plus are useful references for working with open tabs. They expose actions such as selecting, activating, closing, moving, pinning, muting, and discarding. Their query and keyboard workflows are worth studying without copying BroTab's native messaging setup into a browser extension.

Sources: [BroTab](https://github.com/balta2ar/brotab), [Tab Manager Plus](https://github.com/stefanXO/Tab-Manager-Plus), and [Session Buddy reviews](https://chromewebstore.google.com/detail/session-buddy/edacconmaakjimmfgnblocblbcdcpbko/reviews).

## Useful comparisons

| Tool | What to learn from it | What to check before comparing |
| --- | --- | --- |
| [OneTab](https://www.one-tab.com/) | A simple tab list is easy to understand | Current backup and sync availability; sharing a web page uploads the list |
| [Session Buddy](https://sessionbuddy.com/v4) | Open tabs, saved collections, automatic history, and several export formats | Current restore behavior and export formats |
| [Tab Session Manager](https://github.com/sienori/Tab-Session-Manager) | Open source, tags, automatic saves, and import support | Browser differences and optional sync behavior |
| [Toby](https://www.gettoby.com/) | Visual collections and shared workspaces | [Current pricing](https://www.gettoby.com/pricing), account requirements, and free plan limits |
| [Workona](https://workona.com/) | Workspace switching and automatic saving | Current pricing, sync behavior, and backup limits |
| [Tabs Outliner](https://chromewebstore.google.com/detail/tabs-outliner/eggkanocgddhmamlbiijnphhppkpkmkl) | A tree combining saved and live tabs | Which backup and keyboard features require payment |
| [Sidebery](https://github.com/mbnuqw/sidebery) | Searchable panels, tree views, and snapshots | Firefox API differences and optional sync providers |
| [Vivaldi](https://vivaldi.com/features/tab-management/) | Native stacks, sessions, tiling, and workspaces | What is built into the browser already |

Store review anecdotes are signals, not proof that a bug affects every user or remains unfixed. The earlier research also used vendor comparisons and secondary reporting. This shorter guide keeps the conclusions that are useful without repeating uncertain prices, review counts, or claims about ownership.

## Browser constraints to keep in mind

* **Workers stop.** Manifest V3 service workers can be terminated when idle. Persist important state and rebuild transient tab information when needed. See the [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
* **Alarms aren't a persistent job queue.** Reconcile schedules on startup and installation, and handle missed runs. Check the [alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms) for version specific behavior.
* **Saved groups aren't ordinary live groups.** Don't assume `chrome.tabGroups` exposes the browser's closed, saved groups. See the [tab groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).
* **Split view needs feature detection.** Keep ordinary adjacent tabs as a fallback when a browser lacks the API or rejects a pair. See Chrome's [split view API guide](https://developer.chrome.com/blog/split-view-api-extensions).
* **Metadata isn't page content.** Tab titles and URLs can be managed without host permissions. Reading forms or page text would change the privacy model and require separate design and permission review.
* **Sync storage isn't a large session database.** Its quotas are small. Check the [storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) before choosing where a growing library belongs.
* **Recently closed tabs need another permission.** A future view based on `chrome.sessions` would require reviewing the [sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions) and documenting the permission.

## Boundaries worth keeping

TabLodge's purpose is a local session library and bookmark board, not a cloud workspace or a replacement browser. New features should preserve that distinction.

Use native tab groups, split view, and discarding instead of imitating them with extension pages. Keep automatic tidying conservative: without page access, TabLodge cannot know whether a tab has unsaved form input. Make changes reversible where possible, preserve export access, and treat every new permission as a change users deserve to understand.
