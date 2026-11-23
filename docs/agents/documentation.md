# Documentation

## Style

Plain language, short paragraphs, direct instructions. Describe what person can do, what to expect. No em dashes or en dashes in prose; rewrite sentence. Keep hyphens only where syntax, exact name, path, URL, command, or technical term needs them. Run the `unslop-text` skill on prose you changed.

Each topic has one main place; link to it from elsewhere. Remove obsolete notes, don't leave old behavior beside new.

## Keep current

Change not done while document describes old behavior. Check these for feature names, settings, defaults, permissions, commands, removed behavior. Say in summary when none needed update:

- `docs/README.md`: feature list and install links. `docs/install.md`, `docs/android.md`, `docs/private-windows.md`: install and updates, Android app, private windows. `docs/PRIVACY.md`: permissions. `docs/CONTRIBUTING.md`: commands and project structure.
- `apps/extension/src/app/help.tsx`: anything users see (behavior, settings, workflows).
- `apps/site/src/pages/` (`index`, `alternatives`, `privacy`): features, FAQ, install, comparisons, permissions, stored data. Screenshots: [Site](site.md#screenshots).
- `docs/architecture.md`, `docs/PRIVACY.md`, `docs/self-hosting.md`: storage, sync, permissions, network behavior, server setup.
- `docs/agents/`: doc for any workflow or app rule you changed.

Research notes are GitHub comments, not files: mobile app memo on issue #1, tab manager comparison on issue #21 (`gh issue view <number> --comments`). Read only for roadmap or competitor questions.

## Agent docs

`AGENTS.md` is map, not manual. Holds repository layout, hard rules, one pointer per doc, each saying when to load it. Everything else lives in `docs/agents/`.

- **Add a rule** to doc whose pointer matches situation. Put next to related rules. Delete rule that code, config, or script already enforces.
- **Add a doc** when topic applies to some tasks only, give it one row in `AGENTS.md` table. Word trigger as situation ("Editing UI"), lead with distinctive word, one trigger per branch.
- **Keep `AGENTS.md` under about 60 lines.** Rule every task needs stays; anything else moves to doc.
- **Per-folder `AGENTS.md`.** `apps/*/AGENTS.md` holds few rules that break something when missed, each with reason, points to doc here for rest. Keep under 15 lines; harness loads it when agent works in that folder.
- **The size budget.** `scripts/agent-context-budget.json` records bytes of `AGENTS.md`, `apps/*/AGENTS.md`, `docs/agents/`. After editing any, run `node scripts/agent-context.ts --write` and commit file. CI fails pull request whose budget is above master's, unless it has `agent-context-increase` label. Cut text before asking for label.
- State target behavior positively. Use prohibition only for hard guardrail, with positive alternative beside it.
- Cache only what lookup cannot reveal (reason, gotcha, unwritten convention). Leave paths, commands, options to files and `package.json`.
- Write or edit these files with `writing-for-agents` skill loaded.
- **Compress after edit.** Run `/caveman-compress <file>` on each `AGENTS.md` and `docs/agents/` file you add or change, before commit. Code blocks, inline code, paths, URLs, commands, headings stay exact. Backup goes out of tree; never commit `*.original.md`. Human docs (`docs/*.md`, Help, site copy) stay uncompressed.
