# 20. Extension build, packaging, and check script decisions that were code comments

Status: accepted, 2026-11-23. Issue #442.

## Context

`apps/extension/scripts` carried its non-obvious decisions as comments: the build, the packaging, the manifest targets, the Firefox driver, the browser checks, and the accessibility checks. Comments are banned ([Code comments](../agents/comments.md)), so each decision lives here with the file or symbol that carries it. Usage notes (commands, environment variables, file overviews) are not decisions and are in [Extension](../agents/extension.md) and [Validation](../agents/validation.md). The repo-level tools are [ADR 16](0016-scripts-decisions.md).

## Decisions

### Build (`build.ts`, `vite-shared.ts`)

* **One package, several builds.** `build.ts`: the HTML pages (`vite.pages.config.ts`, which also writes `manifest.json` and copies icons) and self-contained classic scripts (service worker, boot script) write into one folder.
* **Every bundled package is listed.** `build.ts:recordBundledFiles` and the notice step: `THIRD_PARTY_NOTICES.txt` lists the licence of every npm package the bundles include, and Help links to it. A package without a licence text fails the build.
* **Readability keeps its notice.** `build.ts` (`banner` of the Readability bundle): it is Apache-2.0, and the minifier drops source comments, so the notice is added as a banner.
* **The service worker is a classic script.** `build.ts` (`background`): a service worker for Chromium, an event page for Firefox.
* **Boot and head scripts are classic.** `build.ts` (`boot`): they load synchronously in every page's `<head>` before first paint.
* **Reads start while the bundle loads.** `build.ts` (`newtab`, `add-bookmark`): the new-tab state and the add-bookmark read start while the React page bundle is loading.
* **Watch and dev browser take one target.** `build.ts:targets`: they serve one package, so Chromium is the default.
* **The config reads the target from the environment.** `build.ts:files`: `vite.pages.config.ts` is loaded fresh for each build and reads `TABLODGE_TARGET` from there.
* **The target is set per build step.** `vite-shared.ts:targetFromEnv`: `build.ts` sets it before it starts Vite, because the configs are loaded fresh each time.
* **Chromium keeps its folder name.** `vite-shared.ts:outDirFor`: existing dev and test tooling loads that path, and a different folder gives the extension another ID and separate storage.
* **The display name comes from the manifest.** `vite-shared.ts:appName`: HTML shells use `%APP_NAME%`, and pages read it at runtime.
* **The minimum version is written in two manifests.** `shell/manifest.json`: `minimum_chrome_version` for Chromium. Firefox's `strict_min_version` is set in `manifest-targets.ts`. A change to browser support updates the field and the matching build target in `vite-shared.ts:BUILD_TARGETS`.
* **Several builds share a folder, so Vite never empties it.** `vite-shared.ts:sharedBuild`: `build.ts` clears the package folder once before building. CSS is minified with esbuild, because lightningcss (the Vite 8 default) rewrites the `color-scheme` theme rules.
* **Icons are watched too.** `vite-shared.ts:copyStatic`: they are copied after each write and added to the watch list, so `vp run dev:chrome` picks up icon edits.
* **The repository URL has one source.** `vite-shared.ts:writeManifest`: `homepage_url` comes from `package.json` `homepage`, adapted to the target.
* **A bundle may carry a notice at its top.** `vite-shared.ts:scriptConfig`: a licence notice added after minifying.
* **Tailwind scans this package only.** `apps/extension/postcss.config.cjs`: without `base`, Tailwind reads from the directory the build was started in.
* **Pages and scripts are separate builds.** `apps/extension/vite.pages.config.ts`: the service worker and the theme boot script are built as separate scripts by `build.ts`.
* **The HTML shells are empty.** `apps/extension/vite.pages.config.ts`: each shell carries only an empty themed `#root`, and the React entry is injected at build time.
* **Classic script bundles are self-contained.** `vite-shared.ts:scriptConfig`: dependencies are inlined into one file and `process.env.NODE_ENV` is replaced, since library mode does not do it and extension scripts have no `process` global.

### Manifest targets (`manifest-targets.ts`, `verify-build.ts`, `package.ts`)

* **Firefox runs the same pages and the same background script.** `manifest-targets.ts:manifestForTarget`: its manifest differs in the following ways.
* **The background script is an event page.** Firefox has no extension service workers, so `manifest-targets.ts` names it under `scripts`.
* **The Side Panel API does not exist in Firefox.** `manifest-targets.ts`: the same page is registered as the sidebar instead.
* **Private windows stay out.** Firefox cannot give a private window a separate extension context (`split`), so the add-on stays out of them. `verify-build.ts` checks `incognito: not_allowed`, because the dashboard shares one storage area.
* **Add-on metadata lives under `browser_specific_settings.gecko`.** `manifest-targets.ts:GECKO_ID`.
* **The add-on id is permanent.** `manifest-targets.ts:GECKO_ID`: Firefox keys storage and permissions to it, and it cannot change once an add-on is signed.
* **Tab groups need Firefox 139 and the data collection key needs 140.** `manifest-targets.ts:FIREFOX_MIN_VERSION`.
* **Some permissions must not reach Firefox.** `manifest-targets.ts:CHROMIUM_ONLY_PERMISSIONS`: Firefox rejects names it does not know.
* **TabLodge sends nothing.** `manifest-targets.ts:manifestForTarget`: so Firefox's install prompt can say so with `data_collection_permissions: none`.
* **Classic scripts cannot use module syntax.** `verify-build.ts:verifyClassicScript`: content scripts, non-module workers, and plain `<script>` tags run as classic scripts, so an import or export is a syntax error there, and there is no `process` global.
* **The Sources content script is named at runtime.** `verify-build.ts`: the worker registers it when a site is switched on in Settings › Sources, so the manifest does not name it.
* **Help links to the notices.** `verify-build.ts`: the licences of the bundled packages require the file.
* **`package.json` is the source of the repository URL.** `verify-build.ts`: one source, shared with the manifest.
* **Pages apply the saved theme before first paint.** `verify-build.ts`: each page does it with a classic script in `<head>`.

### Packaging (`package.ts`)

No decisions were held by comments in this file beyond its usage notes, which are in [Validation](../agents/validation.md).

### Accessibility checks (`scripts/a11y/`)

* **Axe and keyboard checks do not judge reading order or screen reader announcements.** `run.ts` (module). The limit is in [Contributing](../CONTRIBUTING.md).
* **Each area keeps its checks in its own module.** `run.ts` (module): the helpers they share are in `harness.ts`, `fixtures.ts`, `pages.ts`, and `evidence.ts`.
* **Waits end as soon as their condition holds.** `run.ts:worker`: the longer limit only matters on a loaded machine.
* **A check that never settles would hang the run.** `harness.ts:check`: a 3 minute limit fails that check before the CI job times out.
* **`until` polls the condition 150 times, 100 ms apart.** `harness.ts:until`: the pages redraw asynchronously after each action. It awaits each condition without its own timeout, so the 3 minute limit in `check` is what ends a stalled one; the polling count does not give a 15 second wall clock limit.
* **`A11Y_ONLY` repeats one check.** `harness.ts:onlyChecks`: it runs only the checks whose name contains the text.
* **`A11Y_SHARD` splits the run.** `harness.ts:shard`: `index/total` runs every total-th check, so CI can split it. Checks run in the same order in every shard, so the split is stable.
* **The accessibility dev fixture seeds the Board view.** `fixtures.ts:createDevFixture`: it overrides `bookmarkBoardView` to `board`. The checks were written for the Board view. The product default is Focus, and the Focus checks set up their own.
* **Chromium keeps connections open.** `fixtures.ts:sessionUrls`: `close()` waits for them, so the server closes them first.
* **Theme follows the system by default.** `pages.ts:setTheme`: emulating the color scheme switches the pages.
* **Contrast waits for the theme transition.** `pages.ts:setTheme`: colors transition between themes, so contrast is measured after they settle.
* **A style change waits a frame.** `pages.ts:setTheme`: it applies on the next frame, which is when its transitions start.
* **Menus open by keyboard and repeat the press.** `pages.ts:openMenuByKeyboard`: a card can redraw after the page settles and drop focus, and an open menu hides its trigger from the accessibility tree, so the menu itself is checked.
* **The extension CSP blocks inline scripts.** `pages.ts:results`: so scripts are evaluated through the protocol.
* **A single palette result leaves room below the list.** `palette.ts:gap`: the spare room sits between the list and the shortcut bar.
* **Escape closes the palette window.** `palette.ts:closed`: it ends the key press call itself.
* **Escape goes up one level first.** `palette.ts:closed`: the window is still there afterwards.
* **The palette overlay is a frame.** `palette.ts:page`: `palette.html` runs in a frame, and a stand-in parent page receives its close request.
* **The injected script hands focus to the frame.** `palette.ts:paletteOverlayCheck`: the search box takes it from there.
* **The popup opens as a tab here.** `popup.ts:openPopupOver`: its own tab would be the active one, so the first read of the active tab reports `activeUrl` as the page it was opened over.
* **A closing column select returns focus late.** `popup.ts:page`: it can take focus off the Notes field, so focus is set again until it keeps it.
* **Import focus moves on the next frame.** `import-export.ts:columnPicker`: a key pressed before that lands on Import and runs the import.
* **A short password is allowed.** `import-export.ts:downloadPromise`: the field says it is easy to guess while it is typed.
* **The dialog closes before the move.** `selection.ts:moved`: the column is created and the bookmarks move after.
* **Moves land after the dialog closes.** `selection.ts` (module): the check polls instead of reading once.
* **Moving ends the selection.** `selection.ts:selectPair`: the pair is picked again before each drag.
* **Ctrl+click opens real sites.** `selection.ts:web`: Playwright reports the tab only after its first navigation commits, which took over 2 seconds against the live site, so the sample sites are served locally.
* **Computed colors are oklab.** `session-cards.ts:deleteHoverBackground`: they are compared as the color each paints over white.
* **Settings layout regressions.** `settings.ts:settingsNarrowLayoutCheck`: a section or row reset once wrapped onto its own line on a phone, and the Archive days field stacked under its select.
* **The page may still scroll.** `settings.ts:skipLinkCheck`: all three lines are read until they agree.
* **A cancelled animation is done.** `settings.ts:animationsDone`: it rejects, and either way it has finished.
* **A removed site stays listed.** `settings.ts:row`: when the browser took its access, the row stays with Remove and no permission prompt.
* **Each site is one collapsed row.** `settings.ts:toggle`: Enter opens its options, and only one row is open at a time.
* **The dialog fades in.** `settings.ts:violations`: mid fade its button fails contrast.
* **Focus after a removal.** `settings.ts:siteSourceRemoveCheck`: the removed row held focus, so it lands on Add a site.
* **Focus stays inside a dialog.** `settings.ts:confirm`: a confirmation opened inside the dialog returns focus inside it.
* **Every section has a finder entry.** `settings.ts:settingsFinderCheck`: every entry leads to a section that exists, and choosing one from the palette opens Settings at it. The check fails when a new Settings section is not in `settings-sections.ts`.
* **A long address does not stretch the dialog.** `share.ts:target`: one address with no break points, as a long tracking link has, used to widen the whole dialog.
* **A dialog returns to its trigger.** `shell.ts:trigger`: one opened from a menu item returns to the menu's button.

### Firefox driver and checks (`browser/`)

* **Firefox is found by its own variable.** `firefox-driver.ts` (`FIREFOX_BIN` overrides the one Selenium finds).
* **geckodriver is downloaded when needed.** `firefox-driver.ts`: Selenium downloads a matching geckodriver when none is on the `PATH`.
* **The add-on is temporary.** `firefox-driver.ts`: Firefox does not need to sign it.
* **The add-on has a fixed UUID.** `firefox-driver.ts:UUID`: its pages have a known address, which `openExtensionPage` relies on.
* **WebDriver cannot open `moz-extension://` pages.** `firefox-driver.ts:service`: chrome-scoped scripts can, which needs system access.
* **The tab exists before its page loads.** `firefox-driver.ts:openExtensionPage`: it waits for the extension protocol and document readiness. `firefox-driver.ts:EVALUATE_WRAPPER` runs its body without waiting for navigation, so a caller that evaluates after a navigation must wait through `openExtensionPage` first.
* **Icons come from the site.** `firefox-smoke-check.ts:iconed`: the tabs showed the site's icon, so a link to a page of the same site that was never opened shows it too.
* **Firefox has no side panel for the toolbar button.** `firefox-smoke-check.ts:popup`: the button keeps its popup.
* **Help and the copy reader never read the library.** `page-startup-check.ts:content`: the startup check skips them when it reads the library.

### Private library checks (`private-storage-check.ts`)

* **The stand-in sync server answers the set-a-password screen.** `startStubSyncServer`: it sends the CORS headers the extension's fetch needs.
* **The password lock is checked in a real browser.** `runLockChecks` (issue #142).
* **A browser restart locks an unlocked library.** `page`: the key is gone, so the library opens locked.
* **A short password is allowed.** `sealed`: the field says it is easy to guess while typed.
* **The mode cannot change while locked.** `modeRadios`: from a regular window or by message.
* **A forgotten password has a way out.** `eraseDialog`: erase the private library and start again. Cancelling keeps everything.
* **A restarted worker keeps the library open.** `saved`: while the browser keeps running.
* **Closing the last private window locks.** `runWindowLockChecks`: closing one of several, or restarting the worker, does not. The private worker is not woken when a private window closes, so the lock is judged on the next wake.
* **Unlocking records the window.** `second`: the private window that was open at unlock.
* **A remaining window keeps it unlocked.** `afterClose`: a worker restart with a window still open does too.
* **Closing the only window while the worker is stopped.** `afterClose`: nothing runs, so the key stays in memory.
* **The next window shows the lock screen.** `third`: the key is gone before it can read anything.
* **Unlocking again while the worker is awake.** `awake`: the worker sees the last window close.
* **Sync says whether private windows sync.** `settingsStub`: here they stay on this device.
* **Focus survives the screen change.** `(module)`: the set-a-password screen came and went, so focus must not fall to the page body.
* **The popup and side panel show a compact badge.** `compact`: in their header, instead of the banner frame.
* **A locked saved library cannot be left.** `reopenedPromise`: the lock comes off first.

## Consequences

* The file and symbol names carry what they can. The rest is here.
* A new decision in a script goes here, not in a comment.
