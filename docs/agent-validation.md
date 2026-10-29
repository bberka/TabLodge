# Agent validation and PR gate

Install the Vite+ CLI once as described in [README Development](README.md#development), then use `vp run <task>` from the repository root. This workflow applies to every code fix or feature and defines when an agent may report the change as complete and when it may commit, push, or open a pull request.

## Required workflow

1. **Confirm scope.** Read the request and relevant code before editing. Run `git status --short` first and preserve existing user changes. Identify the affected behavior and the files needed to change it.
2. **Add regression coverage.** For a bug, add or update a test that fails before the fix when practical. For a feature, test the new behavior at the most direct existing test boundary. Do not replace a browser test with a mock when the behavior depends on Chrome APIs or extension page behavior.
3. **Run automated checks.** Run `vp run check` and `vp run build`. Fix failures and rerun both commands. Record the result of each command.
4. **Verify runtime behavior in the dev browser.** For a user visible or browser behavior change, run `vp run browser:install` once if the Playwright browser is missing, then run `vp run dev`. Wait for the initial build to finish and use the opened Chrome or Chromium profile for this worktree. Perform the exact action that was broken or changed and check the result. After rebuilding, reload TabLodge at `chrome://extensions` and reopen its pages. Check the page console and service worker console for relevant errors. For UI changes, also test keyboard use and both themes, and run `vp run a11y` after `vp run build`. Follow [Accessibility](CONTRIBUTING.md#accessibility): every pointer-only interaction needs a keyboard alternative, and the pull request records the keyboard and screen reader testing you did.
5. **Capture proof.** For every fix or feature, keep evidence that the change works, taken from the run in step 4. See [Proof](#proof).
6. **Unslop the diff.** Clean the changed files before review. See [Unslop the diff](#unslop-the-diff).
7. **Review scope and evidence.** Run `git diff --check` and `git status --short`, then inspect `git diff HEAD` to review staged and unstaged changes together. Confirm that every changed file is needed for the request, remove unrelated edits and generated files, and record concrete validation evidence for the pull request.

## Proof

A fix or feature is not done until the pull request shows it working. Pick the strongest form the environment allows:

- **Screenshot** for anything visual. Take it from the dev browser (`vp run dev`, or `vp run dev:seed` for realistic sample data) after the change. For a fix, also capture the broken state before the change. Check both themes for UI changes.
- **Recording or step list** for behavior that a still image cannot show, such as drag and drop, shortcuts, or restore flows. Give the exact steps and the observed result.
- **Console or test output** for worker, storage, or import and export changes: the failing test before the fix and the passing test after, or the service worker console showing the expected result.

Save screenshots and recordings under `.dev/evidence/`, which git ignores, and attach them to the pull request. Do not commit evidence files. If the agent cannot attach files, name the file path in the pull request and ask the maintainer to attach it. Documentation only and tooling only changes need a sentence explaining why browser proof does not apply.

## Unslop the diff

Before the first push and after any later rework, review only the files this branch changes:

```sh
git diff --name-only origin/master...HEAD
```

Run the `unslop-*` skills that match those files, scoped to that list and nothing else:

| Changed files | Skill |
| --- | --- |
| `.ts` and `.tsx` code | `unslop-typescript`, which continues into `unslop-react` and `unslop-ui` for React |
| `tests/` | `unslop-tests` |
| Markdown, Help copy, website copy, code comments | `unslop-text` |
| Commit messages on the branch | `unslop-git` |

Fix every finding that is in your diff. Leave code you did not change alone, even when it has slop, and mention it in the pull request only if it blocks the change. Then rerun `vp run check` and `vp run build`, commit the fixes, and continue. The skills write a ledger to `.unslop/`; git ignores it, and the pull request does not need a report. Say in the pull request that the pass ran.

## Browser access

`vp run dev` opens the extension from `dist/tablodge/` in a profile for this worktree at `.dev/chrome-profile`. Playwright uses installed Google Chrome when available and falls back to its Chromium browser. The profile is separate from regular browser data and from other worktrees. Source changes rebuild automatically, but Chrome does not reload the extension automatically.

Use the opened browser to exercise the affected workflow, not just to confirm that a page renders. A screenshot can support evidence for a visual change, but it does not replace exercising the behavior. If the agent environment can interact with the browser, use that browser control. If it cannot, add or run an automated browser test for the affected behavior. If neither browser interaction nor an appropriate automated test can run, report validation as blocked and ask for access. Do not claim the behavior works based only on unit tests, a successful build, or static inspection.

## Change scope review

Keep the patch to the smallest set of changes that implements the request and its tests. Before opening a pull request, check each changed path against the request and remove unrelated cleanup, formatting, generated output, or speculative refactoring. Explain any necessary supporting change, such as a migration, test, or documentation update. Preserve existing user changes.

## Commit and pull request gate

Never commit on or push to `master` or `main`. Work on a `<type>/<short-topic>` branch and open a pull request. Do not force push a shared branch.

Do not commit, push, or open a pull request for a runtime change until automated checks pass, the affected workflow has been exercised in Chrome or Chromium, proof is captured, the diff has been unslopped, and the scope review is complete. If an environment limitation blocks a required check, stop before committing or pushing and report exactly what is blocked and what access is needed.

Commit messages name the human author only. Do not add `Co-Authored-By` trailers or any AI attribution to a commit.

In the pull request, include:

- The model that did the work, by product name and exact model ID. This is the **Model** line of the pull request template.
- The commands run and whether each passed.
- The browser used and the exact steps exercised, with the observed result.
- For UI changes, the result of `vp run a11y` and the keyboard and screen reader testing: browser, assistive technology, workflows tested, and remaining limitations.
- The proof from [Proof](#proof): a screenshot, recording, or output, with a before and after for a fix.
- A line saying the unslop pass ran on the changed files.
- A reason that browser validation is not applicable for documentation only or tooling only changes.
- Confirmation that each changed file is relevant to the request and that unrelated changes were removed.

After opening the pull request, confirm the repository checks pass and address review findings before merge. The maintainer merges.
