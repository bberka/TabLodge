# Architecture and behavior notes

Reference notes for contributors: how the extension is built and loaded, how data is stored, and the detailed behavior of each feature. The [README](../README.md) has the overview, install steps, and permissions; [PRIVACY.md](../PRIVACY.md) covers data handling.

## Build pipeline

`scripts/build.ts` produces the loadable package in `dist/tablodge/` (`OUT_DIR` in `scripts/vite-shared.ts`) from several Vite+ builds that write into the same folder:

- **Pages** (`vite.pages.config.ts`): `extension/*.html` are source shells that hold only an empty `#root` element and a `theme-boot.js` classic script in `<head>`. The build injects the React entry for each page (`src/app/<page>.tsx`), replaces `%APP_NAME%` in the titles, bundles all UI assets locally, writes `manifest.json` (adding `homepage_url` from `package.json`), and copies `icons/`.
- **Service worker** (`extension/service-worker.ts`): a classic (non-module) script bundled as one IIFE; the manifest declares no `"type": "module"`.
- **Theme boot** (`extension/theme-boot.ts`): a tiny classic script loaded synchronously in every page's `<head>`. It applies the saved Light/Dark/System choice before the first paint so each page opens on its themed background with no loading text or flash; the React UI renders into `#root` once the saved state arrives. `src/shared/theme.tsx` mirrors the theme stored in `chrome.storage.local` (`uiTheme`) into this extension's `localStorage` (`tablodge.uiTheme`) for it.

`scripts/verify-build.ts` then checks the package: every manifest-referenced file exists, built HTML loads only local bundles (no CDN, no inline scripts, no source paths), classic scripts parse as classic scripts and contain no `process.env`, every page loads `theme-boot.js` before its module script, and the manifest `version`/`homepage_url` match `package.json`.

`extension/` is source, not an installable package: never load it or the repository root. A build recreates `dist/tablodge/`, so do not run two builds at once.

## Project metadata and naming

- **Display name:** `short_name` in `extension/manifest.json` (`TabLodge`). Pages read it at runtime through `PROJECT.name` (`src/app/project.ts`), HTML titles get it at build time (`%APP_NAME%`), and the service worker reads it as `APP_NAME`. The manifest `name` is the full store title, `TabLodge – Tab Session Manager & Bookmarks` (42 characters: under the 45-character limit of Firefox AMO and Edge Add-ons, and Chrome's 75). The Chrome Web Store and `chrome://extensions` show `name`; the browser falls back to `short_name` where space is tight. `action.default_title` (the toolbar tooltip) and the command descriptions sit next to them in the same file.
- **Version:** `version` in `extension/manifest.json`; `package.json` `version` must match (the build verification enforces it).
- **Repository URL:** `package.json` `homepage` and `repository.url`. `PROJECT.repoUrl`, `issuesUrl`, `changelogUrl`, and `licenseUrl` derive from `repository.url`; the manifest `homepage_url` is written from `homepage`. Both point to https://github.com/bberka/TabLodge.

### Persistent identifiers

These names are stored in user data or exported files. Changing them later requires a migration:

- storage keys: `tablodge.state` in `chrome.storage.local` (sessions, bookmarks, and settings) and `tablodge.uiTheme` in the pages' `localStorage` (theme mirror for `theme-boot.ts`);
- export formats: `"format": "tablodge-sessions"` for session JSON and `"format": "tablodge"` for bookmark JSON (written on export; import recognizes backups by structure, not by this id);
- drag-and-drop MIME types: `application/x-tablodge-session`, `application/x-tablodge-column`, `application/x-tablodge-bookmark`;
- context-menu ids `tablodge-page-*` and `tablodge-action-*`.

The build output folder also matters for development: an unpacked extension's ID comes from the folder it is loaded from, and its storage belongs to that ID, so loading a build from a different folder starts with empty storage.

## Data model and storage

`src/app/types.ts` holds the data model and the typed message protocol between the pages and the service worker. Pages send messages with `send()` (`src/app/common.tsx`); the service worker owns all reads and writes of `chrome.storage.local`.

Local state is versioned under `tablodge.state` (schema v7); older session data is normalized on load, and data saved by a newer schema is refused rather than overwritten. Session, bookmark, and preference data stays in `chrome.storage.local`; there are no accounts, servers, or cloud sync. Incognito tabs are available only if the browser permits the extension in incognito mode.

## Shared UI

The pages share a restrained neutral token system (`styles/extension-app.css`) and local shadcn-style primitives. `components.json` is the shadcn CLI configuration; generated source lives in `src/components/ui/`, while `src/shared/ui.tsx` re-exports them with a few composed helpers (confirmation dialog, icon tooltip, expanding search). To add a primitive, run `pnpm dlx shadcn@latest add <component>` and review the generated source before committing it. Keep dependencies bundled locally; never add a CDN import. The `@/` alias maps to `src/` in every build and in `tsconfig.base.json`; it is resolved at build time and must not remain in runtime bundles.

## Testing approach

`tests/service-worker.test.ts` runs the type-stripped `extension/service-worker.ts` source in a fresh Node VM context per harness, against a mocked `chrome.*` API (tabs, windows, tab groups, split view, storage, context menus, bookmarks). It also unit-tests the drag-and-drop and clipboard helpers in `src/app/interaction-actions.ts`. The mocked tests and the build do not replace a browser smoke test: load `dist/tablodge/` in a Chromium-based browser for manual testing.

## The main page

The local **new-tab page** is the main TabLodge destination. It includes bookmark columns and search, followed by the full session manager: folder filtering/management, session search and sorting, multi-select export/share, saved-tab details, restore, rename, edit, reorder, move, archive, lock, and delete actions. Settings stays on its own page. The toolbar popup remains a quick chooser; only its explicit **Open TabLodge** action opens the full page in a separate tab.

The browser’s Side Panel is optional. Enable **Open TabLodge in the browser Side Panel** in Settings to make the toolbar button open a searchable bookmark list there. The Side Panel can open, copy, edit, and delete bookmarks; it uses the same local data as the main page.

## Sessions and pinned tabs

- The toolbar action defaults to the compact popup. Settings can instead make it save selected tabs (or the current window), the full window with native tab groups, the active group, the active tab, all normal windows, or send the active tab to the first unlocked session. Page context menus and browser shortcuts provide additional save paths; shortcuts can be changed at `chrome://extensions/shortcuts` or `brave://extensions/shortcuts`.
- **Pinned tabs are ignored by default.** The explicit **Include pinned tabs** Settings option is required to save them. A pinned tab may be closed only after the session has been written successfully and **Close tabs after saving** is enabled; the service worker checks the tab’s URL and pinned state again before removal. Restore preserves `pinned: true`.
- Turning the option off leaves pinned tabs out of subsequent captures and close operations.
- Restore one tab or a complete session. The default destination is a new window unless the current window contains only the current tab; Settings also offers current-window and always-new-window policies, and a session card offers “Restore in this window” and “Restore in a new window” next to its Restore button. Ctrl/Cmd-click keeps the saved session, Alt-click archives it, and Shift-click opens a new window. Choose whether restores keep, remove, or archive saved tabs; locked sessions always keep them. Single-tab activation, restore duplicate handling, and optional background-tab unloading are configurable. Restore failures are reported, and removal applies only to tabs that opened successfully.
- Sessions support folders, search/sorting, notes, details, reordering, single-tab and full-session restore, selected-tab export/share, and delete actions. Session import/export is in the Sessions ⋯ menu, not in Settings.
- **Close tabs after saving** is controlled in Settings, not in the popup. TabLodge stores the session first and rechecks each close candidate before removal.

## Split view tabs

Chromium-based browsers can show two tabs side by side in one tab-strip slot (Split View). TabLodge saves and restores these pairs; the extension API it uses (`chrome.tabs.createSplit`, `Tab.splitViewId`) needs Chromium 155 or newer and no extra permission.

- **Saving.** Every save path (window, selected tabs, all windows, tab group, left/right of a tab, context menus, shortcuts) records which saved tabs form a pair, with a pair key that stays stable inside the session (not the browser's temporary split id) and the left/right order. A pair is recorded only when both tabs end up in the session: if only one half is selected, or its partner is an excluded site, an ignored pinned tab, or a rejected duplicate, the remaining tab is saved as a normal tab. Both highlighted halves of the active split view count as one tab, not as a multi-tab selection.
- **When the active tab is in a split view** (Settings, When saving): **Save both tabs** (default) or **Save only the focused tab**. The focused-only choice applies to selection saves (the Save selected tabs shortcut and menu items, and the toolbar's selected-tabs mode when it saves a selection). Only the active split view is reduced; other split views are saved in full. Whole-window saves always keep both tabs, and tabs picked in the popup's chooser are saved exactly as picked.
- **Restoring.** With **Tabs saved from a split view: Keep them side by side** (default), a pair whose two tabs both open is recreated as a split view: the tabs open next to each other with their saved pinned state, native tab groups are created first (so both halves share a group, as the browser requires), then the pair is split, and group titles, colors, and collapsed state are applied last. **Open as separate tabs** opens them as neighboring normal tabs. Restoring one tab of a pair, or a pair whose partner was skipped as already open or failed, opens a normal tab. On browsers without the API TabLodge silently opens normal tabs; if the browser refuses a split, the tabs still open and the page shows a short note ("1 split view opened as separate tabs"). This never counts as a failed tab. **Unload background restored tabs** leaves split tabs loaded, because either half can be visible.
- The session list shows a pair as two joined rows on a shared background with a **Split** badge. Shared HTML marks them "Split view, left/right".

TabLodge saves only ordinary `http:` and `https:` URLs. Browser-internal pages and unsupported URLs are skipped. Native tab-group metadata is restored on a best-effort basis.

## Bookmarks

- Bookmark the active page from the popup or page/toolbar context menu; the popup uses the current tab’s title and URL. Manually added/imported links prefer supplied metadata, then a matching open-tab title, then a readable URL label. TabLodge does not scrape websites or request host permissions.
- Add a bookmark manually, drag a browser link onto the new-tab page when the browser exposes link data, or import a TabLodge bookmark JSON file or the browser’s bookmark tree from the ⋯ menu on the Bookmarks toolbar of the main page. Browser bookmark folders become ordered columns; duplicate URLs are handled by the import-specific choice when duplicates are detected.
- Create, rename, and reorder bookmark columns. Any column—including the built-in or last one—can be deleted only after an in-app confirmation. Bookmarks move to a selected remaining column; when the last column is removed, links remain visibly available under **Unfiled**.
- Bookmark drag/drop shows an insertion marker, supports reordering within a column, and moves bookmarks across columns. Column drag/drop supports pointer/touch and mouse input; the column menu also has keyboard-operable **Move column left/right** actions. Bookmark menus can open a link, open it in a new tab, edit, copy its URL, move/reorder it, or delete it.
- Favicons use the browser’s local favicon service with a text fallback; TabLodge does not use third-party favicon hosting.

Sessions and bookmarks can each be disabled in Settings without deleting their local data. Disabled systems reject mutations until re-enabled. At least one system must remain enabled; the service worker enforces this as well as the interface. Bookmark data is stored in `chrome.storage.local` and does not sync through TabLodge.

## Settings and appearance

- Choose **System**, **Light**, or **Dark**. System follows device-theme changes live.
- **Use TabLodge for new tabs**: Chromium declares new-tab overrides statically, so switching this off cannot uninstall the override. Instead the service worker watches `tabs.onCreated` for tabs the browser opens as new tabs (pending URL `chrome://newtab/`) and immediately redirects that tab with `tabs.update` to the chosen **When off, new tabs show** target: the browser’s own page (`chrome://new-tab-page/`, `brave://newtab/` best effort in Brave), `about:blank`, or a custom http(s) page. `newtab.html` renders nothing while it asks the worker (`HANDOFF_NEW_TAB`) whether it is a claimed new tab, as a fallback if it loaded first. A per-tab redirect counter prevents loops: a tab sent back to TabLodge is retried once, then sent to `about:blank`. `chrome://newtab/` itself is not usable as a target because the override captures it. The dashboard stays usable when opened on purpose. The address bar usually has focus on the browser’s page but may not on blank or custom pages.
- Choose whether TabLodge opens on browser startup and whether to show the local page or restore the newest session. Settings also cover toolbar action, opening the saved session after saving, optional Side Panel and context menus, pinned-tab opt-in, safe close-after-save, restore destination/default keep-remove-archive behavior, save-time duplicate handling (allow or silently reject, keeping the existing title or taking the latest), restore-time duplicate URLs, single-tab activation, split view saving and restoring, URL display, whether sessions start expanded on the TabLodge page (**Keep sessions expanded by default**, off by default; each session can still be collapsed or expanded), what clicking a session title does (expand or collapse by default, open details, or restore), session sort and title-click behavior, copy format (Markdown, rich text with a title/URL fallback, title then URL, URL then title, or URL only), background unloading, and site exclusions. Preference reset leaves saved data unchanged.

## JSON data

The Sessions ⋯ menu provides session JSON import/export; the Bookmarks toolbar ⋯ menu provides bookmark-file import/export and explicit browser-bookmark import, and Settings › Data can also export bookmarks. Session JSON contains sessions and folders; bookmark JSON contains bookmark columns and bookmarks. A saved tab that belongs to a split view carries `"split": { "id": "<pair key>", "position": 0 | 1 }` (0 is the left tab). On import, split info is kept only for complete pairs (two neighboring tabs with the same key, one at each position, and the same pinned and tab-group state); malformed, orphaned, or mismatched split info is dropped and the tabs import as normal tabs. Exports without split info, including older ones, import unchanged. Import duplicate choices appear in the relevant import dialog only when duplicates are found. Choose whether to skip or keep duplicate URLs; when skipping, choose whether to preserve an existing title or use the imported title. Updating a session tab’s title preserves its existing notes. Restore duplicate handling is a separate Settings preference. Imported web links are validated and unsupported URLs are ignored. Export files are plain text, not encrypted. Treat them as private when titles, URLs, or notes are sensitive.

## Permissions in practice

TabLodge requests no website host permissions, injects no scripts into web pages, and sends no browsing data to a service. Session, bookmark, and preference data stays in `chrome.storage.local`; there are no TabLodge accounts, servers, or cloud sync.

See the README for why each permission is requested.

## Behavior summary

Pinned tabs are opt-in. Restores can keep, remove, or archive saved tabs; locked sessions always retain their saved tabs. Import duplicate choices are made in the applicable import dialog, while restore duplicate handling remains a separate preference. Bookmark import and export are in the Bookmarks toolbar ⋯ menu (Settings › Data can also export bookmarks); session import/export is in the Sessions ⋯ menu. The built-in Help page documents toolbar actions, restore modifiers, and browser API limitations.
