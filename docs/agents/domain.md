# Domain Docs

TabLodge is a single context repo. All Markdown except `AGENTS.md` lives under `docs/`, so the glossary is `docs/GLOSSARY.md`, not a root file.

This file tells the engineering skills how to read the domain documentation when they explore the codebase.

## Before exploring, read these

- **`docs/GLOSSARY.md`**: the project's domain terms.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence, and don't suggest creating them up front. The `/domain-modeling` skill (reached through `/improve-codebase-architecture`, `/triage`, and `/wayfinder`) creates them when terms or decisions get resolved.

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

If the concept you need isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, say so instead of silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because..._
