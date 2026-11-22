# Extension (`apps/extension`)

The Chrome, Brave, and Firefox extension (Manifest V3). It also holds the code the other apps share: `src/shared/` (library storage, the sync protocol and client) and the data types. A change there can reach the server and the Android app, so read [Cross app work](cross-app.md) before editing it.

## Where things are

| Path | Holds |
| --- | --- |
| `shell/` | `manifest.json`, icons, HTML shells, `service-worker.ts`, boot scripts |
| `src/app/` | Pages, data model, messages |
| `src/components/ui/` | Radix and Tailwind primitives |
| `scripts/` | Build, packaging, verification, and accessibility checks; `scripts/browser/` holds the dev browser launchers and the browser based checks |
| `tests/` | Vitest suites (the worker runs in a VM with mocked `chrome.*`) |

Logic that needs no browser lives in `src/shared` and `src/app` as plain modules with their own tests, not in the service worker or a page component: `library-normalize.ts` (reading untrusted stored data), `bookmark-rules.ts` (column rules the Android app shares), `context-menu-plan.ts` (the right-click tree), and `bookmark-drag.ts` (board drag and drop). Put new rules of that kind there too.

[Architecture](../architecture.md) explains storage, messages, sync, private windows, and Firefox differences. Read the section for the area you touch.

## Rules

- Strict TypeScript, no `any` escapes. Treat stored data, imports, and messages as untrusted and validate them. The service worker is built into one classic script, and it imports shared code from `src/` like the pages do: never copy a list or rule into it.
- Changes to storage keys, export format identifiers, drag MIME types, or context menu IDs need a migration.
- A new setting is a `Settings` field with a default in `DEFAULT_SETTINGS`, never a storage key of its own, so it syncs ([Cross app work](cross-app.md#feature-triage)).
- Read the display name from `PROJECT.name` in pages or `APP_NAME` in the worker (both the manifest's `short_name`).
- Bundle everything locally: no CDN imports, remote fonts, or network calls. A new permission needs a stated reason in the [permissions table](../PRIVACY.md#permissions) and the [privacy policy](../PRIVACY.md).
- Test on Chrome and Firefox when a change touches what they treat differently ([Browser support](../architecture.md#browser-support)).
- Add a regression test for a bug fix. Extend the `chrome.*` mock in the worker tests when you use another API.
- UI work follows [UI rules](ui.md).
- A new feature or user action checks whether it belongs in the right-click menu: [Entry points](cross-app.md#feature-triage).
- A new feature, setting, or Settings section checks whether it belongs in the global finder, in the same pull request: a command in `src/app/finder-commands.ts`, which makes every page that opens the finder say how it runs it, or a section in `src/app/settings-sections.ts`. A field is a row of `settingsFieldGroups` (`settings-fields.ts`), listed by itself, synonyms in `SETTING_WORDS`; tests and `vp run check:a11y` fail for a missing row or section. When it does not belong, say why in the pull request.

## Browser access

Agents use `vp run dev:chrome --headless` (or `--seed-data` for sample data). It loads `apps/extension/dist/tablodge/` in Playwright Chromium, no desktop window, in `apps/extension/.dev/chromium-headless-profile`, apart from the visible dev browser and other worktrees, on Playwright's Chromium even when `CHROME_BIN` is set. Install Chromium with `vp run browser:install`. Each launch deletes that profile's cached worker (`Default/Service Worker/`), the visible profile too, while sign ins, storage and seeded data stay, so the worker that runs is the one this build wrote (issue #466).

The launcher prints `Dev browser CDP: http://127.0.0.1:<port>`. Connect with Playwright's `chromium.connectOverCDP(endpoint)` and use `browser.contexts()[0]` to access extension pages and service workers. The endpoint allows full control of the dev profile. Keep it local and close it when validation ends. To stop the browser and its build watchers, send `Browser.close` through `await browser.newBrowserCDPSession()`. Closing only the connected Playwright client disconnects it without stopping the launcher. Source changes rebuild automatically, but the extension still needs reloading after a rebuild. Run `vp run check:dev-browser` to check headless launch, automation access, screenshot capture, and shutdown.

For Firefox, agents use `vp run dev:firefox --headless` (or `vp run dev:firefox --headless --seed-data`). It loads `apps/extension/dist/tablodge-firefox/` as a temporary add-on in headless Firefox through Selenium, with its profile in `apps/extension/.dev/firefox-headless-profile`. Firefox must be installed. `FIREFOX_BIN` points to a specific executable, and Selenium downloads a matching geckodriver if there is none on the `PATH`. The launcher prints `Dev browser WebDriver: <url> (session <id>)`. Attach a Selenium client to that session, or call the WebDriver HTTP endpoints at that address, to drive the extension pages. The add-on's pages live at `moz-extension://7a1f0c2e-5b7d-4f43-9a41-4f1c2b9d0a11/` (`apps/extension/scripts/browser/firefox-driver.ts` pins the UUID). WebDriver cannot navigate to that scheme, so open them from a chrome scoped script as `openExtensionPage` does. To stop Firefox and the build watcher, delete the WebDriver session (`DELETE <url>session/<id>`) or stop the launcher process. Source changes rebuild automatically, but the add-on needs reloading after a rebuild. Run `vp run check:firefox` to check the core workflows end to end.

Exercise the affected workflow, not just page rendering. Use automation through the local endpoint or an automated browser test for it. If neither can run, report validation as blocked and ask for access. Keep validation headless: never open or raise a desktop window unless the maintainer asks for a visible one. Do not claim the behavior works based only on unit tests, a successful build, or static inspection.

For manual use, `vp run dev:chrome` and `vp run dev:chrome --seed-data` still open a visible browser in `apps/extension/.dev/chrome-profile`, using installed Google Chrome when available and Playwright Chromium otherwise. Closing that browser stops its build watcher. `vp run dev:firefox` and `vp run dev:firefox --seed-data` do the same in Firefox with the profile `apps/extension/.dev/firefox-profile`. The sample data there shows letter tiles in place of site icons, because Firefox has no favicon service.

## Commands

Use `vp run <task>` from the repository root: `dev:chrome`, `dev:firefox`, `build`, `pack`, `check:firefox`, `check:a11y`. The list is in the [Contributing](../CONTRIBUTING.md#development) and `apps/extension/package.json`. The dev browser keeps its profile in `apps/extension/.dev/`, and builds land in `apps/extension/dist/`. Load the same build folder every time: another path gives the extension a different ID and separate storage.
