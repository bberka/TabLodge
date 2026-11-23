# Code comments

Code has no comments. Reason lives where something checks it: name, type, test, or ADR in [docs/adr/](../adr/). Comments in TS, TSX, JS fail lint (`local/no-comments`, `xo.config.ts`). Lint or type directive stays, with reason inside: `eslint-disable-next-line rule -- reason`, `@ts-expect-error reason`. Directive without reason is comment. `/// <reference>`, shebangs, `eslint-enable` allowed.

## Ratchet

One pull request per area deletes old comments. `scripts/comment-baseline.json` holds each file's remaining count; lint rule off for files listed.

- `node scripts/comment-ratchet.ts` runs in `vp run check` and CI job `comments`. Checks only files branch touches.
- Touched file passes when count equals baseline and no higher than at merge base. New comment fails, and so does deleted one until baseline follows: run `node scripts/comment-ratchet.ts --write` and commit JSON. File at zero leaves baseline, rule covers it.
- `--report` prints comments, lines, files per area. `apps/site` outside xo, so only ratchet covers it.
- Never raise baseline by hand.
- Branch started before rule can add file with comments no baseline lists, then lint fails on master after merge. Small pull request deletes those comments. Requiring up to date branches, or merge queue, checks merged result and prevents it.

## Deleting an area

Run `/delete-comment <path>`. One pull request per area, from fresh `origin/master`: comment deletions and directive reasons only, no logic edits. Leave area with heavy open pull request churn until those merge.

Sort honestly: comment about browser quirk, race, or protocol constraint is decision.

| Category | Meaning | Action |
| --- | --- | --- |
| Tautology | Repeats the code | Delete |
| Stale | Describes code or behavior that is gone | Delete |
| Excuse | Justifies a hack | Delete, and list it in one issue per area with `file:line` and a fix sketch |
| Decision Record | A non-obvious decision (quirk, race, constraint, format, ordering) | Move to the area's ADR |

Area's ADR is `docs/adr/<next number>-<area>-decisions.md`: take number after highest on `origin/master` and in open pull requests. Lists each decision with `file:symbol` reference and reason. Decision ADR already covers gets link only. Pull request body has category table with counts and issue link.
