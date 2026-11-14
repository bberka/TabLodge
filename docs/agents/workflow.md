# Task workflow

Every task that ends in a commit follows these steps. The proof and checks live in [Validation](validation.md).

## Start of a session

Run `ls .agents/skills`. When it is missing or empty and `~/.agents/skills` has no copy, run `vp run skills:install`. A running session may not list new skills; read `.agents/skills/<name>/SKILL.md` and follow it. When the restore fails, say which skills are missing in your first message, because the unslop pass, `pr` body, and `tdd` workflow depend on them. Do not push until they exist or the user says to go on without them.

## Steps

1. **Worktree.** Start each task in its own Git worktree on a new `<type>/<short-topic>` branch from the latest `origin/master` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`). Run `pnpm install` in it, which also enables the [Git hooks](#git-hooks). Run `git branch --show-current` before the first commit; `master` and `main` never take a commit.
2. **Scope.** Read the request and the code first. Run `git status --short` and keep existing user changes.
3. **Work and gate.** Pass the [validation gate](validation.md).
4. **Commit** one self contained step at a time, each passing the hooks alone. Messages come from the `unslop-git` skill and name the human author only: no `Co-Authored-By`, no AI attribution.
5. **Pull request.** Push and open it as soon as the work is done. The **Model** line of the template names the product and exact model ID (for example `Claude Sonnet 5.5 (claude-sonnet-5-5)`), with what each model did when several contributed. The model goes in the pull request, never in a commit. Write the body with the `pr` skill.
6. **CI.** Watch the checks until they finish. A failure caused by the change gets a fix, a push, and another wait, three attempts in total. Stop and tell the user what failed and why after three attempts or at once for a cause outside the change (outage, runner problem, missing secret, flaky test that passes locally). Review findings are handled the same way. The maintainer merges.

## Git hooks

`pnpm install` runs `vp hooks enable --hooks-dir .hooks` (the `prepare` script), which points `core.hooksPath` at `.hooks/_`. The scripts are in `.hooks/`, and `vp hooks status` shows the state. A new worktree has no hooks until `pnpm install` runs there.

| Hook | Runs |
| --- | --- |
| `pre-commit` | refuses `master` and `main`, lints staged files with XO (`vp staged`, configured in `vite.config.ts`), runs `tsc -b` |
| `pre-push` | `vp run check`, the command CI runs first |

The hooks check and never edit. Fix findings with `pnpm exec xo --fix <files>` and stage the result. Bypassing is off limits: `--no-verify`, `VP_GIT_HOOKS=0`, `VITE_GIT_HOOKS=0`, `HUSKY=0`, and `vp hooks disable`.
