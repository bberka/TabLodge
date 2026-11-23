# Extension (`apps/extension`)

The Chrome, Brave, Firefox extension (Manifest V3). Also holds code other apps share: `src/shared/` (library storage, sync protocol and client) and data types. Change there can reach server and Android app, so read [Cross app work](cross-app.md) before editing it.

## Where things are

| Path | Holds |
| --- | --- |
| `shell/` | `manifest.json`, icons, HTML shells, `service-worker.ts`, boot scripts |
| `src/app/` | Pages, data model, messages |
| `src/components/ui/` | Radix and Tailwind primitives |
| `scripts/` | Build, packaging, verification, accessibility checks; `scripts/browser/` holds dev browser launchers and browser based checks |
| `tests/` | Vitest suites (worker runs in VM with mocked `chrome.*`) |

Logic needing no browser lives in `src/shared` and `src/app` as plain modules with own tests, not in service worker or page component: `library-normalize.ts` (reading untrusted stored data), `bookmark-rules.ts` (column rules Android app shares), `context-menu-plan.ts` (right-click tree), `bookmark-drag.ts` (board drag and drop). Put new rules of that kind there too.

[Architecture](../architecture.md) explains storage, messages, sync, private windows, Firefox differences. Read section for area you touch.

## Rules

- Strict TypeScript, no `any` escapes. Treat stored data, imports, messages as untrusted and validate them. Service worker builds into one classic script, imports shared code from `src/` like pages do: never copy a list or rule into it.
- Changes to storage keys, export format identifiers, drag MIME types, context menu IDs need migration.
- New setting is a `Settings` field with default in `DEFAULT_SETTINGS`, never own storage key, so it syncs ([Cross app work](cross-app.md#feature-triage)).
- Read display name from `PROJECT.name` in pages or `APP_NAME` in worker (both manifest's `short_name`).
- Bundle everything locally: no CDN imports, remote fonts, network calls. New permission needs stated reason in [permissions table](../PRIVACY.md#permissions) and [privacy policy](../PRIVACY.md).
- Test on Chrome and Firefox when change touches what they treat differently ([Browser support](../architecture.md#browser-support)).
- Add regression test for bug fix. Extend `chrome.*` mock in worker tests when using another API.
- UI work follows [UI rules](ui.md).
- New feature or user action: check whether it belongs in right-click menu: [Entry points](cross-app.md#feature-triage).
- New feature, setting, or Settings section: check whether it belongs in global finder, in same pull request: command in `src/app/finder-commands.ts`, which makes every page opening finder say how it runs it, or section in `src/app/settings-sections.ts`. Field is row of `settingsFieldGroups` (`settings-fields.ts`), listed by itself, synonyms in `SETTING_WORDS`; tests and `vp run check:a11y` fail for missing row or section. When it does not belong, say why in pull request.

## Browser access

Agents use `vp run dev:chrome --headless`, plus `--seed-data` for sample data. It loads `apps/extension/dist/tablodge/` in Playwright Chromium using `apps/extension/.dev/chromium-headless-profile`, apart from visible dev browser, regular browser data, other worktrees, on Playwright's Chromium even with `CHROME_BIN` set; install it with `vp run browser:install`. Each launch deletes profile's cached worker (`Default/Service Worker/`) and visible profile's, while sign-ins, storage, seeded data stay, so cached worker of earlier build cannot run (#466).

Launcher prints `Dev browser CDP: http://127.0.0.1:<port>`. Connect with Playwright's `chromium.connectOverCDP(endpoint)` and use `browser.contexts()[0]` to access extension pages and service workers. Endpoint allows full control of dev profile. Keep it local, close it when validation ends. To stop browser and its build watchers, send `Browser.close` through `await browser.newBrowserCDPSession()`. Closing only connected Playwright client disconnects it without stopping launcher. Source changes rebuild automatically, but extension still needs reloading after rebuild. Run `vp run check:dev-browser` to check headless launch, automation access, screenshot capture, shutdown.

For Firefox, agents use `vp run dev:firefox --headless` (or `vp run dev:firefox --headless --seed-data`). It loads `apps/extension/dist/tablodge-firefox/` as temporary add-on in headless Firefox through Selenium, profile in `apps/extension/.dev/firefox-headless-profile`. Firefox must be installed. `FIREFOX_BIN` points to specific executable, and Selenium downloads matching geckodriver if none on `PATH`. Launcher prints `Dev browser WebDriver: <url> (session <id>)`. Attach Selenium client to that session, or call WebDriver HTTP endpoints at that address, to drive extension pages. Add-on's pages live at `moz-extension://7a1f0c2e-5b7d-4f43-9a41-4f1c2b9d0a11/` (`apps/extension/scripts/browser/firefox-driver.ts` pins UUID). WebDriver cannot navigate to that scheme, so open them from chrome scoped script as `openExtensionPage` does. To stop Firefox and build watcher, delete WebDriver session (`DELETE <url>session/<id>`) or stop launcher process. Source changes rebuild automatically, but add-on needs reloading after rebuild. Run `vp run check:firefox` to check core workflows end to end.

Exercise affected workflow, not just page rendering. Use automation through local endpoint or automated browser test for it. If neither can run, report validation as blocked and ask for access. Keep validation headless: never open or raise desktop window unless maintainer asks for visible one. Do not claim behavior works based only on unit tests, successful build, or static inspection.

For manual use, `vp run dev:chrome` and `vp run dev:chrome --seed-data` still open visible browser in `apps/extension/.dev/chrome-profile`, using installed Google Chrome when available, Playwright Chromium otherwise. Closing that browser stops its build watcher. `vp run dev:firefox` and `vp run dev:firefox --seed-data` do same in Firefox with profile `apps/extension/.dev/firefox-profile`. Sample data there shows letter tiles in place of site icons, because Firefox has no favicon service.

## Commands

Use `vp run <task>` from repository root: `dev:chrome`, `dev:firefox`, `build`, `pack`, `check:firefox`, `check:a11y`. List is in [Contributing](../CONTRIBUTING.md#development) and `apps/extension/package.json`. Dev browser keeps profile in `apps/extension/.dev/`, builds land in `apps/extension/dist/`. Load same build folder every time: another path gives extension different ID and separate storage.
