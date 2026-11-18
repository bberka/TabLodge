# Task workflow

Every task that ends in a commit follows these steps. The proof and checks live in [Validation](validation.md).

## Start of a session

Run `ls .agents/skills ~/.agents/skills 2>/dev/null` (a worktree usually has no `.agents`, and the user level copy is enough). When both are empty, run `vp run skills:install`. A running session may not list new skills; read `.agents/skills/<name>/SKILL.md` and follow it. When the restore fails, say which skills are missing in your first message, because the unslop pass, `pr` body, and `tdd` workflow depend on them. Do not push until they exist or the user says to go on without them.

## Steps

1. **Worktree.** Start each task in its own Git worktree on a new `<type>/<short-topic>` branch from the latest `origin/master` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`). Run `pnpm install` in it, which also enables the [Git hooks](#git-hooks). If a commit fails because `pnpm` on the PATH is broken (`which pnpm` points at a shim whose target is missing), put a working one first (`PATH=/usr/bin:$PATH git commit ...`); leave the hooks on. Run `git branch --show-current` before the first commit; `master` and `main` never take a commit.
2. **Scope.** Read the request and the code first. Run `git status --short` and keep existing user changes.
3. **Challenge new features.** A request to add or change what the app does gets the `challenge-feature` skill before any code. On a "don't build" verdict, stop and ask the user whether to go on. On "build" or "build smaller", say the verdict in one line and continue with the agreed scope. Skip this step for a fix, a refactor, docs, or tooling, and when the user says to implement it, build it, or just do it: that is the decision, so do not challenge or ask again.
4. **Work and gate.** Pass the [validation gate](validation.md), including [proof](validation.md#proof). Screenshots for a UI change, and the strongest other evidence for anything else. Ask the user only when no form of proof is possible, and say what you tried.
5. **Commit** one self contained step at a time, each passing the hooks alone. Messages come from the `unslop-git` skill and name the human author only: no `Co-Authored-By`, no AI attribution.
6. **Pull request.** Run the [unslop pass](validation.md#unslop-the-diff) on the diff, then push and open the pull request without asking first. The **Model** line of the template names the product and exact model ID (for example `Claude Sonnet 5.5 (claude-sonnet-5-5)`), with what each model did when several contributed. The model goes in the pull request, never in a commit. Open it ready for review, never as a draft (no `gh pr create --draft`), unless the user asks for a draft in that message. Write the body with the `pr` skill, with the proof in it (uploaded screenshots as images, see [Proof](validation.md#proof)).
7. **CI.** Watch the checks until they finish with your harness's pull request watcher when it has one, otherwise one `gh pr checks <n> --watch`; never a `sleep` and `gh pr checks` loop. A failure caused by the change gets a fix, a push, and another wait, three attempts in total. Stop and tell the user what failed and why after three attempts or at once for a cause outside the change (outage, runner problem, missing secret, flaky test that passes locally). Review findings are handled the same way. The maintainer merges.
8. **Clean up and report.** Once the checks pass, stop everything you started: dev browsers (send `Browser.close` as in [Browser access](validation.md#browser-access)), the Firefox session, build watchers, dev servers, and emulators. Remove the worktree's leftovers only if you created them. Then reply `Done` with the pull request link and one line on the proof. Do not report done while a process you started still runs or while checks are pending.

## Git hooks

`pnpm install` runs `vp hooks enable --hooks-dir .hooks` (the `prepare` script), which points `core.hooksPath` at `.hooks/_`. The scripts are in `.hooks/`, and `vp hooks status` shows the state. A new worktree has no hooks until `pnpm install` runs there.

| Hook | Runs |
| --- | --- |
| `pre-commit` | refuses `master` and `main`, lints staged files with XO (`vp staged`, configured in `vite.config.ts`), runs `tsgo -b` |
| `pre-push` | `vp run check`, the same lint, typecheck, and tests that CI runs as separate jobs |

The hooks check and never edit. Fix findings with `pnpm exec xo --fix <files>` and stage the result. Bypassing is off limits: `--no-verify`, `VP_GIT_HOOKS=0`, `VITE_GIT_HOOKS=0`, `HUSKY=0`, and `vp hooks disable`.
