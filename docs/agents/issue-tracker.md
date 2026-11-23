# Issues and triage

Issues and specs for this repo live as GitHub issues; spec format in [Spec driven development](spec-driven.md). Use `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use heredoc for multiline bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at top of child body.
- **Blocking**: use GitHub's **native issue dependencies**, canonical form, show in UI. Add edge with `gh issue create --blocked-by <n>,<n> ...` or `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ `#number` or `node_id`). Where dependencies unavailable, fall back to `Blocked by: #<n>, #<n>` line at top of child body. Ticket unblocked when every blocker closed.
- **Count open blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable). `gh issue view <n> --json blockedBy` also lists closed blockers, so filter: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post explanation with `gh issue comment <number> --body "..."`, then `gh issue close <number>`. On already-closed issue, `gh issue close --comment` drops comment, still exits 0.

Infer repo from `git remote -v`; `gh` does this automatically inside a clone.

File issues only into `bberka/TabLodge`. In a fork, `gh` can default to upstream parent, so before first `gh issue create` of session, check target with `gh repo view --json nameWithOwner`, confirm with user if not their repo.

## Triage labels

| Label | Meaning |
| --- | --- |
| `needs-triage` | The maintainer has to evaluate it |
| `needs-info` | Waiting on the reporter |
| `ready-for-agent` | A finished [spec](spec-driven.md): problem, behavior, acceptance criteria, feature triage |
| `ready-for-human` | Needs a human to implement |
| `wontfix` | Will not be actioned |

Feature issue also gets [feature triage](cross-app.md#feature-triage) questions; its Acceptance list is what pull request is checked against. External pull requests not treated as feature requests.
