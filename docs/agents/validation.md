# Validation gate

Install the Vite+ CLI once as described in [README Development](../README.md#development), then use `vp run <task>` from the repository root. The gate applies to every code fix or feature and defines when you may report a change complete or commit, push, or open a pull request. The branch, commit, and CI steps are in [Task workflow](workflow.md).

## Required workflow

1. **Add regression coverage.** For a bug, add or update a test that fails before the fix when practical. For a feature, test the new behavior at the most direct existing test boundary. Do not replace a browser test with a mock when the behavior depends on Chrome APIs or extension page behavior.
2. **Run automated checks.** Run `vp run check` and `vp run build`. Fix failures and rerun both commands. Record the result of each command. If the change touches the manifest, the build scripts, `apps/extension/src/shared/browser.ts`, or anything that differs between Chromium and Firefox, also run `vp run browser:firefox` (needs Firefox installed) and record its result.
3. **Verify runtime behavior in the dev browser.** For a user visible or browser behavior change, run `vp run browser:install` once if the Playwright browser is missing, then run `vp run dev:chrome:headless`. When the change can behave differently in Firefox (see [Browser support](../architecture.md#browser-support)), also run `vp run dev:firefox:headless` and repeat the check there. Wait for the initial build to finish and connect to the automation endpoint described in [Browser access](#browser-access). Perform the exact action that was broken or changed and check the result. After rebuilding, reload TabLodge at `chrome://extensions` and reopen its pages. Check the page console and service worker console for relevant errors. For UI changes, also test keyboard use and both themes, and run `vp run a11y` after `vp run build`. Follow [Accessibility](ui.md#accessibility): every interaction that needs a pointer also needs a keyboard alternative. Use available screen reader or accessibility inspection tools. Do not require manual screen reader testing.
4. **Capture proof.** For every fix or feature, keep evidence that the change works, taken from the run in step 3. See [Proof](#proof).
5. **Unslop the diff.** Clean the changed files before review. See [Unslop the diff](#unslop-the-diff).
6. **Review scope and evidence.** Run `git diff --check` and `git status --short`, then inspect `git diff HEAD` to review staged and unstaged changes together. Confirm that every changed file is needed for the request, remove unrelated edits and generated files, and record concrete validation evidence for the pull request.

## Proof

A fix or feature is not done until the pull request shows it working. Pick the strongest form the environment allows:

- **Screenshots** for UI changes. Exercise the affected workflow and capture its resulting state at all four browser viewport profiles: mobile portrait at 440 × 956 CSS pixels with a device scale factor of 3, representing a 6.9 inch iPhone Pro Max class device; tablet portrait at 768 × 1024 CSS pixels; wide desktop at 1440 × 900 CSS pixels; and very wide desktop at 1920 × 1080 CSS pixels. Use mobile device emulation for the phone profile. This checks the narrow layout and does not claim native mobile extension support. Use the headless dev browser (`vp run dev:chrome:headless`, or `vp run dev:chrome:headless:seed` for realistic sample data). For a fix, also capture the broken state before the change at each profile where the issue reproduces. Check both themes for UI changes.
- **Android app proof.** Changes under `apps/mobile/` are shown on an Android emulator or a device instead of the browser profiles: screenshots of the affected screens in the app, with the Android version and whether the Material or iOS look was used, and a note if TalkBack, a dark theme, or a small screen was not checked. Start the emulator with a visible window (`emulator -avd <name> -no-audio -gpu swiftshader_indirect`) and keep the sample data off any real server. The **Mobile** workflow builds the debug APK for these changes, but it does not run the app.
- **Recording or step list** for behavior that a still image cannot show, such as drag and drop, shortcuts, or restore flows. Give the exact steps and the observed result.
- **Console or test output** for worker, storage, or import and export changes: the failing test before the fix and the passing test after, or the service worker console showing the expected result.

Save screenshots and recordings under `apps/extension/.dev/evidence/`, which git ignores. Name screenshots so their viewport is clear. Attach or upload the screenshots to the pull request, preferably in its description, so reviewers can inspect them there. Do not commit evidence files. If the environment cannot upload attachments, include each exact file path in the pull request and ask the maintainer to attach them. Documentation only and tooling only changes need a sentence explaining why browser proof does not apply.

## Unslop the diff

Before the first push and after any later rework, review only the files this branch changes:

```sh
git diff --name-only origin/master...HEAD
```

Run the `unslop-*` skills that match those files, scoped to that list and nothing else:

| Changed files | Skill |
| --- | --- |
| `.ts` and `.tsx` code | `unslop-typescript`, which continues into `unslop-react` and `unslop-ui` for React |
| `apps/*/tests/` | `unslop-tests` |
| Markdown, Help copy, website copy, code comments | `unslop-text` |
| Commit messages on the branch | `unslop-git` |

Fix every finding that is in your diff. Leave code you did not change alone, even when it has slop, and mention it in the pull request only if it blocks the change. Then rerun `vp run check` and `vp run build`, commit the fixes, and continue. The skills write a ledger to `.unslop/`, which git ignores. The pull request does not need a report. Say in the pull request that the pass ran.

## Browser access

Agents use `vp run dev:chrome:headless` (or `vp run dev:chrome:headless:seed` for sample data). It loads `apps/extension/dist/tablodge/` in Playwright Chromium without opening a desktop window. Install Chromium with `vp run browser:install`. This mode uses `apps/extension/.dev/chromium-headless-profile`, separate from the visible dev browser, regular browser data, and other worktrees. It uses Playwright's Chromium even when `CHROME_BIN` is set.

The launcher prints `Dev browser CDP: http://127.0.0.1:<port>`. Connect with Playwright's `chromium.connectOverCDP(endpoint)` and use `browser.contexts()[0]` to access extension pages and service workers. The endpoint allows full control of the dev profile. Keep it local and close it when validation ends. To stop the browser and its build watchers, send `Browser.close` through `await browser.newBrowserCDPSession()`. Closing only the connected Playwright client disconnects it without stopping the launcher. Source changes rebuild automatically, but the extension still needs reloading after a rebuild. Run `vp run browser:dev` to check headless launch, automation access, screenshot capture, and shutdown.

For Firefox, agents use `vp run dev:firefox:headless` (or `vp run dev:firefox:headless:seed`). It loads `apps/extension/dist/tablodge-firefox/` as a temporary add-on in headless Firefox through Selenium, with its profile in `apps/extension/.dev/firefox-headless-profile`. Firefox must be installed. `FIREFOX_BIN` points to a specific executable, and Selenium downloads a matching geckodriver if there is none on the `PATH`. The launcher prints `Dev browser WebDriver: <url> (session <id>)`. Attach a Selenium client to that session, or call the WebDriver HTTP endpoints at that address, to drive the extension pages. The add-on's pages live at `moz-extension://7a1f0c2e-5b7d-4f43-9a41-4f1c2b9d0a11/` (`apps/extension/scripts/firefox-driver.ts` pins the UUID). WebDriver cannot navigate to that scheme, so open them from a chrome scoped script as `openExtensionPage` does. To stop Firefox and the build watcher, delete the WebDriver session (`DELETE <url>session/<id>`) or stop the launcher process. Source changes rebuild automatically, but the add-on needs reloading after a rebuild. Run `vp run browser:firefox` to check the core workflows end to end.

Exercise the affected workflow, not just page rendering. A screenshot is evidence for a visual change, but it does not replace exercising the behavior. Use automation through the local endpoint or an automated browser test for the affected behavior. If neither can run, report validation as blocked and ask for access. Keep validation headless unless the user requests a visible browser. Do not claim the behavior works based only on unit tests, a successful build, or static inspection.

For manual use, `vp run dev:chrome` and `vp run dev:chrome:seed` still open a visible browser in `apps/extension/.dev/chrome-profile`, using installed Google Chrome when available and Playwright Chromium otherwise. Closing that browser stops its build watcher. `vp run dev:firefox` and `vp run dev:firefox:seed` do the same in Firefox with the profile `apps/extension/.dev/firefox-profile`. The sample data there shows letter tiles in place of site icons, because Firefox has no favicon service.

## Change scope review

Keep the patch to the smallest set of changes that implements the request and its tests. Before opening a pull request, check each changed path against the request and remove unrelated cleanup, formatting, generated output, or speculative refactoring. Explain any necessary supporting change, such as a migration, test, or documentation update. Preserve existing user changes.

## Pull request evidence

Do not commit, push, or open a pull request for a runtime change until the checks pass, the affected workflow ran in Chrome or Chromium, proof exists, the diff is unslopped, and the scope review is done. When an environment limit blocks a required step, stop before committing and report what is blocked and what access is needed.

The pull request body lists:

- The commands run and whether each passed.
- The browser used and the exact steps exercised, with the observed result.
- For UI changes, the result of `vp run a11y`, keyboard testing, and the screen reader or accessibility inspection tools used, with workflows tested, tools unavailable, and remaining limits. Manual screen reader testing is not required.
- The [proof](#proof), with a before and after for a fix.
- That the unslop pass ran on the changed files.
- Why browser validation does not apply, for documentation only or tooling only changes.
- That each changed file is needed and unrelated changes are gone.
