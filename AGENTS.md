# Agent instructions

Commit messages must list only the human author; never add `Co-Authored-By` trailers or AI-agent attribution.

Formatting is done only by XO (`pnpm lint:fix`, or `pnpm exec xo --fix <files>` on the files you changed). Never run `vp fmt`, plain `prettier`, or another formatter on the repository: they use a different style and rewrite every file.

## Keep the README, docs and landing page current

After finishing a change (a PR or any other work), check whether it made any of these outdated, and update them in the same piece of work:

- `README.md`: features, install and update steps, permissions table, commands, project structure.
- The landing website in `site/`: mainly `site/src/pages/index.astro` (feature cards, FAQ, install and backup steps), plus `alternatives.astro` and `privacy.astro` (permissions, what is stored). Regenerate the screenshots in `site/src/assets/` when the UI they show changed (see `site/README.md`).
- In-app Help (`src/app/help.tsx`), `docs/architecture.md`, `PRIVACY.md` and `CONTRIBUTING.md` where the change touches what they describe.

Look for features that were added, renamed, or removed, changed settings or defaults, new or removed permissions, and wording that no longer matches the app. If nothing needs changing, say so in your summary.
