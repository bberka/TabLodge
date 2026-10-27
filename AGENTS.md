# Agent instructions

Commit messages must list only the human author. Never add `Co-Authored-By` trailers or AI attribution.

Install the Vite+ CLI once as described in [README Development](README.md#development), then use `vp run lint:fix` for formatting. For selected files, use `pnpm exec xo --fix <files>`. Never run `vp fmt`, plain `prettier`, or another formatter; their styles differ and can rewrite unrelated files.

## Documentation style

Follow [Writing documentation](CONTRIBUTING.md#writing-documentation) when editing docs, Help, or website copy. Write plainly and keep one main source for each topic. Do not use em dashes or en dashes in prose, or hyphens unless syntax or an exact technical name requires them. Use sentences, commas, or parentheses instead.

## Keep documentation current

Before finishing a change, check these places and update anything the change made inaccurate:

- `README.md`: features, installation, updates, permissions, commands, and project structure.
- `site/src/pages/index.astro`: features, FAQ, installation, and backups. Also check `alternatives.astro` and `privacy.astro` for comparisons, permissions, and stored data. Update screenshots in `site/src/assets/` when the UI they show changes; see [site/README.md](site/README.md#screenshots).
- `src/app/help.tsx`, `docs/architecture.md`, `PRIVACY.md`, and `CONTRIBUTING.md`: behavior and development details affected by the change.

Check feature names, settings, defaults, permissions, and removed behavior. If none of these documents need an update, say so in the summary.

## Agent validation and scope gate

Before reporting a code change complete, and before committing, pushing, or opening a pull request, follow [Agent validation and PR gate](docs/agent-validation.md). Runtime changes require automated checks, browser proof of the affected workflow, and a focused diff review. If browser validation is blocked, stop before commit or push and report the blocker.
