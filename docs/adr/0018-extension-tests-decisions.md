# 18. Extension test decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/extension/tests` carried its non-obvious decisions as comments. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the test or helper that carries it. This ADR covers every test file except `service-worker.test.ts`, which is its own part. Test names already state most behavior; only the reasons that no name or assertion carries are listed here. The file list and `file:symbol` references are for the test that holds the decision.

## Decisions

### Accent colors (`accents.test.ts`)

* **Dark page lightens a too-dark accent.** `dark`: the variable is lightened for the dark page.
* **Chromium reports a blue when the platform has no accent.** `a custom accent is made legible and gets a readable foreground`: the test uses that blue as the system accent.
* **Pure yellow is darkened on the light page only.** `light`: unreadable on light, kept on dark.
* **Slate's dark shade is lighter than its light shade.** `brightness`: slate is too dark to read on the dark page as it is.

### Right-click menus (`context-menus.test.ts`)

* **The mock is stricter than the real API.** `workerPath`: each harness runs the type-stripped worker in a fresh VM context. The chrome mock uses the callback-style API of Chrome 116 to 122 (no promises), reports duplicate or orphaned ids through `runtime.lastError`, and fires `storage.onChanged`.
* **Chrome delivers `onChanged` after the write.** Asynchronously, so the test waits on the fake clock.
* **Firefox and Chromium 149 or newer list the tab strip's context.** `item`: the menu uses `ContextType: listsTabContext`.
* **Callback-style `removeAll`.** `item`: as on Chrome 116 to 122, nothing is returned.
* **A bookmarked address counts as saved in any column.** `saved`.
* **Allowed duplicates may repeat an address in another session.** `sending this tab honors rejected duplicates, excluded sites, close on save, and a vanished session`: matches the toolbar.
* **The fragment does not make a new bookmark.** `bookmarks`: a page opened from the saved link reports the address with the fragment, and it is still the same bookmark.
* **A page may not run Undo.** `response`: another tab may not take back this toast's quote.
* **The tab strip ignores `documentUrlPatterns` in Chromium.** `dashboard`: the items also show on the dashboard's own tab.

### Encryption and passwords (`crypto-envelope.test.ts`, `passcode.test.ts`)

* **The one rule is 4 to 128 characters of any kind.** `the same password typed in composed or decomposed form decrypts`: a short word or a number-only password is accepted here.
* **A value that already opened something skips the new-password rule.** The same test: it is passed on without the rule.
* **Length counts characters, not UTF-16 units.** `two entries are the same password when they are the same text after the normalization the key uses`: four emoji are 8 units but 4 characters, digits of any script are digits, and a compatibility form (full width letters) counts as the letters it becomes.
* **Length is judged after the key's normalization.** `length is judged after the normalization the key is derived with, so the same text is judged the same`: four code points that normalize to two characters are too short however they were typed.
* **A short or number-only password gets a hint while typed.** `a short or number-only password gets a hint while it is typed, and a longer mixed one does not`.

### Drag autoscroll (`drag-autoscroll.test.ts`)

* **Small panes get a small strip.** `edgeVelocity still scrolls, more slowly, for reduced motion`: a 100 px pane gets a 30 px strip, so its middle never scrolls.

### Search (`global-search.test.ts`)

* **A session restored just now is the most recent.** `listed`: an old session restored just now counts as the most recent.

### Import and export (`import-export.test.ts`, `import-other-tools.test.ts`, `library-normalize.test.ts`)

* **Pinned state from other tools is dropped.** `Tab Session Manager export: windows keyed by id, tab order, and lazy-load placeholder URLs`: the importer never filters those tabs out.
* **Invalid JSON falls back to text without a `.json` extension.** `a session of more links than one session holds is split into numbered parts, and a file over the link limit is refused whole`.
* **The backup goes to the service worker unchanged.** `RAINDROP_CSV`: the worker does the same merge.
* **Raindrop.io fixtures are synthetic.** `RAINDROP_CSV`: checked against a real export, but no content of it is kept.
* **Unsorted joins the default column.** `dev`: it does not become a column that repeats the default's name.
* **Other-tool fixtures are hand written.** `fixture`: each file in `fixtures/imports` is written from the tool's exporter code or API docs (cited in `import-formats.ts`), not from a real account.
* **Links in no list go to the first column.** `a Mastodon bookmarks.csv: one post address per row, no header`: as with other formats.
* **A headerless CSV still needs a header row.** `tags come along from Linkwarden, Karakeep, wallabag, and Pinboard`.
* **A held value loses to a saved one.** `the holder takes plain values up to its caps`: a value already saved wins over a held one.

### Library storage (`library-fixtures.ts`, `library-state.test.ts`)

* **A fixture the layout cannot hold stays in the old single entry.** `recordsLayout`: for example a session without an id, or two with the same id.
* **Mocks sort keys like the browser.** `sortKeysDeep`: `chrome.storage` hands values back with sorted keys, so a checksum that depends on key order fails in the tests, not in a browser.
* **The in-memory backend can lose a write.** `MemoryBackend`: a lost `set` can be torn, applying only some of its keys, because the browser does not promise a multi-key write is atomic.

### Manifests (`manifest-targets.test.ts`)

* **Firefox has no split private-window mode.** So the add-on stays out of private windows (`incognito: not_allowed`).
* **Host permissions and content scripts make browsers warn.** `test: the palette overlay needs no site access`: at install, or block an update until approved.
* **Optional host permissions ask nothing at install.** `test: the palette overlay needs no site access`: the Settings › Sources permissions, covered in `tests/site-sources.test.ts`.

### Notes (`note-links.test.ts`)

* **A link sits inline in the one clamped paragraph.** `never renders note text as HTML`: so a long note is still cut to its lines.

### Private lock (`private-lock.test.ts`)

* **An older version's record is read with its old kind.** `record`: the same record, with the kind it used to write.
* **Changing the credential writes one kind.** `lock records are checked before use`: whatever the record said before.
* **The read counts as activity.** `status reports when the idle timeout will lock`: a read at minute 4 keeps minute 8 inside the window.
* **The key stays in memory if the pass stops.** `gate`: enable stopped before writing anything leaves no sealed data.
* **Cut off before the record exists, nothing is sealed.** `gate`: no lock is set.
* **A regular worker cannot see private windows.** `plain`: it reads the same status but not the private windows.

### Sync scopes (`setting-scopes.test.ts`)

* **The guard on sync scopes.** `RULE` (#397, #418): every setting has a scope in `src/shared/setting-scopes.ts` with a reason. `all` and `platform` sync, `device` never does, and `docs/PRIVACY.md` lists every `device` one. Without the guard, a new setting, or one cut out of sync on the way, stays behind on one device, and a setting the phone reads could be scoped as if only browsers used it.
* **A newer version's settings travel as they are.** `HOLDER`: they are held and sent as the settings, never as the holder itself.
* **Data keys are not settings.** `DATA_KEYS`: the library, recovery copies, caches, and sync bookkeeping. A setting with its own storage key does not sync, so it must be scoped in `setting-scopes.ts`; a new data key goes here.
* **The phone's reads are found by four forms.** `the phone reads exactly the library settings scoped to all devices`: `settings.<key>`, `Settings['<key>']`, a quoted key in a `Pick<Settings>`, or a key written with `setSyncedSetting`. A key that is also a phone preference counts only in the first two forms.

### Sites and Sources (`site-sources.test.ts`)

* **An svg element has no `click()`.** `youtube`: a real click on an icon still reaches the window, so the test clicks the element around it.
* **Grays are lifted to 4.5:1 on the toast.** `colors`: they read on the dark page but not on the toast's lighter background.
* **Amber darkens on the light page.** `a source is found only on its own https hosts`: as the pages' accent does.
* **Choices are kept as they came.** `choices from another device are applied unless this browser changed the site since the round read it`: sites this version does not know are included, so they sync back unchanged.
* **Wanted is not enabled.** `mediumSource`: on in another browser, not enabled here. A save mode the site does not have is not read.
* **The composed path.** `path`: the browser's composed path for a click in the shadow root is the item, the root, then the host's ancestors.
* **A site's source column is only on where it is on.** `each site saves to its own source column id`: on in another browser only, its saves there would make the column again.
* **Saved comments on old Reddit.** `a click-save and the saved page catch-up store the same address for one post`: a promoted row is not a save.
* **Public stars are not saves.** `the YouTube reader lists the shown Watch later playlist only`: someone else's stars are public, but the user's own saves are not, and the profile's other tabs are not stars.
* **The worker drops the repeat; the reader keeps the page.** `keepOffPage`.
* **The collections overview and the profile are not saves.** `keepOffPage`.
* **Linkedom's listener order.** `click`: it calls window listeners last and in the order added, whatever the phase. A browser runs the capture listener before any site handler, so the site's handler goes on the window after the content script's.
* **Linkedom marks no event trusted.** `keepOffX`: the browser marks the user's own clicks.
* **The icon has no `click` method.** `menu`: the element around it is clicked, inside the same button.

## Consequences

* The file names and test titles carry what they can. The rest is here.
* A new decision in a test goes here, not in a comment.
