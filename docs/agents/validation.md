# Validation gate

Install Vite+ CLI once per [Contributing Development](../CONTRIBUTING.md#development), then use `vp run <task>` from repo root. Gate applies to every code fix or feature. Defines when you may report change complete, or commit, push, open pull request. Branch, commit, CI steps in [Task workflow](workflow.md).

## Required workflow

1. **Add regression coverage.** Bug: add or update test that fails before fix when practical. Feature: test new behavior at most direct existing test boundary. Do not replace browser test with mock when behavior depends on Chrome APIs or extension page behavior.
2. **Run automated checks.** Run `vp run check` and `vp run build`. Fix failures, rerun both. Record result of each. While iterating, `vp run check:changed` lints, type checks, tests only what differs from `origin/master`; faster loop, never replaces full run, because change can break file it did not touch. If change touches manifest, build scripts, `apps/extension/src/shared/browser.ts`, or anything differing between Chromium and Firefox, also run `vp run check:firefox` (needs Firefox installed) and record result.
3. **Verify runtime behavior in dev browser.** For user visible or browser behavior change, run `vp run browser:install` once if Playwright browser missing, then run `vp run dev:chrome --headless`. When change can behave differently in Firefox (see [Browser support](../architecture.md#browser-support)), also run `vp run dev:firefox --headless`, repeat check there. Wait for initial build to finish, connect to automation endpoint described in [Browser access](extension.md#browser-access). Perform exact action that was broken or changed, check result. After rebuilding, reload TabLodge at `chrome://extensions`, reopen its pages. Check page console and service worker console for relevant errors. For UI changes, also test keyboard use and both themes, run `vp run check:a11y` after `vp run build`. CI runs `check:a11y`, `check:startup`, `check:private-storage`, `check:dev-browser`, Cloudflare Worker freshness check on every pull request (see [CI](ci.md)), so run locally when change can break one, but green pull request already covers them. Follow [Accessibility](ui.md#accessibility): every interaction needing pointer also needs keyboard alternative. Use available screen reader or accessibility inspection tools.
4. **Capture proof.** For every fix or feature, keep evidence change works, taken from runs in steps 2 and 3 (test output counts where no browser run applies), one piece per acceptance criterion of [spec](spec-driven.md). See [Proof](#proof).
5. **Unslop the diff.** Clean changed files before review. See [Unslop the diff](#unslop-the-diff).
6. **Review scope and evidence.** Run `git diff --check` and `git status --short`, then inspect `git diff HEAD` to review staged and unstaged changes together. Check diff against spec: every criterion has proof, nothing goes beyond it ([Change scope review](#change-scope-review)). Record concrete validation evidence for pull request.

## Proof

Fix or feature not done until pull request shows it working. Pick strongest form environment allows:

- **Screenshots** for UI changes. Exercise affected workflow, capture resulting state in both themes at all four browser viewport profiles: mobile portrait 440 × 956 CSS pixels, device scale factor 3, representing 6.9 inch iPhone Pro Max class device; tablet portrait 768 × 1024 CSS pixels; wide desktop 1440 × 900 CSS pixels; very wide desktop 1920 × 1080 CSS pixels. Use mobile device emulation for phone profile. Use headless dev browser (`vp run dev:chrome --headless`, plus `--seed-data` for realistic sample data). For fix, also capture broken state before change at each profile where issue reproduces.
- **Android app proof.** Changes under `apps/mobile/` shown on Android emulator or device instead of browser profiles: screenshots of affected screens in app, with Android version and whether Material or iOS look used, plus note if TalkBack, dark theme, or small screen not checked. Start own emulator without window (`emulator -avd <name> -no-window -no-audio -gpu swiftshader_indirect`, or `pnpm run mobile:emulator --headless`), target it by serial in every command (`adb -s <serial>`, or `ANDROID_SERIAL=<serial>` for `pnpm run mobile:android` and installs), so nothing lands on another emulator. Screenshots and T3 device tools work same on headless emulator; open visible window only when maintainer asks. Keep sample data off any real server. **Mobile** workflow builds debug APK for these changes, but does not run app.
- **Recording or step list** for behavior still image cannot show, such as drag and drop, shortcuts, restore flows. Give exact steps and observed result.
- **Console or test output** for worker, storage, import and export changes: failing test before fix and passing test after, or service worker console showing expected result.

Save screenshots and recordings under `apps/extension/.dev/evidence/`, git ignores it, with viewport and theme in each file name.

Upload with `vp run evidence <pr-number> <file>...`, paste Markdown image links it prints into pull request description (`gh pr edit <pr> --body-file`). In pull request, path on your disk is not proof. Only when `gh` cannot reach repository, say so and list file paths.

**Check by assertion, look once.** Script capturing shot also asserts its state: expected text, visibility, no horizontal scroll, no console errors. To judge look, run `vp run proof:sheet <files or folder>` after last edit, open the one image it prints, once, or have subagent open it and report in text. Each opened image resent on every later turn, so open only sheet. Final reply embeds every screenshot by absolute path: `![mobile 440 light](/abs/path.png)`.

**Every change gets own screenshots.** Request to change something, including one arriving after pull request open, is new change. When it alters anything user sees (layout, copy, spacing, control, setting, default), take new screenshots of result in running app, upload, add to pull request before saying done; earlier set does not count. Change with no visible effect says so in one sentence instead. Documentation only and tooling only changes need sentence explaining why browser proof does not apply.

## Report only what you ran

Pull request and final reply list each check with result. Check you could not run (no Firefox, no emulator, blocked network) named as not run, with reason. Do not write that something works because code looks right, related test passed, or build succeeded. Android proof and browser proof each say what was not checked.

## Guards say why

Guard is hook, lint rule, CI check, skipped test, or lint suppression. When you add one, write what it prevents where configured or in doc naming it, put suppression's reason in directive ([Code comments](comments.md)). When one looks removable, read that reason first, change it only when reason no longer holds. Guard with no reason gets its reason found before removal.

## Unslop the diff

Before first push and after any later rework, review only files this branch changes:

```sh
git diff --name-only origin/master...HEAD
```

Run `unslop-*` skills matching those files, scoped to that list only:

| Changed files | Skill |
| --- | --- |
| `.ts` and `.tsx` code | `unslop-typescript`, which continues into `unslop-react` and `unslop-ui` for React |
| `apps/*/tests/` | `unslop-tests` |
| Markdown, Help copy, website copy | `unslop-text` |
| Commit messages on the branch | `unslop-git` |

Fix every finding in your diff. Leave code you did not change alone, even with slop; mention in pull request only if it blocks change. Then rerun `vp run check` and `vp run build`, commit fixes, continue. Skills write ledger to `.unslop/`, git ignores it. Pull request needs no report. Say in pull request that pass ran.

## Change scope review

Keep patch to smallest set of changes implementing request and its tests. Before opening pull request, check each changed path against request, remove unrelated cleanup, formatting, generated output, speculative refactoring. Explain any necessary supporting change, such as migration, test, documentation update. Preserve existing user changes.

## Pull request evidence

Do not commit, push, or open pull request for runtime change until checks pass, affected workflow ran in Chrome or Chromium, proof exists, diff unslopped, scope review done. When environment limit blocks required step, try another route to same proof first. Stop before committing and ask only when no form of proof possible; report what is blocked and what access needed.

Pull request body lists:

- Spec: issue link and its Acceptance list, each criterion with its proof (or one sentence spec of refactor, docs, tooling change). Say so if criterion changed during work.
- Commands run and whether each passed.
- Browser used and exact steps exercised, with observed result.
- For UI changes, result of `vp run check:a11y`, keyboard testing, screen reader or accessibility inspection tools used, with workflows tested, tools unavailable, remaining limits. Manual screen reader testing not required.
- [Proof](#proof), with before and after for fix.
- That unslop pass ran on changed files.
- Why browser validation does not apply, for documentation only or tooling only changes.
- That each changed file is needed and unrelated changes are gone.
