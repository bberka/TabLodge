# Documentation

## Style

Plain language, short paragraphs, direct instructions. Describe what a person can do and what to expect. No em dashes or en dashes in prose; rewrite the sentence. Keep hyphens only where syntax, an exact name, a path, a URL, a command, or a technical term needs them. Run the `unslop-text` skill on prose you changed.

Each topic has one main place; link to it from elsewhere. Remove obsolete notes instead of leaving old behavior beside the new.

## Keep current

A change is not done while a document describes the old behavior. Check these for feature names, settings, defaults, permissions, commands, and removed behavior, and say in the summary when none needed an update:

- `docs/README.md`: the feature list and install links. `docs/install.md`, `docs/android.md`, `docs/private-windows.md`: install and updates, the Android app, private windows. `docs/PRIVACY.md`: permissions. `docs/CONTRIBUTING.md`: commands and project structure.
- `apps/extension/src/app/help.tsx`: anything users see (behavior, settings, workflows).
- `apps/site/src/pages/` (`index`, `alternatives`, `privacy`): features, FAQ, install, comparisons, permissions, stored data. Screenshots: [Site](site.md#screenshots).
- `docs/architecture.md`, `docs/PRIVACY.md`, `docs/self-hosting.md`: storage, sync, permissions, network behavior, server setup.
- `docs/agents/`: the doc for any workflow or app rule you changed.

Research notes are GitHub comments, not files: the mobile app memo is on issue #1 and the tab manager comparison on issue #21 (`gh issue view <number> --comments`). Read them only for roadmap or competitor questions.

## Agent docs

`AGENTS.md` is a map, not a manual. It holds the repository layout, the hard rules, and one pointer per doc, each saying when to load it. Everything else lives in `docs/agents/`.

- **Add a rule** to the doc whose pointer matches the situation. Put it next to related rules, and delete a rule that the code, config, or a script already enforces.
- **Add a doc** when a topic applies to some tasks only, and give it one row in the `AGENTS.md` table. Word the trigger as the situation ("Editing UI"), leading with the distinctive word, one trigger per branch.
- **Keep `AGENTS.md` under about 60 lines.** A rule that every task needs stays; anything else moves to a doc.
- **Per-folder `AGENTS.md`.** `apps/*/AGENTS.md` holds the few rules that break something when missed, each with its reason, and points to the doc here for the rest. Keep it under 15 lines; the harness loads it when an agent works in that folder.
- **The size budget.** `scripts/agent-context-budget.json` records the bytes of `AGENTS.md`, `apps/*/AGENTS.md`, and `docs/agents/`. After editing any of them run `node scripts/agent-context.ts --write` and commit the file. CI fails a pull request whose budget is above master's, unless it has the `agent-context-increase` label. Cut text before asking for the label.
- State the target behavior positively. Use a prohibition only for a hard guardrail, with the positive alternative beside it.
- Cache only what a lookup cannot reveal (a reason, a gotcha, an unwritten convention). Leave paths, commands, and options to the files and `package.json`.
- Write or edit these files with the `writing-for-agents` skill loaded.
