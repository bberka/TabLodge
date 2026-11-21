# Code comments

Code has no comments. A reason lives where something checks it: a name, a type, a test, or an ADR in [docs/adr/](../adr/). Comments in TS, TSX, and JS fail lint (`local/no-comments`, `xo.config.ts`). A lint or type directive stays, with its reason inside it: `eslint-disable-next-line rule -- reason`, `@ts-expect-error reason`. A directive without a reason is a comment. `/// <reference>`, shebangs, and `eslint-enable` are allowed.

## Ratchet

One pull request per area deletes the old comments. `scripts/comment-baseline.json` holds each file's remaining count; the lint rule is off for the files listed.

- `node scripts/comment-ratchet.ts` runs in `vp run check` and in the CI job `comments`. It checks only the files the branch touches.
- A touched file passes when its count equals its baseline and is no higher than at the merge base. A new comment fails, and so does a deleted one until the baseline follows: run `node scripts/comment-ratchet.ts --write` and commit the JSON. A file at zero leaves the baseline and the rule covers it.
- `--report` prints comments, lines, and files per area. `apps/site` is outside xo, so only the ratchet covers it.
- Never raise a baseline by hand.
- A branch started before the rule can add a file with comments that no baseline lists, and lint then fails on master after the merge. A small pull request deletes those comments. Requiring up to date branches, or a merge queue, checks the merged result and prevents it.

## Deleting an area

Run `/delete-comment <path>`. One pull request per area, from fresh `origin/master`: comment deletions and directive reasons only, no logic edits. Leave an area with heavy open pull request churn until those merge.

Sort honestly: a comment about a browser quirk, a race, or a protocol constraint is a decision.

| Category | Meaning | Action |
| --- | --- | --- |
| Tautology | Repeats the code | Delete |
| Stale | Describes code or behavior that is gone | Delete |
| Excuse | Justifies a hack | Delete, and list it in one issue per area with `file:line` and a fix sketch |
| Decision Record | A non-obvious decision (quirk, race, constraint, format, ordering) | Move to the area's ADR |

The area's ADR is `docs/adr/<next number>-<area>-decisions.md`: take the number after the highest on `origin/master` and in open pull requests. It lists each decision with a `file:symbol` reference and its reason. A decision an ADR already covers gets a link only. The pull request body has the category table with counts and the issue link.
