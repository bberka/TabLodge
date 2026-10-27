# Agent validation and PR gate

Install the Vite+ CLI once as described in [README Development](../README.md#development), then use `vp run <task>` from the repository root. This workflow applies to every code fix or feature and defines when an agent may report the change as complete and when it may commit, push, or open a pull request.

## Required workflow

1. **Confirm scope.** Read the request and relevant code before editing. Run `git status --short` first and preserve existing user changes. Identify the affected behavior and the files needed to change it.
2. **Add regression coverage.** For a bug, add or update a test that fails before the fix when practical. For a feature, test the new behavior at the most direct existing test boundary. Do not replace a browser test with a mock when the behavior depends on Chrome APIs or extension page behavior.
3. **Run automated checks.** Run `vp run check` and `vp run build`. Fix failures and rerun both commands. Record the result of each command.
4. **Verify runtime behavior in the dev browser.** For a user visible or browser behavior change, run `vp run browser:install` once if the Playwright browser is missing, then run `vp run dev`. Wait for the initial build to finish and use the opened Chrome or Chromium profile for this worktree. Perform the exact action that was broken or changed and check the result. After rebuilding, reload TabLodge at `chrome://extensions` and reopen its pages. Check the page console and service worker console for relevant errors. For UI changes, also test keyboard use and both themes.
5. **Review scope and evidence.** Run `git diff --check` and `git status --short`, then inspect `git diff HEAD` to review staged and unstaged changes together. Confirm that every changed file is needed for the request, remove unrelated edits and generated files, and record concrete validation evidence for the pull request.

## Browser access

`vp run dev` opens the extension from `dist/tablodge/` in a profile for this worktree at `.dev/chrome-profile`. Playwright uses installed Google Chrome when available and falls back to its Chromium browser. The profile is separate from regular browser data and from other worktrees. Source changes rebuild automatically, but Chrome does not reload the extension automatically.

Use the opened browser to exercise the affected workflow, not just to confirm that a page renders. A screenshot can support evidence for a visual change, but it does not replace exercising the behavior. If the agent environment can interact with the browser, use that browser control. If it cannot, add or run an automated browser test for the affected behavior. If neither browser interaction nor an appropriate automated test can run, report validation as blocked and ask for access. Do not claim the behavior works based only on unit tests, a successful build, or static inspection.

## Change scope review

Keep the patch to the smallest set of changes that implements the request and its tests. Before opening a pull request, check each changed path against the request and remove unrelated cleanup, formatting, generated output, or speculative refactoring. Explain any necessary supporting change, such as a migration, test, or documentation update. Preserve existing user changes.

## Commit and pull request gate

Do not commit, push, or open a pull request for a runtime change until automated checks pass, the affected workflow has been exercised in Chrome or Chromium, and the scope review is complete. If an environment limitation blocks a required check, stop before committing or pushing and report exactly what is blocked and what access is needed.

In the pull request, include:

- The commands run and whether each passed.
- The browser used and the exact steps exercised, with the observed result.
- A screenshot or other artifact for a visual change when the environment supports it.
- A reason that browser validation is not applicable for documentation only or tooling only changes.
- Confirmation that each changed file is relevant to the request and that unrelated changes were removed.

After opening the pull request, confirm the repository checks pass and address review findings before merge.
