---
name: delete-comment
description: Delete the code comments under a path, move the decisions into the area's ADR, and lower the comment ratchet.
disable-model-invocation: true
argument-hint: <path>
---

Remove every comment under `$ARGUMENTS`. Load `docs/agents/comments.md` first: it holds the rules, the category table, and the ADR format. Work in a worktree from fresh `origin/master`, and touch comments only.

1. **List.** `node scripts/comment-ratchet.ts --report` gives the count for the area. Read every comment in the path with its code, file by file. Done when each one has a category.
2. **Sort.** Tautology, Stale, Excuse, or Decision Record. A comment that names a browser, a race, an ordering, a format, or a limit is a Decision Record until you can show the code or a test states it.
3. **Keep a decision where it can fail.** When a name, a type, or a test can carry the reason, change that (a test that already exists counts; a new one is a logic edit, so leave it for its own pull request). Otherwise write the decision into the area's ADR with `file:symbol` and the reason. Done when every Decision Record is in the ADR or links one.
4. **Excuses.** File one issue for the area (`gh issue create`, into `bberka/TabLodge`) listing each hack with `file:line`, why it is a hack, and a fix sketch.
5. **Delete.** Remove the comments. Give each `eslint-disable` that lacks one a reason (`eslint-disable-next-line rule -- reason`). Make no other edit.
6. **Lower the ratchet.** `node scripts/comment-ratchet.ts --write`, then `node scripts/comment-ratchet.ts` passes and `pnpm exec xo <path>` is clean.
7. **Prove nothing else changed.** `git diff -w` shows only removed comment lines, reasons added to directives, and the ADR; `vp run check` and `vp run build` pass.
8. **Open the pull request** per `docs/agents/workflow.md`. The body has the category table with counts, the ADR path, the issue, and the new ratchet total.
