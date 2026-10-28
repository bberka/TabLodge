# Agent instructions

## Hard rules

- **Never push to `master` or `main`.** Do not commit on it, force push it, or merge into it from a shell. Run `git branch --show-current` before the first commit. If it prints `master` or `main`, create a branch named `<type>/<short-topic>` (`feat/`, `fix/`, `docs/`, `chore/`, `refactor/`) first. Changes reach `master` only through a reviewed pull request that the maintainer merges.
- **Commit messages list only the human author.** Never add `Co-Authored-By` trailers or any AI attribution to a commit. Write messages with the `unslop-git` skill.
- **Every pull request names the model that did the work.** Fill in the **Model** line of the pull request template with the product name and exact model ID, such as `Claude Sonnet 5.5 (claude-sonnet-5-5)`. If several models contributed, list each with what it did. The model goes in the pull request, never in a commit.
- **Every fix or feature carries proof in the pull request.** Show that the bug is gone or the feature works: a before and after screenshot, a short recording, or console and test output from the dev browser. Use the existing tools in [Agent validation and PR gate](docs/agent-validation.md). A passing build or unit test alone is not proof for runtime behavior.
- **Unslop the diff before every push.** Run the matching `unslop-*` skills on the changed files only, fix what they find, rerun the checks, and commit the fixes. Do not run a whole repo pass, do not commit `.unslop/` output, and do not paste an unslop report into the pull request. Details are in [Agent validation and PR gate](docs/agent-validation.md#unslop-the-diff).
- **Finish the gate before pushing.** Do not push or open a pull request until the checks, browser proof, unslop pass, and scope review are done. If one is blocked, stop and report what is blocked.

## Setup

Install the Vite+ CLI once as described in [README Development](docs/README.md#development). Use `vp run lint:fix` for formatting. For selected files, use `pnpm exec xo --fix <files>`. Never run `vp fmt`, plain `prettier`, or another formatter; their styles differ and can rewrite unrelated files.

Agent skills are pinned in `skills-lock.json` and installed per machine into `.agents/skills/`, which git ignores. Restore them once per clone with `npx skills experimental_install`. Load a skill only when its description matches the task. The ones this repo relies on:

| Skill                                                                           | Use it when                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `unslop-typescript`, `unslop-react`, `unslop-ui`, `unslop-tests`, `unslop-text` | Cleaning the diff before a push, by file type   |
| `unslop-git`                                                                    | Writing a commit message                        |
| `pr`                                                                            | Writing a pull request body                     |
| `tdd`                                                                           | Fixing a bug or adding behavior test first      |
| `diagnosing-bugs`                                                               | Something is broken, throwing, failing, or slow |
| `code-review`                                                                   | Reviewing a branch or pull request              |

## Documentation map

All Markdown except this file lives in `docs/`. Do not read every document up front. Open a document when its row matches the task, follow its links only as far as the task needs, and skip the rest.

| Document                                                                                                                                                                                                                                                                                   | Load it when                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)                                                                                                                                                                                                                                               | Writing code or docs, or changing releases. It holds code conventions, the documentation style, testing rules, and the release process. |
| [docs/agent-validation.md](docs/agent-validation.md)                                                                                                                                                                                                                                       | Before reporting work complete, committing, pushing, or opening a pull request.                                                         |
| [docs/architecture.md](docs/architecture.md)                                                                                                                                                                                                                                               | Touching storage, the service worker, messages, import and export, or recovery.                                                         |
| [docs/README.md](docs/README.md)                                                                                                                                                                                                                                                           | Changing features, commands, permissions, installation, or the project structure.                                                       |
| [docs/PRIVACY.md](docs/PRIVACY.md)                                                                                                                                                                                                                                                         | Changing what is stored, which permissions are requested, or any network behavior.                                                      |
| [docs/website.md](docs/website.md)                                                                                                                                                                                                                                                         | Editing `site/`, its screenshots, or deployment.                                                                                        |
| [docs/agents/](docs/agents/)                                                                                                                                                                                                                                                               | Working with issues, triage labels, or domain terms. See the next section.                                                              |
| Research notes are not in the repository. The mobile app memo is a comment on issue #1 and the tab manager comparison is a comment on issue #21. Read them with `gh issue view <number> --comments` only for roadmap or competitor questions. They are background, not feature checklists. |

## Agent skills

### Issue tracker

Issues and pull requests live on GitHub for `bberka/TabLodge`, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single context. The glossary is `docs/GLOSSARY.md` and decisions are in `docs/adr/`. Both are created when first needed. See `docs/agents/domain.md`.

## Documentation style

Follow [Writing documentation](docs/CONTRIBUTING.md#writing-documentation) when editing docs, Help, or website copy. Write plainly and keep one main source for each topic. Do not use em dashes or en dashes in prose, or hyphens unless syntax or an exact technical name requires them. Use sentences, commas, or parentheses instead.

## Keep documentation current

Before finishing a change, check these places and update anything the change made inaccurate:

- `docs/README.md`: features, installation, updates, permissions, commands, and project structure.
- `site/src/pages/index.astro`: features, FAQ, installation, and backups. Also check `alternatives.astro` and `privacy.astro` for comparisons, permissions, and stored data. Update screenshots in `site/src/assets/` when the UI they show changes; see [docs/website.md](docs/website.md#screenshots).
- `src/app/help.tsx`, `docs/architecture.md`, `docs/PRIVACY.md`, and `docs/CONTRIBUTING.md`: behavior and development details affected by the change.
- `AGENTS.md` and `docs/agent-validation.md`: when the agent workflow itself changes.

Check feature names, settings, defaults, permissions, and removed behavior. If none of these documents need an update, say so in the summary.
