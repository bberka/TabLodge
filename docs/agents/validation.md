# Validation gate

Install the Vite+ CLI once as described in [Contributing Development](../CONTRIBUTING.md#development), then use `vp run <task>` from the repository root. The gate applies to every code fix or feature and defines when you may report a change complete or commit, push, or open a pull request. The branch, commit, and CI steps are in [Task workflow](workflow.md).

## Required workflow

1. **Add regression coverage.** For a bug, add or update a test that fails before the fix when practical. For a feature, test the new behavior at the most direct existing test boundary. Do not replace a browser test with a mock when the behavior depends on Chrome APIs or extension page behavior.
2. **Run automated checks.** Run `vp run check` and `vp run build`. Fix failures and rerun both commands. Record the result of each command. If the change touches the manifest, the build scripts, `apps/extension/src/shared/browser.ts`, or anything that differs between Chromium and Firefox, also run `vp run check:firefox` (needs Firefox installed) and record its result.
3. **Verify runtime behavior in the dev browser.** For a user visible or browser behavior change, run `vp run browser:install` once if the Playwright browser is missing, then run `vp run dev:chrome --headless`. When the change can behave differently in Firefox (see [Browser support](../architecture.md#browser-support)), also run `vp run dev:firefox --headless` and repeat the check there. Wait for the initial build to finish and connect to the automation endpoint described in [Browser access](extension.md#browser-access). Perform the exact action that was broken or changed and check the result. After rebuilding, reload TabLodge at `chrome://extensions` and reopen its pages. Check the page console and service worker console for relevant errors. For UI changes, also test keyboard use and both themes, and run `vp run check:a11y` after `vp run build`. CI runs `check:a11y`, `check:startup`, `check:private-storage`, `check:dev-browser`, and the Cloudflare Worker freshness check on every pull request (see [CI](ci.md)), so run them locally when your change can break one, but a green pull request already covers them. Follow [Accessibility](ui.md#accessibility): every interaction that needs a pointer also needs a keyboard alternative. Use available screen reader or accessibility inspection tools. Do not require manual screen reader testing.
4. **Capture proof.** For every fix or feature, keep evidence that the change works, taken from the run in step 3. See [Proof](#proof).
5. **Unslop the diff.** Clean the changed files before review. See [Unslop the diff](#unslop-the-diff).
6. **Review scope and evidence.** Run `git diff --check` and `git status --short`, then inspect `git diff HEAD` to review staged and unstaged changes together. Confirm that every changed file is needed for the request, remove unrelated edits and generated files, and record concrete validation evidence for the pull request.

## Proof

A fix or feature is not done until the pull request shows it working. Pick the strongest form the environment allows:

- **Screenshots** for UI changes. Exercise the affected workflow and capture its resulting state at all four browser viewport profiles: mobile portrait at 440 × 956 CSS pixels with a device scale factor of 3, representing a 6.9 inch iPhone Pro Max class device; tablet portrait at 768 × 1024 CSS pixels; wide desktop at 1440 × 900 CSS pixels; and very wide desktop at 1920 × 1080 CSS pixels. Use mobile device emulation for the phone profile. This checks the narrow layout and does not claim native mobile extension support. Use the headless dev browser (`vp run dev:chrome --headless`, or `vp run dev:chrome --headless --seed-data` for realistic sample data). For a fix, also capture the broken state before the change at each profile where the issue reproduces. Check both themes for UI changes.
- **Android app proof.** Changes under `apps/mobile/` are shown on an Android emulator or a device instead of the browser profiles: screenshots of the affected screens in the app, with the Android version and whether the Material or iOS look was used, and a note if TalkBack, a dark theme, or a small screen was not checked. Start your own emulator without a window (`emulator -avd <name> -no-window -no-audio -gpu swiftshader_indirect`, or `pnpm run mobile:emulator --headless`) and target it by serial in every command (`adb -s <serial>`, or `ANDROID_SERIAL=<serial>` for `pnpm run mobile:android` and installs), so nothing lands on another emulator. Screenshots and the T3 device tools work the same on a headless emulator; open a visible window only when the maintainer asks for one. Keep the sample data off any real server. The **Mobile** workflow builds the debug APK for these changes, but it does not run the app.
- **Recording or step list** for behavior that a still image cannot show, such as drag and drop, shortcuts, or restore flows. Give the exact steps and the observed result.
- **Console or test output** for worker, storage, or import and export changes: the failing test before the fix and the passing test after, or the service worker console showing the expected result.

Save screenshots and recordings under `apps/extension/.dev/evidence/`, which git ignores. Name screenshots so their viewport is clear. Do not commit evidence files.

Upload them with `vp run evidence <pr-number> <file>...`. It commits the files to the `evidence` branch through the GitHub API (no git push, so no hooks) and prints Markdown image links; paste those into the pull request description (`gh pr edit <pr> --body-file`). A path on your disk is not proof, so do not report one in place of the upload. Only when `gh` cannot reach the repository, say so and list the file paths.

**Every change gets its own screenshots.** A request to change something, including one that arrives after the pull request is open, is a new change. When it alters anything the user sees (layout, copy, spacing, a control, a setting, a default), take new screenshots of the result, upload them, and add them to the pull request before you say it is done. Do not reuse the earlier set, and do not say "I didn't open the app" and stop: open it. A change with no visible effect says so in one sentence instead. Send the screenshots of a UI change to the user in the final reply as well. Documentation only and tooling only changes need a sentence explaining why browser proof does not apply.

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

## Change scope review

Keep the patch to the smallest set of changes that implements the request and its tests. Before opening a pull request, check each changed path against the request and remove unrelated cleanup, formatting, generated output, or speculative refactoring. Explain any necessary supporting change, such as a migration, test, or documentation update. Preserve existing user changes.

## Pull request evidence

Do not commit, push, or open a pull request for a runtime change until the checks pass, the affected workflow ran in Chrome or Chromium, proof exists, the diff is unslopped, and the scope review is done. When an environment limit blocks a required step, try another route to the same proof first. Stop before committing and ask only when no form of proof is possible, and report what is blocked and what access is needed.

The pull request body lists:

- The commands run and whether each passed.
- The browser used and the exact steps exercised, with the observed result.
- For UI changes, the result of `vp run check:a11y`, keyboard testing, and the screen reader or accessibility inspection tools used, with workflows tested, tools unavailable, and remaining limits. Manual screen reader testing is not required.
- The [proof](#proof), with a before and after for a fix.
- That the unslop pass ran on the changed files.
- Why browser validation does not apply, for documentation only or tooling only changes.
- That each changed file is needed and unrelated changes are gone.
