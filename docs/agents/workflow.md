# Task workflow

Every task that ends in a commit follows these steps. Proof and checks live in [Validation](validation.md).

## Start of a session

Run `ls .agents/skills ~/.agents/skills 2>/dev/null || true` (worktree usually has no `.agents`, user level copy enough). When both empty, run `vp run skills:install`. Running session may not list new skills; read `.agents/skills/<name>/SKILL.md` and follow it. When restore fails, say which skills missing in first message, because unslop pass, `pr` body, `tdd` workflow depend on them. Do not push until they exist or user says go on without them.

## Steps

1. **Worktree.** Start each task in own Git worktree on new `<type>/<short-topic>` branch from latest `origin/master` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`). Run `pnpm install` in it, which also enables the [Git hooks](#git-hooks). If commit fails because `pnpm` on PATH broken (`which pnpm` points at shim whose target missing), put working one first (`PATH=/usr/bin:$PATH git commit ...`); leave hooks on.
2. **Scope and spec.** Read request and code first. Run `git status --short` and keep existing user changes. Then find or write spec as in [Spec driven development](spec-driven.md); its acceptance criteria are definition of done.
3. **Challenge new features.** Request to add or change what app does gets `challenge-feature` skill before any code. On "don't build" verdict, stop and ask user whether to go on. On "build" or "build smaller", say verdict in one line and continue with agreed scope. Skip this step for fix, refactor, docs, or tooling, and when user says implement it, build it, or just do it: that is the decision, so do not challenge or ask again (spec still written).
4. **Work and gate.** Build against spec's criteria, then pass the [validation gate](validation.md), including [proof](validation.md#proof) for each criterion. Screenshots for UI change, strongest other evidence for anything else. Ask user only when no form of proof possible, and say what you tried.
5. **Commit** one self contained step at a time, each passing hooks alone. Messages come from `unslop-git` skill and name human author only: no `Co-Authored-By`, no AI attribution.
6. **Pull request.** Run the [unslop pass](validation.md#unslop-the-diff) on diff, then push and open pull request without asking first. **Model** line of template names product and exact model ID (for example `Claude Sonnet 5.5 (claude-sonnet-5-5)`), with what each model did when several contributed. Model goes in pull request, never in commit. Open it ready for review, never as draft (no `gh pr create --draft`), unless user asks for draft in that message. Write body with `pr` skill, with spec's Acceptance list and proof beside each criterion (uploaded screenshots as images, see [Proof](validation.md#proof)). Follow up request amends spec before code.
7. **CI.** Watch checks until finish with harness's pull request watcher when it has one, otherwise one `gh pr checks <n> --watch` (right after push it can report no checks yet: run again after short wait); never `sleep` and `gh pr checks` loop. Failure caused by change gets fix, push, and another wait. Stop and tell user what failed and why after three attempts, or at once for cause outside change (outage, runner problem, missing secret, flaky test that passes locally). Then fix only CodeRabbit findings that are real bug or break acceptance criterion, answer rest in one line without pushing, and stop after three rounds. Maintainer merges.
8. **Clean up and report.** Once checks pass, stop everything you started: dev browsers (send `Browser.close` as in [Browser access](extension.md#browser-access)), Firefox session, build watchers, dev servers, emulators. Remove worktree's leftovers only if you created them. Then reply `Done` with pull request link and one line on proof. Do not report done while process you started still runs or while checks pending.

## Git hooks

`pnpm install` runs `vp hooks enable --hooks-dir .hooks` (the `prepare` script), which points `core.hooksPath` at `.hooks/_`. Scripts in `.hooks/`, and `vp hooks status` shows state. New worktree has no hooks until `pnpm install` runs there.

| Hook | Runs |
| --- | --- |
| `pre-commit` | refuses `master` and `main`, lints staged files with XO (`vp staged`, configured in `vite.config.ts`), runs `tsgo -b` |
| `pre-push` | `vp run check`, the same lint, typecheck, and tests that CI runs as separate jobs |

Hooks check and never edit. Fix findings with `pnpm exec xo --fix <files>` and stage result. Bypassing off limits: `--no-verify`, `VP_GIT_HOOKS=0`, `VITE_GIT_HOOKS=0`, `HUSKY=0`, and `vp hooks disable`.
