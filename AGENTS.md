# Agent instructions

Commit messages must list only the human author; never add `Co-Authored-By` trailers or AI-agent attribution.

## Keep the README, docs and landing page current

After finishing a change (a PR or any other work), check whether it made any of these outdated, and update them in the same piece of work:

- `README.md`: features, install and update steps, permissions table, commands, project structure.
- The landing website in `site/`: mainly `site/src/pages/index.astro` (feature cards, FAQ, install and backup steps), plus `alternatives.astro` and `privacy.astro` (permissions, what is stored). Regenerate the screenshots in `site/src/assets/` when the UI they show changed (see `site/README.md`).
- In-app Help (`src/app/help.tsx`), `docs/architecture.md`, `PRIVACY.md` and `CONTRIBUTING.md` where the change touches what they describe.

Look for features that were added, renamed, or removed, changed settings or defaults, new or removed permissions, and wording that no longer matches the app. If nothing needs changing, say so in your summary.
