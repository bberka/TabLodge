# Domain Docs

TabLodge is a single context repo. All Markdown except `AGENTS.md` lives under `docs/`, so the glossary is `docs/GLOSSARY.md`, not a root file.

This is how the engineering skills read the domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/GLOSSARY.md`**: the project's domain terms.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── AGENTS.md
├── docs/
│   ├── GLOSSARY.md
│   └── adr/
│       └── 0001-example-decision.md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
